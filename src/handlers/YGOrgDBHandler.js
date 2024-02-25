const axios = require('axios')
const Database = require('better-sqlite3')

const { logError, logger } = require('lib/utils/logging')
const { CardDataFilter } = require('lib/utils/filter')
const Search = require('lib/models/Search')
const Query = require('lib/models/Query')
const { Locales, YGORG_NAME_ID_INDEX, YGORG_PROPERTY_METADATA, YGORG_DB_PATH, YGORG_MANIFEST, YGORG_QA_DATA_API, API_TIMEOUT, YGORG_CARD_DATA_API, YGORG_ARTWORK_API } = require('lib/models/Defines')

const ygorgDb = new Database(YGORG_DB_PATH)

let cachedRevision = undefined
let artworkManifest = null
const nameToIdIndex = {}
// The property array is the raw data returned by the YGOrg API and is used for its own API.
// The propertyToLocaleIndex is that data converted into a map for easy type lookups for the bot's purposes.
// Both are used at various places in the bot logic, so both are cached.
let propertyArray = []
const propertyToLocaleIndex = {}

/**
 * Caches the most recent manifest revision we know about.
 * @param {Number} newRevision The new revision number. 
 */
function cacheManifestRevision(newRevision) {
	// First time, have to load this from the DB.
	if (newRevision === undefined && cachedRevision === undefined) {
		const dbData = ygorgDb.prepare('SELECT * FROM manifest').get()
		if (dbData)
			cachedRevision = dbData.lastKnownRevision
	}
	else if (newRevision) {
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

	handleResponse = r => {
		logger.info(`Processing new manifest revision ${newRevision}...`)
		const changes = r.data.data 

		if (changes) {
			const cardChanges = changes.card
			const qaChanges = changes.qa
			const idxChanges = changes.idx
			// Card data updates: no way to tell what exactly has changed,
			// so just invalidate any data stored in the bot or YGOrg databases.
			// (Don't invalidate anything from the Konami database, since that's updated by a separate process.)
			if (cardChanges) {
				const evictIds = Object.keys(cardChanges)
				// Delete any FAQ data from YGOrg DB.
				const delFaq = ygorgDb.prepare('DELETE FROM faqData WHERE cardId = ?')
				const delMany = ygorgDb.transaction(ids => {
					for (const id of ids) delFaq.run(id)
				})
				delMany(evictIds)

				logger.info(`Evicted all FAQ and cached bot data associated with ${evictIds.length} database ID(s).`)
			}
			// Invalidate cached QA data.
			if (qaChanges) {
				const evictQas = Object.keys(qaChanges)

				const delQa = ygorgDb.prepare('DELETE FROM qaData WHERE qaId = ?')
				const delCards = ygorgDb.prepare('DELETE FROM qaCards WHERE qaId = ?')
				const delMany = ygorgDb.transaction(ids => {
					for (const id of ids) {
						delQa.run(id)
						delCards.run(id)
					}
				})
				delMany(evictQas)

				logger.info(`Evicted all QA data for ${evictQas.length} QA ID(s).`)
			}
			// Invalidate any cached indices we care about.
			if (idxChanges && idxChanges.name) {
				logger.info(`Evicted locales ${Object.keys(idxChanges).join(', ')} from name index.`)
				for (l in idxChanges.name) delete nameToIdIndex[l]
			}
		}

		cacheManifestRevision(newRevision)
	}

	// Otherwise, get manifest data to see if we need to make any changes.
	try {
		const resp = await axios.get(`${YGORG_MANIFEST}/${cachedRevision}`, {
			'timeout': API_TIMEOUT * 1000
		})
		handleResponse(resp)
	}
	catch (err) {
		logError(err.message, 'Failed processing YGOrg DB manifest.')
	}
}

/**
 * Search the YGOrg database to resolve card data.
 * This will both look in our local database for QA or FAQ data,
 * as well as query the API as necessary to resolve any other data.
 * @param {Array<Search>} searches The array of searches to evaluate.
 * @param {Query} qry The query that contains all these searches.
 * @param {Function} dataHandlerCallback The callback for handling the data produced by this search.
 */
async function searchYgorgDb(searches, qry, dataHandlerCallback) {
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
		if (!isQaSearch) {
			// Non-QA searches need database IDs, but often come in as card names.
			// If the search term isn't a number, assume it's a name and convert it to an ID.
			if (Number.isInteger(currSearch.term))
				cardApiSearches.push(currSearch)
			else {
				const localesToSearch = ['en']
				for (const locale of currSearch.localeToTypesMap.keys())
					if (!localesToSearch.includes(locale)) localesToSearch.push(locale)
				
				const matches = searchNameToIdIndex(currSearch.term, localesToSearch)
				if (matches.size) {
					const bestMatchId = matches.keys().next().value
					const matchScore = matches.get(bestMatchId)
					if (matchScore < 0.5) break	// Ignore scores this low, they mean we weren't really sure, this was just the least bad.

					// Update the search term if we have an ID match to use.
					currSearch.term = bestMatchId
					cardApiSearches.push(currSearch)
				}
			}
		}
		
		if (isQaSearch) {
			const dbRows = ygorgDb.prepare('SELECT * FROM qaData WHERE qaId = ?').all(currSearch.term)
			if (dbRows.length) {
				currSearch.rawData = dbRows
				qaSearches.db.push(currSearch)
			}
			else
				// If there's nothing in the DB, go to the API.
				qaApiSearches.push(currSearch)
		}
		else if (isFaqSearch) {
			const dbRows = ygorgDb.prepare('SELECT * FROM faqData WHERE cardId = ?').all(currSearch.term)
			if (dbRows.length) {
				if (currSearch.data === undefined) 
					// How the hell did we get this far with unresolved card data? This shouldn't happen.
					cardApiSearches.push(currSearch)
				else {
					const faqMap = currSearch.data.faqData
					for (const r of dbRows)
						insertFaqData(faqMap, r.locale, r.effectNumber, r.data)
					// Lastly, sort each array of FAQBlocks by index.
					faqMap.forEach(fbs => {
						fbs.sort((a, b) => {
							// Convert the indices to numbers and sort them that way. Some might have decimals (0.5) which sorts improperly on a string comparison.
							return parseFloat(a.index) - parseFloat(b.index)
						})
					})
				}

				// Make sure this wasn't all we needed to look for. If we still need more data, kick it to the API.
				// This can happen for OCG-only cards that we have FAQ data stored in the database for.
				if (!currSearch.isDataFullyResolved() && Number.isInteger(currSearch.term))
					cardApiSearches.push(currSearch)
			}
		}
	}

	// If we don't have anything to do with the API, just bail out early.
	if (!qaApiSearches.length && !cardApiSearches.length && qaSearches.db.length) {
		await dataHandlerCallback(qry, qaSearches)
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
			return r
		}).catch(err => {
			throw new Error(`YGOrg API card query for ruling ID ${qaId} returned nothing.`)
		})

		qaRequests.push(req)
	}
	for (const cardSearch of cardApiSearches) {
		const cardId = cardSearch.term
		const req = axios.get(`${YGORG_CARD_DATA_API}/${cardId}`, {
			'timeout': API_TIMEOUT * 1000
		}).then(r => {
			return r
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
			await processManifest(goodReq.value.headers['x-cache-revision'])
	}
	if (cardRequests.length) {
		var cardApiData = await Promise.allSettled(cardRequests)
		const goodReq = cardApiData.find(r => r.status === 'fulfilled')
		if (goodReq)
			await processManifest(goodReq.value.headers['x-cache-revision'])
	}
	
	if (qaApiData) {
		for (let i = 0; i < qaApiData.length; i++) {
			const qaResponse = qaApiData[i]
			// These promises return in the same order we sent the requests in.
			// Map this response to its corresponding search that way.
			const qaSearch = qaApiSearches[i]

			if (qaResponse.status === 'rejected') {
				// logError(qaResponse.reason.message, `YGOrg API query for QA ID ${qaSearch.term} failed.`)
				continue
			}

			if (qaResponse.value.data && Object.keys(qaResponse.value.data).length) {
				qaSearch.rawData = qaResponse.value.data
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
				// logError(cardResponse.reason.message, `YGOrg API query for card ID ${cardSearch.term} failed.`)
				continue
			}

			if (cardResponse.value.data && Object.keys(cardResponse.value.data).length) {
				cardSearch.rawData = cardResponse.value.data
				cardSearches.push(cardSearch)
			}
		}
	}

	await dataHandlerCallback(qry, qaSearches, cardSearches)
}

/**
 * Query the artwork repo to try and resolve card art for the given searches.
 * @param {Array<Search>} artSearches The searches that need card art. 
 */
async function searchArtworkRepo(artSearches) {
	// First get the manifest. Used the cached one if we've got it.
	if (!artworkManifest) {
		const handleResponse = r => {
			artworkManifest = r.data
			// Force a re-cache of the artwork manifest once per day.
			logger.info('Cached new artwork manifest, resetting in 24 hrs.')
			setTimeout(() => {
				artworkManifest = null
				logger.info('Evicted cached artwork manifest, will re-cache the next time it is necessary.')
			}, 24 * 60 * 60 * 1000)
		}

		try {
			const resp = await axios.get(`${YGORG_ARTWORK_API}/manifest.json`, {
				'timeout': API_TIMEOUT * 1000
			})
			handleResponse(resp)
		}
		catch (err) {
			logError(err.message, 'Failed processing artwork repo manifest.')
		}
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
		const cardId = s.data.dbId

		// Store the requests/responses in the same order as the searches, for easy reference later.
		repoResponses[i] = []

		if (cardId in manifestCardData) {
			const cardArtData = manifestCardData[cardId]
			for (const artId in cardArtData) {
				// Send requests for each art.
				const bestArtRepoLoc = cardArtData[artId].bestArt
				const bestArtFullUrl = new URL(bestArtRepoLoc, YGORG_ARTWORK_API)
				const req = axios.get(bestArtFullUrl.toString(), {
					'timeout': API_TIMEOUT * 1000,
					'responseType': 'arraybuffer'
				}).then(r => {
					return r
				})

				repoResponses[i].push(req)
			}
		}
	}

	// Wait for all our requests to settle.
	for (const idx in repoResponses)
		if (repoResponses[idx].length) {
			const reqs = repoResponses[idx]
			repoResponses[idx] = await Promise.allSettled(reqs)
		}
	// Process the data we received.
	for (const [idx, resps] of Object.entries(repoResponses)) {
		const origSearch = artSearches[idx]
		for (let i = 0; i < resps.length; i++) {
			const resp = resps[i]

			if (resp.status === 'rejected') {
				logError(resp.reason.message, `YGOrg artwork repo query for ID ${origSearch.term} failed.`)
				continue
			}

			if (resp.value.data) {
				// Artworks were queried in order of ID, but are zero-indexed.
				// Therefore, our index in the array +1 is the art ID.
				const artId = i + 1
				origSearch.data.addImageData(artId, resp.value.data)
			}
		}
	}
}

/**
 * Populates a Ruling's data with data from the local YGOrg DB.
 * @param {Array} dbRows Rows of data returned from the qaData YGOrg DB table.
 * @param {Ruling} ruling The ruling to populate with data.
 */
 function populateRulingFromYgorgDb(dbRows, ruling) {
	// Just use the first row as a representative for all the data that isn't locale-sensitive.
	const repRow = dbRows[0]

	// Map locale-sensitive data.
	for (const r of dbRows) {
		ruling.title.set(r.locale, r.title)
		ruling.question.set(r.locale, r.question)
		ruling.answer.set(r.locale, r.answer)
		ruling.date.set(r.locale, r.date)
	}
	ruling.id = repRow.qaId

	// Grab any associated cards from the junction table.
	const dbCards = ygorgDb.prepare('SELECT * FROM qaCards WHERE qaId = ?').all(ruling.id)
	if (dbCards.length)
		for (const c of dbCards)
			ruling.cards.push(c.cardId)
}

/**
 * Populates a Ruling's data with data from the YGOrg DB API.
 * @param {Object} apiData The API data returned from the YGOrg API for this ruling ID.
 * @param {Ruling} ruling The ruling to populate with data.
 */
function populatedRulingFromYgorgApi(apiData, ruling) {
	const qaData = apiData.qaData
	for (const locale in qaData) {
		// Ignore outdated translations.
		if (qaData[locale].translationStatus === 'outdated') continue
		// For some reason QA IDs are buried in each locale. Just use the first one we come across,
		// the rest are always the same.
		if (!ruling.id) ruling.id = qaData[locale].id

		ruling.title.set(locale, qaData[locale].title)
		ruling.question.set(locale, qaData[locale].question)
		ruling.answer.set(locale, qaData[locale].answer)
		ruling.date.set(locale, qaData[locale].thisSrc.date)
	}

	ruling.cards = apiData.cards
	ruling.tags = apiData.tags
}

/**
 * Populates a Card's data with data from the YGOrg DB API.
 * This function will not overwrite any data that is already present in the Card that is passed.
 * @param apiData The response from a card data API query on the YGOrg DB. 
 * @param {Card} card The card to set data for. 
 */
 function populateCardFromYgorgApi(apiData, card) {
	// Database ID is at the uppermost level.
	card.dbId = apiData.cardId
	// Descend into card data to populate all the fields we can.
	const apiCardData = apiData.cardData
	if (apiCardData) {
		for (const locale in apiCardData) {
			const localeCardData = apiCardData[locale]
			// Map the locale-specific values.
			if (!card.name.has(locale)) card.name.set(locale, localeCardData.name)
			if (!card.effect.has(locale)) card.effect.set(locale, localeCardData.effectText)
			if ('pendulumEffectText' in localeCardData)
				if (!card.pendEffect.has(locale)) card.pendEffect.set(locale, localeCardData.pendulumEffectText)
			// Parse print dates too.
			if ('prints' in localeCardData) {
				const apiPrints = localeCardData.prints
				if (!card.printData.has(locale)) card.printData.set(locale, new Map())
				for (const p of apiPrints)
					card.printData.get(locale).set(p.code, p.date)
			}
			// Some non-locale-specific values are repeated per locale. Just use them the first time we see them.
			if (!card.cardType) card.cardType = localeCardData.cardType
			// Parse monster-specific stats.
			if (card.cardType === 'monster') {
				if (!card.attribute && 'attribute' in localeCardData) card.attribute = localeCardData.attribute
				if (!card.levelRank && !card.linkMarkers.length) {
					if ('level' in localeCardData) card.levelRank = localeCardData.level
					else if ('rank' in localeCardData) card.levelRank = localeCardData.rank
					else if ('linkArrows' in localeCardData) {
						const arrows = localeCardData.linkArrows
						for (let i = 0; i < arrows.length; i++)
							card.linkMarkers.push(parseInt(arrows.charAt(i), 10))	
					}
				}
				if (!card.types.length && 'properties' in localeCardData)
					for (const prop of localeCardData.properties)
						card.types.push(searchPropertyArray(prop, 'en'))
				if (!card.attack && 'atk' in localeCardData) card.attack = localeCardData.atk
				if (!card.defense && 'def' in localeCardData) card.defense = localeCardData.def
				if (!card.pendScale && 'pendulumScale' in localeCardData) card.pendScale = localeCardData.pendulumScale
			}
			// Parse Spell/Trap specific stats.
			else {
				if (!card.property && 'property' in localeCardData) card.property = localeCardData.property
			}
			
		}
	}
	// YGOrg API also returns FAQ data for card queries, may as well populate that while we're here too if we need to.
	const apiFaqData = apiData.faqData
	if (apiFaqData && card.faqData.size === 0) {
		const faqMap = card.faqData
		for (const effect in apiFaqData.entries) {
			for (const entry of apiFaqData.entries[effect])
				for (const locale in entry) 
					insertFaqData(faqMap, locale, effect, entry[locale])
		}
		// Check for pendulum effect entries too.
		if ('pendEntries' in apiFaqData) {			
			for (const effect in apiFaqData.pendEntries)
				for (const entry of apiFaqData.pendEntries[effect])
					for (const locale in entry)
						// Add 100 to the indices on FAQs to do with pendulum effects.
						// This is an ugly hack, but they need to be separated from normal FAQ entries.
						insertFaqData(faqMap, locale, String(parseFloat(effect)+100), entry[locale])
		}
		// Lastly, sort each array of FAQBlocks by index.
		faqMap.forEach((fbs, lan) => {
			fbs.sort((a, b) => {
				// Convert the indices to numbers and sort them that way. Some might have decimals (0.5) which sorts improperly on a string comparison.
				return parseFloat(a.index) - parseFloat(b.index)
			})
		})
	}
}

/**
 * A helper function to add to (and organize) FAQ data as it's being inserted into Card data.
 * @param {Map<>} faqMap A Card's faqData. 
 * @param {String} locale The locale of the FAQ entry being added.
 * @param {String} effectIndex The effect "index" of the entry being added.
 * @param {String} entry The entry to add.
 */
function insertFaqData(faqMap, locale, effectIndex, entry) {
	if (!faqMap.has(locale)) 
		faqMap.set(locale, [])
	const faqBlocks = faqMap.get(locale)
	// Find the block associated with this index. If none exists, make a new one and go from there.
	let assocBlock = faqBlocks.find(b => b.index === effectIndex)
	if (!assocBlock) {
		assocBlock = {
			index: effectIndex,
			lines: [entry]
		}
		faqBlocks.push(assocBlock)
	}
	else {
		// If one already exists, add this row's data to it.
		// Be on the lookout for a label row (starts with "About...", or is wrapped in【 】in JP) and make sure to add it to the front of the array.
		if (locale === 'en' && entry.startsWith('About ')) {
			assocBlock.lines.unshift(entry)
		}
		else if (locale === 'ja' && 
				(entry.startsWith('【') && entry.endsWith('】')) || (entry.startsWith('【『') && entry.includes('』】'))) {
			assocBlock.lines.unshift(entry)
		}
		// Treat all other entries equally.
		else assocBlock.lines.push(entry)
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
				for (const c of qa.cards)
					if (c.dbId)
						insertCard.run(qa.id, c.dbId)
			}
		})
		insertAllQas(qaSearches)
	}
	if (faqSearches && faqSearches.length) {
		const insertFaq = ygorgDb.prepare(`INSERT OR REPLACE INTO faqData(cardId, locale, effectNumber, data)
									  VALUES(?, ?, ?, ?)`)
		let insertAllFaqs = ygorgDb.transaction(searchData => {
			for (const s of searchData) {
				const card = s.data
				card.faqData.forEach((blocks, locale) => {
					for (const b of blocks)
						for (const l of b.lines)
							insertFaq.run(card.dbId, locale, b.index, l)
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
			return r
		})

		apiRequests.push(localeIndex)
	}

	// Track results for logging.
	const successfulRequests = []

	const indices = await Promise.allSettled(apiRequests)

	// Look at the manifest revision first so we evict anything before repopulating.
	const goodReq = indices.find(i => i.status === 'fulfilled')
	if (goodReq)
		await processManifest(goodReq.value.headers['x-cache-revision'])

	for (let i = 0; i < indices.length; i++) {
		const index = indices[i]
		// These promises return in the same order we sent the requests in.
		// Map this response to its corresponding locale that way.
		const indexLocale = localesNotCached[i]

		if (index.status === 'rejected') {
			logError(index.reason.message, `Failed to refresh cached YGORG name->ID index for locale ${indexLocale}.`)
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
 * @param {Boolean} returnNames Whether to return the names of what was matched in addition to IDs.
 * @returns {Map<Number, Number>} Relevant matches mapped to their score.
 */
function searchNameToIdIndex(search, locales, returnMatches = 1, returnNames = false) {
	// First make sure we've got everything cached.
	cacheNameToIdIndex(locales)
	// Note: in rare scenarios this can cache something but evict another (if a manifest revision demands it),
	// leaving us with nothing for a given locale. This will cause this function to find no matches for the given search's locale index,
	// which is unfortunate, but the logic will fail gracefully and I'm hoping it's rare enough that it won't be a practical issue.
	const matches = new Map()

	for (const l of locales) {
		if (!(l in nameToIdIndex)) continue

		const searchFilter = new CardDataFilter(nameToIdIndex[l], search, 'CARD_NAME')
		const localeMatches = searchFilter.filterIndex(returnMatches, returnNames)
		localeMatches.forEach((score, id) => {
			if (score > 0)
				matches.set(id, Math.max(score, matches.get(id) || 0))
		})
	}

	// If we had more than one locale and more than one match, we need to re-sort our matches in case each locale added some.
	if (locales.length > 1 && matches.size > 1) {
		// If scores are different, descending sort by score (i.e., higher scores first).
		// If scores are the same, ascending sort by ID (i.e., lower IDs first).
		const sortedResult = [...matches.entries()].sort(([idA, scoreA], [idB, scoreB]) => {
			return (scoreA !== scoreB) ? (scoreB - scoreA) : (idA - idB)
		})
		// Splice the array to only include the number of requested matches.
		sortedResult.splice(returnMatches)
		// Reset the map.
		matches.clear()
		sortedResult.forEach(r => matches.set(r[0], r[1]))
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
	}).catch(e => {
		logError(e.message, 'Failed getting locale metadata.')
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
	cacheManifestRevision, searchYgorgDb, searchArtworkRepo, addToYgorgDb, 
	populateCardFromYgorgApi, populateRulingFromYgorgDb, populatedRulingFromYgorgApi, cacheNameToIdIndex, 
	searchNameToIdIndex, cachePropertyMetadata, searchPropertyToLocaleIndex, searchPropertyArray
}