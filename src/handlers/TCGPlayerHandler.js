const axios = require('axios')

const config = require('config')
const { TCGPLAYER_API, API_TIMEOUT, TCGPLAYER_API_VERSION } = require('lib/models/Defines')
const { logError, logger } = require('lib/utils/logging')

const requestHeaders = {
	'accept': 'application/json',
	'User-Agent': config.appName,
	'Authorization': undefined	// Will be filled in with the bearer token once we have it.
}
let bearerTokenExpire = undefined
let ygoCategoryId = undefined
let searchManifest = {
	'sortOptions': {},
	'filterOptions': {}
}

/**
 * @async
 * Submits a request for a bearer token and caches it + the date it expires.
 * @returns {Promise<Boolean>} True if our cached bearer token is good, false if not.
 */
async function cacheBearerToken() {
	// If we have one cached and it's not expired, no need to do anything.
	let goodBearerToken = requestHeaders.Authorization !== undefined && bearerTokenExpire > new Date()
	
	// Otherwise, request and cache it.
	if (!goodBearerToken)
		await axios({
			method: 'POST',
			url: `${TCGPLAYER_API}/token`,
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				'User-Agent': config.appName
			},
			data: `grant_type=client_credentials&client_id=${config.tcgplayerPublicKey}&client_secret=${config.tcgplayerPrivateKey}`,
			timeout: API_TIMEOUT * 1000
		}).then(r => {
			const respData = r.data
			if (respData.userName !== config.tcgplayerPublicKey)
				// This token isn't for us, don't know why we got it but don't use it.
				throw new Error('Received bearer token for another application, ignoring.')
			
			if (respData.access_token) {
				requestHeaders.Authorization = `${respData.token_type} ${respData.access_token}`
				bearerTokenExpire = new Date(respData._expires)
				logger.info(`Cached new bearer token for TCGPlayer API.`)
				goodBearerToken = true
			}
			else throw new Error('Did not receive bearer token from TCGPlayer API.')
		}).catch(err => {
			const errObj = err.response ? err.response.data : err
			logError(errObj, 'Failed to get bearer token for TCGPlayer API.')
		})
	
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

	let goodYgoCategory = ygoCategoryId !== undefined

	if (!goodYgoCategory)
		await axios.get(`${TCGPLAYER_API}/${TCGPLAYER_API_VERSION}/catalog/categories?sortOrder=categoryId`, {
			headers: requestHeaders,
			timeout: API_TIMEOUT * 1000
		}).then(r => {
			const respData = r.data
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
		}).catch(err => {
			const errObj = err.response ? err.response.data : err
			logError(errObj, 'Failed to cache TCGPlayer category ID for Yu-Gi-Oh.')
		})
	
	return Promise.resolve(goodYgoCategory)
}

/**
 * @async
 * Caches the search manifest associated with Yu-Gi-Oh so we know exactly what options are available
 * to send to it for future searches.
 * @returns {Promise<Boolean>} True if our cached search manifest is populated, false if not.
 */
async function cacheSearchManifest() {
	// Nothing to do without know which catalog ID to search through.
	if (!(await cacheYgoCategory())) return false

	let goodSearchManifest = Object.keys(searchManifest.sortOptions).length && 
							 Object.keys(searchManifest.filterOptions).length

	if (!goodSearchManifest)
		await axios.get(`${TCGPLAYER_API}/${TCGPLAYER_API_VERSION}/catalog/categories/${ygoCategoryId}/search/manifest`, {
			headers: requestHeaders,
			timeout: API_TIMEOUT * 1000
		}).then(r => {
			const respData = r.data
			if (respData && respData.success === true) {
				const manifest = respData.results[0]

				// Organize these into something the bot can use more easily.
				for (const sortOption of manifest.sorting) {
					// Sort options have two values: display name and value.
					// Map display name -> value for easy lookup.
					searchManifest.sortOptions[sortOption.text] = sortOption.value
				}
				for (const filterOption of manifest.filters) {
					// Filters have 4 values: name (i.e, value), display name, input type, and items (or options).
					// Items (if any) have display name and value. Map those display name -> value for easy lookup.
					const filterItems = {}
					for (const item of filterOption.items)
						filterItems[item.text] = item.value
					// Map display name -> name and items (if any). Don't care about input type.
					searchManifest.filterOptions[filterOption.displayName] = {
						name: filterOption.name,
						items: filterItems
					}
				}
			}
			else throw new Error(`Search manifest request from TCGPlayer API failed: ${JSON.stringify(respData, null, 4)}`)
		}).catch(err => {
			const errObj = err.response ? err.response.data : err
			logError(errObj, 'Failed to cache TCGPlayer search manifest.')
		})
	
	return Promise.resolve(goodSearchManifest)
}

async function resolveProductIds(searches) {

}

async function resolveProductSkus(searches) {

}

async function resolveSkuPrices(searches) {

}

async function searchTcgplayer(searches, qry, dataHandlerCallback) {
	// Nothing to do without knowing our available filters and searches.
	if (!(await cacheSearchManifest())) return

	// Some of these searches might have product IDs already from something we cached.
	// Split off the ones that don't so we can resolve those.
	const productIdSearches = searches.filter(s => !s.data.priceData.tcgplayerProductId)
	if (productIdSearches.length) await resolveProductIds(productIdSearches)

	// By this point we have all product IDs. We don't cache SKUs, so resolve those using our IDs.
	await resolveProductSkus(searches)

	// And now with SKUs resolved, get the market price for them.
	await resolveSkuPrices(searches)
}

module.exports = {
	cacheSearchManifest, searchTcgplayer
}