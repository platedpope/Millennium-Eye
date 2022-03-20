const axios = require('axios')

const { Languages, YGORG_NAME_ID_INDEX, YGORG_LOCALE_METADATA } = require('lib/models/Defines')
const { logError, logger } = require('lib/utils/logging')

const nameToIdIndex = {}
let localePropertyMetadata = undefined

/**
 * Saves off the YGORG card name -> ID search index for all languages.
 * @param {Array<String>} language An array of languages to query the search index for.
 */
async function cacheNameToIdIndex(lans = Object.keys(Languages)) {
	const apiRequests = []

	for (const l of lans) {
		const lanIndex = axios.get(`${YGORG_NAME_ID_INDEX}/${l}`, {
			'timeout': 3 * 1000
		}).then(r => {
			if (r.status === 200) return r
			throw new Error(`Something went wrong (status code ${r.status}) querying YGOrg DB's name index for language ${l}`)
		})

		apiRequests.push(lanIndex)
	}

	// Track results for logging.
	const successfulRequests = []

	const indices = await Promise.allSettled(apiRequests)
	for (let i = 0; i < indices.length; i++) {
		const index = indices[i]
		// These promises are returned in the same order as they were in the given lans parameter.
		// Use that to map each response to a given language.
		const indexLanguage = lans[i]

		if (index.status === 'rejected') {
			logError(index.reason, `Failed to refresh cached YGORG name->ID index for language ${indexLanguage}.`)
			continue
		}

		nameToIdIndex[indexLanguage] = index.value.data
		successfulRequests.push(indexLanguage)
	}

	if (successfulRequests.length)
		logger.info(`Refreshed cached YGOrg name->ID index for language(s): ${successfulRequests.join(', ')}`)
}

/**
 * Saves off the YGOrg localization metadata for properties and types.
 */
async function cacheLocaleMetadata() {
	await axios.get(YGORG_LOCALE_METADATA, {
		'timeout': 3 * 1000
	}).then(r => {
		if (r.status === 200) {
			localePropertyMetadata = {}
			// Rejig this metadata, it comes in as an array but I want to pull out the EN values
			// to make them keys in a map for easy future lookups.
			for (const prop of r.data) {
				if (!prop) continue
				else if (!('en' in prop)) continue

				// Pull out the EN property name and make it a key.
				const enProp = prop['en']
				localePropertyMetadata[enProp] = {}
				for (const lan in prop) {
					if (lan === 'en') continue
					// Make the other language property names their own keys under EN.
					localePropertyMetadata[enProp][lan] = prop[lan]
				}
			}
			logger.info('Successfully cached YGOrg DB locale property metadata.')
		}
		// throw new Error(`Something went wrong (status code ${r.status}) querying YGOrg DB's localization metadata.`)
	}).catch(e => {
		logError(e, 'Failed getting locale metadata.')
	})
}

/**
 * Searches the locale property metadata to map an English type(s) to its version in another language.
 * @param {String | Array<String>} type The type(s) in English.
 * @param {String} language The language's version of the type to search for.
 * @returns {String | Array<String>} The type(s) in the given language.
 */
function searchLocalePropertyMetadata(type, language) {
	// Not cached for some reason, nothing we can do.
	if (localePropertyMetadata === undefined) return

	let types = []

	// If we're just converting the one type, return immediately once we find it.
	if (typeof type === 'string' && type in localePropertyMetadata)
		return localePropertyMetadata[type][language]
	else {
		// Otherwise, loop through our types to map each of them to the proper value.
		for (const t of type) {
			if (t in localePropertyMetadata)
				types.push(localePropertyMetadata[t][language])
		}
	}

	return types
}

module.exports = {
	cacheNameToIdIndex, cacheLocaleMetadata, searchLocalePropertyMetadata
}