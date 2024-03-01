const { performance } = require('perf_hooks')
const RateLimiter = require('limiter').RateLimiter

const config = require('config')
const { getCachedProductData, searchTcgplayerData } = require('./BotDBHandler')
const { TCGPLAYER_API, API_TIMEOUT, TCGPLAYER_API_VERSION } = require('lib/models/Defines')
const { TCGPlayerSet, TCGPlayerProduct, TCGPlayerPrice } = require('lib/models/TCGPlayer')
const { logError, logger } = require('lib/utils/logging')

// TCGPlayer API limits to 300 requests/min, i.e., 6 per sec.
// Try not to piss them off. :)
const limiter = new RateLimiter({
	tokensPerInterval: 6,
	interval: 'second'
})

/**
 * Wraps fetch with the above rate limiter.
 * @param {string|URL|Request} url 
 * @param {RequestInit} options 
 * @returns {Promise<Response>} 
 */
async function limitedFetch(url, options) {
	await limiter.removeTokens()

	// Default add headers and a timeout to all of our fetches.
	if (!options) options = {}
	if (!options.headers) {
		options.headers = _requestHeaders
	}
	if (!options.signal) {
		options.signal = AbortSignal.timeout(API_TIMEOUT)
	}

	return fetch(url, options)
}

const _requestHeaders = {
	'accept': 'application/json',
	'User-Agent': config.appName,
	// Will have Authorization field filled in with the bearer token once we have it.
}
// Cached bearer token expiration to make sure we refresh it when we need to. 
let _bearerTokenExpire = undefined
// Cached TCGPlayer Yu-Gi-Oh category ID so we query the correct category.
let _ygoCategoryId = undefined

/**
 * @async
 * Some API requests to TCGPlayer are paged, meaning the total number of results they could return
 * is greater than the number of results a single API response can give.
 * This function exists to handle requests that could potentially result in paged data
 * by repeatedly sending requests at increasing offsets until all necessary data is gathered.
 * @param {URL} url The destination of the request.
 * @param {Object} apiRequestOptions The (fetch) request options to use for the query.
 * @param {Number} limitPerPage The maximum number of results per response. Defaults to 100, which is the TCGPlayer maximum.
 * @returns {Promise<Array>} All gathered responses.
 */
async function handlePagedRequest(url, options, limitPerPage = 100) {
	const results = []
	let totalResultItems = 0
	// Offset is increased as we get responses to move through the "pages".
	// When offset equals the total number of results we got, then our paged requests is complete.
	let offset = 0
	// Copy off the URL so we can play with parameters without breaking the reference URL.
	const urlWithParams = new URL(url)

	// Set our limit parameter.
	urlWithParams.searchParams.append('limit', limitPerPage)

	const handlePageResponse = async resp => {
		const jsonResponse = await resp.json()

		if (!totalResultItems) totalResultItems = jsonResponse.totalItems

		results.push(...jsonResponse.results)
		offset += jsonResponse.results.length
	}
	const handlePageError = async err => {
		logError(err, 'Encountered error when handling paged request.')
	}

	// Need to send the first request so we know what the total we have to deal with is.
	try {
		let response = await limitedFetch(urlWithParams, options)
		await handlePageResponse(response)
	}
	catch (err) {
		await handlePageError(err)
	}

	// While we've gathered less data than is available in total, keep requesting.
	// Keep a sanity check of the number of expected requests so we don't end up in an infinite loop spamming requests.
	let maxRequests = Math.ceil(totalResultItems / limitPerPage)
	let numRequests = 1		// We already sent one to kick this off.
	while (offset < totalResultItems && numRequests <= maxRequests) {
		urlWithParams.searchParams.set('offset', offset)
		try {
			numRequests++
			let response = await limitedFetch(urlWithParams, options)
			await handlePageResponse(response)
		}
		catch(err) {
			await handlePageError(err)
		}
	}
	
	return Promise.resolve(results)
}

/**
 * @async
 * Submits a request for a bearer token and caches it + the date it expires.
 * @returns {Promise<Boolean>} True if our cached bearer token is good, false if not.
 */
async function cacheBearerToken() {
	// If we have one cached and it's not expired, no need to do anything.
	let goodBearerToken = _requestHeaders.Authorization && _bearerTokenExpire > new Date()

	if (!goodBearerToken) {
		const tokenUrl = new URL('token', TCGPLAYER_API)
		try {
			const resp = 
				await limitedFetch(tokenUrl, {
					method: 'post',
					headers: new Headers({
						'Content-Type': 'x-www-form-urlencoded',
						'User-Agent': config.appName
					}),
					body: new URLSearchParams({
						'grant_type': 'client_credentials',
						'client_id': config.tcgPublicKey,
						'client_secret': config.tcgPrivateKey
					}),
				})
			
			const jsonResponse = await resp.json()
			if (jsonResponse.userName !== config.tcgPublicKey) {
				// This token isn't for us, don't know why we got it but don't use it.
				throw new Error('Received bearer token for another application, ignoring.')
			}

			if (jsonResponse.access_token) {
				_requestHeaders.Authorization = `${jsonResponse.token_type} ${jsonResponse.access_token}`
				_bearerTokenExpire = new Date(jsonResponse['.expires'])
				goodBearerToken = true
				logger.info('Cached new bearer token for TCGPlayer API.')
			}
			else throw new Error('Did not receive bearer token from TCGPlayer API.')
		}
		catch(err) {
			logError(err.message, 'Failed to get bearer token for TCGPlayer API.')
		}
	}
	
	return Promise.resolve(goodBearerToken)
}

/**
 * @async
 * Searches the TCGPlayer category catalog to find the ID of the Yu-Gi-Oh catalog,
 * which will be needed to send future search requests.
 * @returns {Promise<Boolean>} True if our cached Yu-Gi-Oh category ID is good, false if not.
 */
async function cacheYgoCategory() {
	// Nothing to do without a good bearer token to send requests with.
	if (!(await cacheBearerToken())) return false
	// If we have one cached, no need to do anything.
	let goodYgoCategory = _ygoCategoryId !== undefined

	if (!goodYgoCategory) {
		const catUrl = new URL(`${TCGPLAYER_API_VERSION}/catalog/categories`, TCGPLAYER_API)
		catUrl.searchParams.set('sortOrder', 'categoryId')
		try {
			const resp = await limitedFetch(catUrl)
			const jsonResponse = await resp.json()
			for (const cat of jsonResponse.results) {
				if (cat.name === 'YuGiOh') {
					_ygoCategoryId = cat.categoryId
					goodYgoCategory = true
					logger.info(`Found and cached TCGPlayer category ID for Yu-Gi-Oh as ${_ygoCategoryId}.`)
					break
				}
			}
			if (_ygoCategoryId === undefined) {
				throw new Error('Could not find TCGPlayer category ID for Yu-Gi-Oh.')
			}
		}
		catch(err) {
			logError(err.message, 'Failed to cache TCGPlayer category ID for Yu-Gi-Oh.')
		}
	}
	
	return Promise.resolve(goodYgoCategory)
}

async function cacheSetProductData(dataHandlerCallback) {
	// Nothing to do without knowing which catalog ID to search through.
	if (!await cacheYgoCategory()) return

	// Querying the TCGPlayer set catalog can produce paged values,
	// meaning we need to send multiple requests. Keep track of our final array of data here.
	/*
	const apiRequestOptions = {
		method: 'GET',
		url: `${TCGPLAYER_API_VERSION}/catalog/groups`,
		headers: requestHeaders,
		params: {
			categoryId: ygoCategoryId
		}
	}
	*/

	const setUrl = new URL(`${TCGPLAYER_API_VERSION}/catalog/groups`, TCGPLAYER_API)
	setUrl.searchParams.set('categoryId', _ygoCategoryId)
	const setResults = await handlePagedRequest(setUrl)
	// Something must have gone wrong.
	if (!setResults.length) {
		logError('Tried to cache set info, but didn\'t find any sets to cache.')
		return
	}

	logger.info(`Found ${setResults.length} TCGPlayer sets to check for data!`)

	const cachedProductData = getCachedProductData()

	const updatedSets = []
	// Gather the sets we need to cache or re-cache.
	for (const s of setResults) {
		const cachedSet = cachedProductData.sets[s.groupId]
		const modDate = new Date(s.modifiedOn)

		let setToModify = undefined
		if (!cachedSet) {
			setToModify = new TCGPlayerSet()
			cachedProductData.sets[s.groupId] = setToModify
		}
		else if (cachedSet.cacheTime < modDate) {
			setToModify = cachedSet
		}

		if (setToModify) {
			setToModify.setId = s.groupId
			setToModify.setCode = s.abbreviation
			setToModify.fullName = s.name
			setToModify.cacheTime = modDate

			updatedSets.push(setToModify)
		}
	}

	logger.info(`Found ${updatedSets.length} sets in need of product data updates.`)
	// Immediately throw these to the data handler so we have at least set name/info cached.
	dataHandlerCallback(updatedSets)

	// Now start a slow crawl of set data for the sets that were updated.
	if (updatedSets.length) {
		const handleSetDataResponse = results => {
			// The results will be all the products in this set. Parse them and cache them.
			const updatedProducts = []
	
			for (const p of results) {
				const cachedProduct = cachedProductData.products[p.productId]
				const modDate = new Date(p.modifiedOn)
	
				let prodToModify = null
				if (!cachedProduct) {
					prodToModify = new TCGPlayerProduct()
					cachedProductData.products[p.productId] = prodToModify
				}
				else if (cachedProduct.cacheTime < modDate) {
					prodToModify = cachedProduct
				}
	
				if (prodToModify) {
					prodToModify.productId = p.productId
					prodToModify.fullName = p.name.split('(')[0].trim()		// Ignore anything parenthetical, TCGPlayer likes adding things to the name.
					prodToModify.set = cachedProductData.sets[p.groupId]
					prodToModify.cacheTime = modDate
					// Rarity and print code are in the extended fields.
					if (p.extendedData) {
						for (const eField of p.extendedData) {
							// There are quite a few extended fields, stop iterating once we've found what we need.
							if (prodToModify.printCode && prodToModify.rarity) break
							// Print code is stored as "Number".
							if (eField.name === 'Number') {
								prodToModify.printCode = eField.value
							}
							else if (eField.name === 'Rarity') {
								prodToModify.rarity = eField.value
							}
						}
						updatedProducts.push(prodToModify)
					}
				}
			}
	
			if (updatedProducts.length)
				logger.info(`Updating product info for ${updatedProducts.length} products.`)
			dataHandlerCallback(updatedProducts)
		}

		// Split the sets into batches of 3 to send requests about, max one batch per second (though a batch might take longer if it's paged).
		// Some might be paged so they end up needing more requests. Even if not, 3 requests/sec leaves bandwidth for bot queries in the meantime.
		const numPerBatch = 3
		const numBatches = Math.ceil(updatedSets.length / numPerBatch) 
		const requestBatches = Array(numBatches).fill().map((val, index) => {
			const offset = index * numPerBatch
			return updatedSets.slice(offset, offset + numPerBatch)
		})

		const timer = ms => new Promise(res => setTimeout(res, ms))
		for (const setBatch of requestBatches) {
			let batchRequests = []
			for (const set of setBatch) {
				// Set data and price requests are paged, need to set up options beforehand.
				/*
				const setDataRequestOptions = {
					method: 'get',
					url: `${TCGPLAYER_API_VERSION}/catalog/products`,
					headers: requestHeaders,
					params: {
						groupId: set.setId,
						getExtendedFields: true
					}
				}
				*/
				const prodUrl = new URL(`${TCGPLAYER_API_VERSION}/catalog/products`, TCGPLAYER_API)
				prodUrl.searchParams.set('groupId', set.setId)
				prodUrl.searchParams.set('getExtendedFields', true)
				batchRequests.push(handlePagedRequest(prodUrl))
			}

			const startTime = performance.now()
			// Throw all our results into one big array to process the results at once.
			const allResults = []
			batchRequests = await Promise.allSettled(batchRequests)
			for (const req of batchRequests) {
				// Something went wrong here, it should've already been logged out.
				if (req.status === 'rejected') continue
				if (!req.value.length) continue

				allResults.push(...req.value)
			}
			handleSetDataResponse(allResults)
			const totalTime = performance.now() - startTime
			// Always wait a minimum of 1 second between batches.
			if (totalTime < 1000)
				await timer(1000 - totalTime)
		}

		logger.info(`Finished caching product data for ${updatedSets.length} updated sets.`)
	}
}

/**
 * Resolves price data for the given TCGPlayerProducts.
 * @param {Array<TCGPlayerProduct>} products  
 */
async function getProductPriceData(products) {
	// Nothing to do without a good bearer token to send requests with.
	if (!(await cacheBearerToken())) return false

	// Make a map out of these for easy lookup once we have our results.
	const prodMap = {}
	for (const p of products)
		prodMap[p.productId] = p
	// Turn all the product IDs into a comma-separated string for the API request.
	const prodIds = Object.keys(prodMap).join(',')

	try {
		const priceUrl = new URL(`${TCGPLAYER_API_VERSION}/pricing/product/${prodIds}`, TCGPLAYER_API)
		const resp = await limitedFetch(priceUrl)
		const jsonResponse = await resp.json()
		for (const r of jsonResponse.results) {
			// Skip the results that have null price data due the type of print being non-existent (e.g., no 1st Edition prints).
			if (!r.lowPrice || !r.midPrice || !r.highPrice || !r.marketPrice) continue

			const prodId = r.productId
			const origProduct = prodMap[prodId]

			const pd = new TCGPlayerPrice()
			pd.type = r.subTypeName
			pd.lowPrice = r.lowPrice
			pd.midPrice = r.midPrice
			pd.highPrice = r.highPrice
			pd.marketPrice = r.marketPrice
			pd.updateCacheTime(new Date())

			origProduct.priceData.push(pd)
		}
	}
	catch(err) {
		logError(err.message, 'TCGPlayer price API query failed.', products)
	}
}

/**
 * Resolves price data for the given TCGPlayerProducts.
 * @param {Array<TCGPlayerSet>} sets
 */
 async function getSetPriceData(sets) {
	// Nothing to do without a good bearer token to send requests with.
	if (!(await cacheBearerToken())) return false
	
	// Make a map out of the products in these sets for easy future lookups.
	const prodMap = {}
	for (const s of sets)
		for (const p of s.products)
			prodMap[p.productId] = p

	let apiRequests = []
	for (const s of sets) {
		const priceUrl = new URL(`${TCGPLAYER_API_VERSION}/pricing/group/${s.setId}`, TCGPLAYER_API)
		apiRequests.push(
			limitedFetch(priceUrl)
				.then(async r => await r.json())
		)
	}

	apiRequests = await Promise.allSettled(apiRequests)
	for (let i = 0; i < apiRequests.length; i++) {
		const resp = apiRequests[i]
		if (resp.status === 'rejected') {
			logError(resp.reason.message, `TCGPlayer set price API query for set ${origSet} failed.`)
			continue
		}
		// These promises return in the same order we sent the requests in.
		// Map this response to its corresponding set that way.
		const origSet = sets[i]

		for (const r of resp.value.results) {
			// Skip the results that have null price data due the type of print being non-existent (e.g., no 1st Edition prints).
			if (!r.lowPrice || !r.midPrice || !r.highPrice || !r.marketPrice) continue

			const prodId = r.productId
			const origProduct = prodMap[prodId]

			const pd = new TCGPlayerPrice()
			pd.type = r.subTypeName
			pd.lowPrice = r.lowPrice
			pd.midPrice = r.midPrice
			pd.highPrice = r.highPrice
			pd.marketPrice = r.marketPrice
			pd.updateCacheTime(new Date())
			
			origProduct.priceData.push(pd)
		}
	}
}

async function searchTcgplayer(searches, qry, dataHandlerCallback) {
	// The searches that made it this far don't have price data.
	// For cards, get the products within them that it so we can use them.
	const productsWithoutPriceData = []
	// For sets, just hit the group price data endpoint.
	const setsWithoutPriceData = []

	// First search through the persistent data we've saved off.
	searchTcgplayerData(searches)

	for (const s of searches) {
		// Sanity check. We shouldn't get non-TCGPlayer searches here, but just in case, discard them anyway.
		if (!s.hasType('$')) continue
		// Don't know what this is, nothing to search for.
		if (!s.data) continue

		if (s.data instanceof TCGPlayerSet) {
			if (!s.data.hasResolvedPriceData())
				setsWithoutPriceData.push(s.data)
		}
		else {
			let prods = s.data.getProductsWithoutPriceData()
			// Filter out any that don't have product IDs.
			// We could look them up by name, but with all the product data caching we do, we shouldn't need to.
			prods = prods.filter(p => p.productId)
	
			productsWithoutPriceData.push(...prods)
		}
	}
	
	// Now we have all the products we need to grab data for, hit the API for that data.
	if (productsWithoutPriceData.length)
		await getProductPriceData(productsWithoutPriceData)
	if (setsWithoutPriceData.length)
		await getSetPriceData(setsWithoutPriceData)

	// Done here.
	dataHandlerCallback(searches)
}

module.exports = {
	cacheSetProductData, searchTcgplayer
}