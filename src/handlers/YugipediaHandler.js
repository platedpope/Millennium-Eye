const axios = require('axios')
const { YUGIPEDIA_API, YUGIPEDIA_API_PARAMS, API_TIMEOUT, YUGIPEDIA_API_IMAGE_PARAMS } = require('lib/models/Defines')
const { logError, logger } = require('lib/utils/logging')
const Search = require('lib/models/Search')
const Query = require('lib/models/Query')

/**
 * Search using MediaWiki API on Yugipedia to resolve the given searches.
 * If any match is found, we use its data to first backcheck in the bot and Konami databases
 * to make sure it's not in there and was missed due to a new search term.
 * @param {Array<Search>} searches The array of searches to evaluate.
 * @param {Query} qry The query that contains all searches to evaluate.
 * @param {Function} dataHandlerCallback The callback for handling the data produced by this search.
 */
async function searchYugipedia(searches, qry, dataHandlerCallback) {
	// Nothing to check beforehand, if we got this far just send requests right away.
	let apiReqs = []
	for (const s of searches) {
		YUGIPEDIA_API_PARAMS.gsrsearch = s.term 
		const req = axios.get(YUGIPEDIA_API, {
			'timeout': API_TIMEOUT * 1000,
			'params': YUGIPEDIA_API_PARAMS
		}).then(r => {
			if (r.status === 200) return r
		}).catch(err => {
			throw new Error(`Yugipedia API query for term ${s.term} failed.`)
		})

		apiReqs.push(req)
	}
	// Reset the search in the API parameters.
	delete YUGIPEDIA_API_PARAMS.gsrsearch

	if (apiReqs.length) 
		apiReqs = await Promise.allSettled(apiReqs)

	for (let i = 0; i < apiReqs.length; i++) {
		const apiResponse = apiReqs[i]
		// These promises return in the same order we sent the requests.
		// Map this response to its corresponding search that way.
		const apiSearch = searches[i]

		if (apiResponse.status === 'rejected') {
			logError(apiResponse.reason, `Yugipedia API query for term ${apiSearch.term} failed.`)
			continue
		}

		const responseData = apiResponse.value.data
		if (responseData && Object.keys(responseData).length) 
			if ('query' in responseData) {
				const qryData = responseData.query
				apiSearch.tempData = qryData
			}
		if (apiSearch.tempData === undefined)
			logger.info(`Yugipedia API query for term ${apiSearch.term} found nothing.`)
	}

	dataHandlerCallback(searches, qry)
}

module.exports = {
	searchYugipedia
}