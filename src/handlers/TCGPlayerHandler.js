const axios = require('axios')
const rateLimit = require('axios-rate-limit')
const { performance } = require('perf_hooks')

const config = require('config')
const { getCachedProductData } = require('./BotDBHandler')
const { TCGPLAYER_API, API_TIMEOUT, TCGPLAYER_API_VERSION } = require('lib/models/Defines')
const { TCGPlayerSet, TCGPlayerProduct } = require('lib/models/TCGPlayer')
const { logError, logger } = require('lib/utils/logging')

const requestHeaders = {
	'accept': 'application/json',
	'User-Agent': config.appName,
	// Will have Authorization field filled in with the bearer token once we have it.
}
// TCGPlayer API limits to 300 requests/min, i.e., 6 per second.
// Try not to piss them off. :)
const apiCall = rateLimit(axios.create({
	baseURL: `${TCGPLAYER_API}/`,
	timeout: API_TIMEOUT * 1000
}), {
	maxRequests: 6,
	perMilliseconds: 1000
})
// Cached bearer token expiration to make sure we refresh it when we need to. 
let bearerTokenExpire = undefined
// Cached TCGPlayer Yu-Gi-Oh category ID so we query the correct category.
let ygoCategoryId = undefined

/**
 * @async
 * Some API requests to TCGPlayer are paged, meaning the total number of results they could return
 * is greater than the number of results a single API response can give.
 * This function exists to handle requests that could potentially result in paged data
 * by repeatedly sending requests at increasing offsets until all necessary data is gathered
 * (or until we reach a request hard cap, whichever happens first).
 * @param {Object} apiRequestOptions The axios request options to use for the query.
 * @param {Number} limitPerPage The maximum number of results per response. Defaults to 100, which is the TCGPlayer maximum.
 * @returns {Promise<Array>} All gathered responses.
 */
async function handlePagedRequest(apiRequestOptions, limitPerPage = 100) {
	const results = []
	let totalResultItems = 0
	// Offset is increased as we get responses to move through the "pages".
	// When offset equals the total number of results we got, then our paged requests is complete.
	let offset = 0

	// Set our limit parameter.
	apiRequestOptions.params.limit = limitPerPage

	const handleResponse = respData => {
		if (!totalResultItems) totalResultItems = respData.totalItems

		results.push(...respData.results)
		offset += respData.results.length
	}

	// Need to send the first request so we know what the total we have to deal with is.
	try {
		let response = await apiCall(apiRequestOptions)
		handleResponse(response.data)
	}
	catch (err) {
		const errData = err.response.data
		// Suppress "no products found" errors. Sometimes there just aren't any, not an error.
		const noProductsFoundError = errData.errors && errData.errors.length && errData.errors[0] === 'No products were found.'
		if (!noProductsFoundError)
			logError(errData, 'Received failed paged result:', apiRequestOptions)
	}

	// While we've gathered less data than is available in total, keep requesting.
	// Keep a sanity check of the number of expected requests so we don't end up in an infinite loop spamming requests.
	let maxRequests = Math.ceil(totalResultItems / limitPerPage)
	let numRequests = 1		// We already sent one to kick this off.
	while (offset < totalResultItems && numRequests <= maxRequests) {
		apiRequestOptions.params.offset = offset
		try {
			numRequests++
			let response = await apiCall(apiRequestOptions)
			handleResponse(response.data)
		}
		catch(err) {
			const errData = err.response.data
			// Suppress "no products found" errors. Sometimes there just aren't any, not an error.
			const noProductsFoundError = errData.errors && errData.errors.length && errData.errors[0] === 'No products were found.'
			if (!noProductsFoundError)
				logError(errData, 'Received failed paged result:', apiRequestOptions)
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
	let goodBearerToken = requestHeaders.Authorization && bearerTokenExpire > new Date()

	const handleResponse = respData => {
		if (respData.userName !== config.tcgPublicKey)
			// This token isn't for us, don't know why we got it but don't use it.
			throw new Error('Received bearer token for another application, ignoring.')
		
		if (respData.access_token) {
			requestHeaders.Authorization = `${respData.token_type} ${respData.access_token}`
			bearerTokenExpire = new Date(respData['.expires'])
			logger.info(`Cached new bearer token for TCGPlayer API.`)
			goodBearerToken = true
		}
		else throw new Error('Did not receive bearer token from TCGPlayer API.')
	}

	if (!goodBearerToken)
		try {
			const response = 
				await apiCall.post('token', 
				`grant_type=client_credentials&client_id=${config.tcgPublicKey}&client_secret=${config.tcgPrivateKey}`,
				{
					headers: {
						'Content-Type': 'x-www-form-urlencoded',
						'User-Agent': config.appName
					}
				})
			handleResponse(response.data)
		}
		catch(err) {
			const errObj = err.response ? err.response.data : err
			logError(errObj, 'Failed to get bearer token for TCGPlayer API.')
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
	let goodYgoCategory = ygoCategoryId !== undefined

	const handleResponse = respData => {
		if (respData && respData.success === true) {
			for (const category of respData.results)
				if (category.name === 'YuGiOh') {
					ygoCategoryId = category.categoryId
					logger.info(`Found and cached TCGPlayer category ID for Yu-Gi-Oh as ${ygoCategoryId}.`)
					goodYgoCategory = true
					break
				}
			if (ygoCategoryId === undefined)
				throw new Error('Could not find TCGPlayer category ID for Yu-Gi-Oh.')
		}
		else throw new Error(`Category catalog request for TCGPlayer API failed: ${JSON.stringify(respData, null, 4)}`)
	}

	if (!goodYgoCategory)
		try {
			const response = await apiCall.get(`${TCGPLAYER_API_VERSION}/catalog/categories`, {
				headers: requestHeaders,
				params: { sortOrder: 'categoryId' }
			})
			handleResponse(response.data)
		}
		catch(err) {
			const errObj = err.response ? err.response.data : err
			logError(errObj, 'Failed to cache TCGPlayer category ID for Yu-Gi-Oh.')
		}
	
	return Promise.resolve(goodYgoCategory)
}

async function cacheSetProductData(dataHandlerCallback) {
	// Nothing to do without knowing which catalog ID to search through.
	if (!await cacheYgoCategory()) return

	// Querying the TCGPlayer set catalog can produce paged values,
	// meaning we need to send multiple requests. Keep track of our final array of data here.
	const apiRequestOptions = {
		method: 'GET',
		url: `${TCGPLAYER_API_VERSION}/catalog/groups`,
		headers: requestHeaders,
		params: {
			categoryId: ygoCategoryId
		}
	}
	const setResults = await handlePagedRequest(apiRequestOptions)

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

		if (!cachedSet) {
			var setToModify = new TCGPlayerSet()
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
	
				if (!cachedProduct) {
					var prodToModify = new TCGPlayerProduct()
					cachedProductData.products[p.productId] = prodToModify
				}
				else if (cachedProduct.cacheTime < modDate) {
					prodToModify = cachedProduct
				}
	
				if (prodToModify) {
					prodToModify.productId = p.productId
					prodToModify.fullName = p.name
					prodToModify.set = cachedProductData.sets[p.groupId]
					prodToModify.cacheTime = modDate
					// Rarity and print code are in the extended fields.
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
				const setDataRequestOptions = {
					method: 'get',
					url: `${TCGPLAYER_API_VERSION}/catalog/products`,
					headers: requestHeaders,
					params: {
						groupId: set.setId,
						getExtendedFields: true
					}
				}
				const req = handlePagedRequest(setDataRequestOptions)
				batchRequests.push(req)
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
	// Make a map out of these for easy lookup once we have our results.
	const prodMap = {}
	for (const p of products)
		prodMap[p.productId] = p
	// Turn all the product IDs into a comma-separated string for the API request.
	const prodIds = Object.keys(prodMap).join(',')

	const handlePriceResponse = respData => {
		for (const r of respData.results) {
			// Skip the reuslts that have null price data due the type of print being non-existent (e.g., no 1st Edition prints).
			if (!r.lowPrice || !r.midPrice || !r.highPrice || !r.marketPrice) continue

			const prodId = r.productId
			const origProduct = prodMap[prodId]
			origProduct.priceData.set(r.subTypeName, {
				lowPrice: r.lowPrice,
				midPrice: r.midPrice,
				highPrice: r.highPrice,
				marketPrice: r.highPrice
			})
			origProduct.cacheTime = new Date()
		}
	}

	try {
		const resp = await apiCall.get(`${TCGPLAYER_API_VERSION}/pricing/product/${prodIds}`, {
			headers: requestHeaders
		})
		handlePriceResponse(resp.data)
	}
	catch(err) {
		logError(err.response, 'TCGPlayer price API query failed.', products)
	}
}

async function searchTcgplayer(searches, qry, dataHandlerCallback) {
	// The searches that made it this far don't have price data.
	// Get the products within them that it so we can use them.
	const productsWithoutPriceData = []
	for (const s of searches) {
		let prods = s.data.getProductsWithoutPriceData()
		// Filter out any that don't have product IDs.
		// We could look them up by name, but with all the product data caching we do, we shouldn't need to.
		prods = prods.filter(p => p.productId)

		productsWithoutPriceData.push(...prods)
	}
	
	// Now we have all the products we need to grab data for, hit the API for that data.
	await getProductPriceData(products)

	// Done here.
	dataHandlerCallback(searches)
}

module.exports = {
	cacheSetProductData, searchTcgplayer
}