const axios = require('axios')
const Database = require('better-sqlite3')

const Search = require('lib/models/Search')
const { Locales, YGORG_NAME_ID_INDEX, YGORG_PROPERTY_METADATA, YGORG_DB_PATH, YGORG_MANIFEST, YGORG_QA_DATA_API, API_TIMEOUT, YGORG_CARD_DATA_API, YGORG_ARTWORK_API } = require('lib/models/Defines')
const { evictFromBotCache, botDb } = require('handlers/BotDBHandler')
const { logError, logger } = require('lib/utils/logging')
const { CardDataFilter } = require('lib/utils/search')

const ygorgDb = new Database(YGORG_DB_PATH)

let cachedRevision = undefined
const nameToIdIndex = {}
// The property array is the raw data returned by the YGOrg API and is used for its own API.
// The propertyToLocaleIndex is that data converted into a map for easy type lookups for the bot's purposes.
// Both are used at various places in the bot logic, so both are cached.
let propertyArray = []
const propertyToLocaleIndex = {}

let artworkManifest = {}

/**
 * Caches the most recent manifest revision we know about.
 * @param {Number} newRevision The new revision number. 
 */
function cacheManifestRevision(newRevision) {
	db = new Database(YGORG_DB_PATH)
	// First time, have to load this from the DB.
	if (newRevision === undefined && cachedRevision === undefined) {
		const dbData = ygorgDb.prepare('SELECT * FROM manifest').get()
		if (dbData)
			cachedRevision = dbData.lastKnownRevision
	}
	else {
		ygorgDb.prepare('DELETE FROM manifest').run()
		ygorgDb.prepare('INSERT INTO manifest(lastKnownRevision) VALUES (?)').run(newRevision)
		cachedRevision = newRevision
	}

	if (cachedRevision)
		logger.info(`Cached YGOrg manifest revision ${cachedRevision}.`)
}

/**
 * Processes a manifest revision returned by a YGOrg DB query.
 * Invalidates all necessary cached values based on what the changes report.
 * NOTE: nothing is re-cached afterward, that will only happen on future requests for that data.
 * @param {Number} revision The revision number to compare to our cached one.
 */
async function processManifest(newRevision) {
	// If we've cached something more recent or as recent, nothing to do.
	if (cachedRevision >= newRevision) return

	// Otherwise, get manifest data to see if we need to make any changes.
	await axios.get(`${YGORG_MANIFEST}/${cachedRevision}`, {
		'timeout': API_TIMEOUT * 1000
	}).then(r => {
		if (r.status === 200) {
			logger.info(`Processing new manifest revision ${newRevision}...`)
			const changes = r.data.data 

			if (changes) {
				// Card data updates: no way to tell what exactly has changed,
				// so just invalidate any data stored in the bot or YGOrg databases.
				// (Don't invalidate anything from the Konami database.)
				if ('card' in changes) {
					const evictIds = Object.keys(changes.card)
					// Delete any FAQ data from YGOrg DB.
					const delFaq = ygorgDb.prepare('DELETE FROM faqData WHERE dbId = ?')
					const delMany = ygorgDb.transaction(ids => {
						for (const id of ids) delFaq.run(id)
					})
					delMany(evictIds)
					// Delete any bot-specific data.
					// This is here to avoid circular dependency. Not pretty...
					evictFromBotCache(evictIds)

					logger.info(`Evicted all FAQ and cached bot data associated with database IDs: ${evictIds.join(', ')}`)
				}
				// Invalidate cached QA data.
				if ('qa' in changes) {
					const evictQas = Object.keys(changes.qa)

					const delQa = ygorgDb.prepare('DELETE FROM qaData WHERE qaId = ?')
					const delCards = ygorgDb.prepare('DELETE FROM qaCards WHERE qaId = ?')
					const delMany = ygorgDb.transaction(ids => {
						for (const id of ids) {
							delQa.run(id)
							delCards.run(id)
						}
					})
					delMany(evictQas)

					logger.info(`Evicted all QA data for QA IDs: ${evictQas.join(', ')}`)
				}
				// Invalidate any cached indices we care about.
				if ('idx' in changes) {
					const idxChanges = changes.idx
					if ('name' in idxChanges) {
						logger.info(`Evicted locales ${Object.keys(idxChanges).join(', ')} from name index.`)
						for (l in idxChanges.name) delete nameToIdIndex[l]
					}
				}
			}

			cacheManifestRevision(newRevision)
		}
		else throw new Error(`YGOrg DB returned bad status (${r.status}) when trying to update manifest.`)
	}).catch(err => {
		logError(err, 'Failed processing YGOrg DB manifest.')
	})
}

/**
 * Search the YGOrg database to resolve card data.
 * This will both look in our local database for QA or FAQ data,
 * as well as query the API as necessary to resolve any other data.
 * @param {Array<Search>} searches
 */
async function searchYgorgDb(searches, qry, callback) {
	const qaSearches = {
		'db': [],
		'api': [],
	}
	// If we're in YGOrg DB, cards always come from the API.
	const cardSearches = []

	// Track any searches we can't resolve locally and need to use the API for.
	const qaApiSearches = []
	const cardApiSearches = []

	// First search locally for any searches that might direct here.
	for (const currSearch of searches) {
		let isQaSearch = currSearch.hasType('q')
		let isFaqSearch = currSearch.hasType('f')
		if (!isQaSearch && !isFaqSearch) {
			// Only FAQ and QA searches have relevant data to be found in here.
			// Anything else is going to need API work.
			cardApiSearches.push(currSearch)
			continue
		}
		
		if (isQaSearch) {
			const dbRows = ygorgDb.prepare('SELECT * FROM qaData WHERE qaId = ?').all(currSearch.term)
			if (dbRows.length) {
				currSearch.data = dbRows
				qaSearches.db.push(currSearch)
			}
			else
				// If there's nothing in the DB, go to the API.
				qaApiSearches.push(currSearch)
		}
		else if (isFaqSearch) {
			const dbRows = ygorgDb.prepare('SELECT * FROM faqData WHERE dbId = ?').all(currSearch.term)
			if (dbRows.length) {
				if (currSearch.data === undefined) 
					// How the hell did we get this far with unresolved card data? This shouldn't happen.
					cardApiSearches.push(currSearch)
				else 
					for (const r of dbRows) {
						if (!currSearch.data.faqData.has(r.locale))
							currSearch.data.faqData.set(r.locale, [])
						currSearch.data.faqData.get(r.locale).push(r.data)
					}
			}
			else
				// If there's nothing in the DB, go to the API.
				cardApiSearches.push(currSearch)
		}
	}

	// If we don't have anything to do with the API, just bail out early.
	if (!qaApiSearches.length && !cardApiSearches.length && qaSearches.db.length) {
		await callback(qaSearches)
		return
	}

	// Kick off any API searches we have to deal with.
	const qaRequests = []
	const cardRequests = []
	for (const qaSearch of qaApiSearches) {
		const qaId = qaSearch.term
		const req = axios.get(`${YGORG_QA_DATA_API}/${qaId}`, {
			'timeout': API_TIMEOUT * 1000
		}).then(r => {
			if (r.status === 200) return r
		}).catch(err => {
			throw new Error(`YGOrg API card query for ID ${cardId} returned nothing.`)
		})

		qaRequests.push(req)
	}
	for (const cardSearch of cardApiSearches) {
		const cardId = cardSearch.term
		const req = axios.get(`${YGORG_CARD_DATA_API}/${cardId}`, {
			'timeout': API_TIMEOUT * 1000
		}).then(r => {
			if (r.status === 200) return r
		}).catch(err => {
			throw new Error(`YGOrg API card query for ID ${cardId} returned nothing.`)
		})

		cardRequests.push(req)
	}

	// Process any new manifest revision(s) first so we evict anything before repopulating.
	if (qaRequests.length) {
		var qaApiData = await Promise.allSettled(qaRequests)
		const goodReq = qaApiData.find(r => r.status === 'fulfilled')
		if (goodReq)
			processManifest(goodReq.value.headers['x-cache-revision'])
	}
	if (cardRequests.length) {
		var cardApiData = await Promise.allSettled(cardRequests)
		const goodReq = cardApiData.find(r => r.status === 'fulfilled')
		if (goodReq)
			processManifest(goodReq.value.headers['x-cache-revision'])
	}
	
	if (qaApiData) {
		for (let i = 0; i < qaApiData.length; i++) {
			const qaResponse = qaApiData[i]
			// These promises return in the same order we sent the requests in.
			// Map this response to its corresponding search that way.
			const qaSearch = qaApiSearches[i]

			if (qaResponse.status === 'rejected') {
				logError(qaResponse.reason, `YGOrg API query for QA ID ${qaSearch.term} failed.`)
				continue
			}

			if (qaResponse.value.data && Object.keys(qaResponse.value.data).length) {
				qaSearch.data = qaResponse.value.data
				qaSearches.api.push(qaSearch)
			}
		}
	}
	if (cardApiData) {
		for (let i = 0; i < cardApiData.length; i++) {
			const cardResponse = cardApiData[i]
			// These promises return in the same order we sent the requests in.
			// Map this response to its corresponding search that way.
			const cardSearch = cardApiSearches[i]

			if (cardResponse.status === 'rejected') {
				logError(cardResponse.reason, `YGOrg API query for card ID ${cardSearch.term} failed.`)
				continue
			}

			if (cardResponse.value.data && Object.keys(cardResponse.value.data).length) {
				cardSearch.tempData = cardResponse.value.data
				cardSearches.push(cardSearch)
			}
		}
	}

	await callback(qaSearches, cardSearches)
}

/**
 * Query the artwork repo to try and resolve card art for the given searches.
 * @param {Array<Search>} artSearches The searches that need card art. 
 */
async function searchArtworkRepo(artSearches) {
	// First get the manifest. Used the cached one if we've got it.
	if (!Object.keys(artworkManifest).length) {
		await axios.get(`${YGORG_ARTWORK_API}/manifest.json`, {
				'timeout': API_TIMEOUT * 1000
		}).then(r => {
			if (r.status === 200) {
				artworkManifest = r.data
				// Force a re-cache of the artwork manifest once per day.
				logger.info('Cached new artwork manifest, resetting in 24 hrs.')
				setInterval(() => {
					artworkManifest = {}
					logger.info('Evicted cached artwork manifest, will re-cache the next time it is necessary.')
				}, 24 * 60 * 60 * 1000)
			}
		})
	}

	if (!artworkManifest || !('cards' in artworkManifest))
		// Manifest query didn't work? No art then, I guess.
		return

	const manifestCardData = artworkManifest.cards

	// Map index of the search in artSearches to an array of all art repo requests for that search.
	const repoResponses = {}
	// Send all the requests.
	for (let i = 0; i < artSearches.length; i++) {
		const s = artSearches[i]
		repoResponses[i] = []

		const cardId = s.data.dbId
		if (cardId in manifestCardData) {
			const cardArtData = manifestCardData[cardId]
			for (const artId in cardArtData) {
				// Send requests for each art.
				const bestArtRepoLoc = cardArtData[artId].bestArt
				const bestArtFullUrl = `${YGORG_ARTWORK_API}/${bestArtRepoLoc}`
				const req = axios.get(bestArtFullUrl, {
					'timeout': API_TIMEOUT * 1000
				}).then(r => {
					if (r.status === 200) return r
				})

				repoResponses[i].push(req)
			}
		}
	}

	for (const idx in repoResponses)
		if (repoResponses[idx].length) {
			const reqs = repoResponses[idx]
			repoResponses[idx] = await Promise.allSettled(reqs)
		}
	
	// Process the data we received.
	const newImageData = []
	for (const idx in repoResponses) {
		const origSearch = artSearches[idx]
		if (repoResponses[idx]) {
			for (let i = 0; i < repoResponses[idx].length; i++) {
				const resp = repoResponses[idx][i]

				if (resp.status === 'rejected') {
					logError(resp.reason, `YGOrg artwork repo query for ID ${origSearch.term} failed.`)
					continue
				}
	
				if (resp.value.data) {
					// Artworks were queried in order of ID, but are zero-indexed.
					// Therefore, our index in the array +1 is the art ID.
					const artId = i + 1
					// Repo artwork should always be from Neuron.
					origSearch.data.addImageData(artId, resp.value.data, true)
				}
			}
			newImageData.push(origSearch)
		}
	}
}

/**
 * Add (or replace) the given values in the YGOrg DB.
 * @param {Array<Search>} qas Search data containing new QAs to add.
 * @param {Array<Search>} faqCards Search data containing new FAQ data to add.
 */
function addToYgorgDb(qaSearches, faqSearches) {
	if (qaSearches && qaSearches.length) {
		const insertQa = ygorgDb.prepare(`INSERT OR REPLACE INTO qaData(qaId, locale, title, question, answer, date)
									  VALUES(?, ?, ?, ?, ?, ?)`)
		const insertCard = ygorgDb.prepare(`INSERT OR REPLACE INTO qaCards(qaId, cardId)
										VALUES(?, ?)`)
		let insertAllQas = ygorgDb.transaction(searchData => {
			for (const s of searchData) {
				const qa = s.data
				qa.title.forEach((t, l) => {
					insertQa.run(qa.id, l, t, qa.question.get(l), qa.answer.get(l), qa.date.get(l))
				})
				for (const c of qa.cards) insertCard.run(qa.id, c.dbId)
			}
		})
		insertAllQas(qaSearches)
	}
	if (faqSearches && faqSearches.length) {
		const insertFaq = ygorgDb.prepare(`INSERT OR REPLACE INTO faqData(cardId, locale, data)
									  VALUES(?, ?, ?)`)
		let insertAllFaqs = ygorgDb.transaction(searchData => {
			for (const s of searchData) {
				const card = s.data
				card.faqData.forEach((entries, locale) => {
					for (const entry of entries) insertFaq.run(card.dbId, locale, entry)
				})
			}
		})
		insertAllFaqs(faqSearches)
	}
}

/**
 * Saves off the YGORG card name -> ID search index for all locales.
 * @param {Array<String>} locale An array of locales to query the search index for.
 */
async function cacheNameToIdIndex(locales = Object.keys(Locales)) {
	// Only request the locales that we don't have cached.
	const localesNotCached = locales.filter(l => !(l in nameToIdIndex))
	if (!localesNotCached.length) return

	const apiRequests = []
	for (const l of localesNotCached) {
		const localeIndex = axios.get(`${YGORG_NAME_ID_INDEX}/${l}`, {
			'timeout': API_TIMEOUT * 1000
		}).then(r => {
			if (r.status === 200) return r
		})

		apiRequests.push(localeIndex)
	}

	// Track results for logging.
	const successfulRequests = []

	const indices = await Promise.allSettled(apiRequests)

	// Look at the manifest revision first so we evict anything before repopulating.
	const goodReq = indices.find(i => i.status === 'fulfilled')
	if (goodReq)
		processManifest(goodReq.value.headers['x-cache-revision'])

	for (let i = 0; i < indices.length; i++) {
		const index = indices[i]
		// These promises return in the same order we sent the requests in.
		// Map this response to its corresponding locale that way.
		const indexLocale = localesNotCached[i]

		if (index.status === 'rejected') {
			logError(index.reason, `Failed to refresh cached YGORG name->ID index for locale ${indexLocale}.`)
			continue
		}

		nameToIdIndex[indexLocale] = {}
		// Make all the names lowercase for case-insensitive lookups.
		for (const n of Object.keys(index.value.data)) {
			const lcName = n.toLowerCase()
			nameToIdIndex[indexLocale][lcName] = index.value.data[n]
		}
		successfulRequests.push(indexLocale)
	}

	if (successfulRequests.length)
		logger.info(`Refreshed cached YGOrg name->ID index for locale(s): ${successfulRequests.join(', ')}`)
}

/**
 * Searches the name to ID index for the best match among all locales.
 * @param {String} search The value to search for. 
 * @param {Array<String>} locales The array of locales to search for.
 * @param {Number} returnMatches The number of matches to return, sorted in descending order (better matches first).
 * @returns {Object} All relevant matches.
 */
function searchNameToIdIndex(search, locales, returnMatches = 1) {
	// First make sure we've got everything cached.
	cacheNameToIdIndex(locales)
	// Note: in rare scenarios this can cache something but evict another (if a manifest revision demands it),
	// leaving us with nothing for a given locale. This will cause this function to find no matches for the given search's locale index,
	// which is unfortunate, but the logic will fail gracefully and I'm hoping it's rare enough that it won't be a practical issue.

	let matches = {}

	for (const l of locales) {
		if (!(l in nameToIdIndex)) continue

		const searchFilter = new CardDataFilter(nameToIdIndex[l], search, 'CARD_NAME')
		const localeMatches = searchFilter.filterIndex(returnMatches)
		for (const id in localeMatches) {
			const score = localeMatches[id]
			if (score > 0) 
				matches[id] = Math.max(score, matches[id] || 0)
		}
	}

	// If we had more than one locale and more than one match, we need to re-sort our matches in case each locale added some.
	if (locales.length > 1 && Object.keys(matches).length > 1) {
		// If scores are different, descending sort by score (i.e., higher scores first).
		// If scores are the same, ascending sort by ID (i.e., lower IDs first).
		const sortedResult = Object.entries(matches).sort(([idA, scoreA], [idB, scoreB]) => {
			return (scoreA !== scoreB) ? (scoreB - scoreA) : (idA - idB)
		})
		// Splice the array to only include the number of requested matches.
		sortedResult.splice(returnMatches)

		matches = {}
		for (const r of sortedResult)
			matches[r[0]] = r[1]
	}

	return matches
}

/**
 * Saves off the YGOrg localization metadata for properties and types.
 */
async function cachePropertyMetadata() {
	await axios.get(YGORG_PROPERTY_METADATA, {
		'timeout': API_TIMEOUT * 1000
	}).then(r => {
		if (r.status === 200) {
			// Cache the raw array that is returned by this.
			propertyArray = r.data
			// Also rejig this by pulling out the EN values to make them keys in a map for easy future lookups.
			for (const prop of r.data) {
				if (!prop) continue
				else if (!('en' in prop)) continue

				// Pull out the EN property name and make it a key.
				const enProp = prop['en']
				propertyToLocaleIndex[enProp] = {}
				for (const locale in prop) {
					// Make each locale a key under EN that maps to the translation of that property.
					propertyToLocaleIndex[enProp][locale] = prop[locale]
				}
			}

			// Also load some hardcoded ones the bot tracks for itself (not given by YGOrg DB since it doesn't have any use for them).
			propertyToLocaleIndex['Level'] = {
				'de': 'Stufe',
				'en': 'Level',
				'es': 'Nivel',
				'fr': 'Niveau',
				'it': 'Livello',
				'ja': 'レベル',
				'ko': '레벨',
				'pt': 'Nível'
			}
			propertyToLocaleIndex['Rank'] = {
				'de': 'Rang',
				'en': 'Rank',
				'es': 'Rango',
				'fr': 'Rang',
				'it': 'Rango',
				'ja': 'ランク',
				'ko': '랭크',
				'pt': 'Classe'
			}
			propertyToLocaleIndex['Pendulum Effect'] = {
				'de': 'Pendeleffekt',
				'en': 'Pendulum Effect',
				'es': 'Efecto de Péndulo',
				'fr': 'Effet Pendule',
				'it': 'Effetto Pendulum',
				'ja': 'ペンデュラム効果',
				'ko': '펜듈럼 효과',
				'pt': 'Efeito de Pêndulo'
			}
			propertyToLocaleIndex['Pendulum Scale'] = {
				'de': 'Pendelbereich',
				'en': 'Pendulum Scale',
				'es': 'Escala de Péndulo',
				'fr': 'Échelle Pendule',
				'it': 'Valore Pendulum',
				'ja': 'ペンデュラムスケール',
				'ko': '펜듈럼 스케일',
				'pt': 'Escala de Pêndulo'
			}

			logger.info('Successfully cached YGOrg DB locale property metadata.')
		}
		else throw new Error(`YGOrg DB returned bad status (${r.status}) when trying to update locale property metadata.`)
	}).catch(e => {
		logError(e, 'Failed getting locale metadata.')
	})
}

/**
 * Searches the locale property metadata to map an English property(s) to its version in another locale.
 * @param {String | Array<String>} type The property(s) in English.
 * @param {String} locale The locale's version of the property to search for.
 * @returns {String | Array<String>} The property(s) in the given locale.
 */
function searchPropertyToLocaleIndex(prop, locale) {
	let props = []

	// If we're just converting the one property, return immediately once we find it.
	if (typeof prop === 'string' && prop in propertyToLocaleIndex)
		return propertyToLocaleIndex[prop][locale]
	else {
		// Otherwise, loop through our properties to map each of them to the proper value.
		for (const p of prop) {
			if (p in propertyToLocaleIndex)
				props.push(propertyToLocaleIndex[p][locale])
		}
	}

	return props
}

/**
 * Returns the locale of the property at the given index of the property array. 
 * @param {Number} index The index of the property array to look at.
 * @param {String} locale The locale to search for at that index.
 */
function searchPropertyArray(index, locale) {
	const prop = propertyArray.at(index)
	if (prop)
		return prop[locale]
}

module.exports = {
	ygorgDb, cacheManifestRevision, searchYgorgDb, searchArtworkRepo, addToYgorgDb, cacheNameToIdIndex, searchNameToIdIndex, cachePropertyMetadata, searchPropertyToLocaleIndex, searchPropertyArray
}