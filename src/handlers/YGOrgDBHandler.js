const Database = require('better-sqlite3')
const fs = require('fs')

const { logError, logger } = require('lib/utils/logging')
const { CardDataFilter } = require('lib/utils/filter')
const Search = require('lib/models/Search')
const Query = require('lib/models/Query')
const { Locales, YGORG_NAME_ID_INDEX, YGORG_PROPERTY_METADATA, YGORG_DB_PATH, YGORG_MANIFEST, YGORG_QA_DATA_API, API_TIMEOUT, YGORG_CARD_DATA_API, YGORG_ARTWORK_API } = require('lib/models/Defines')
const Card = require('lib/models/Card')

/**
 * @typedef YgorgResponseCache
 * @property {Number} lastManifestRevision		The last seen manifest revision.
 * @property {Object} cardData								All cached API responses from the card API endpoint.
 * @property {Object} qaData									All cached API responses from the qa API endpoint.
 * @property {Object} nameToIdIndex						A search index mapping names to IDs.
 * @property {Object} propertyArray						The raw property data returned by the YGOrg API that's used in its own API.
 * @property {Object} artworkManifest					The cached artwork manifest from the YGOrg artwork endpoint.
*/

const _ygorgDb = new Database(YGORG_DB_PATH)
/** @type {YgorgResponseCache} */
const _apiResponseCache = {
	lastManifestRevision: undefined,
	cardData: {},
	qaData: {},
	nameToIdIndex: {},
	propertyArray: [],
	artworkManifest: null
}

// The propertyToLocaleIndex is the propertyArray API data converted into a map for easy type lookups for the bot's purposes.
const _propertyToLocaleIndex = {}

async function _loadApiResponseCache() {
	// Load current manifest revision.
	const dbData = _ygorgDb.prepare('SELECT * FROM manifestData').get()
	if (dbData) {
		_apiResponseCache['lastManifestRevision'] = dbData.lastManifestRevision
	}
	else {
		return false
	}

	// Load all card and QA data.
	const cardData = _ygorgDb.prepare('SELECT * FROM cardData').all()
	for (r of cardData) {
		_apiResponseCache.cardData[r.id] = JSON.parse(r.jsonResponse)
	}
	const qaData = _ygorgDb.prepare('SELECT * FROM qaData').all()
	for (r of qaData) {
		_apiResponseCache.qaData[r.id] = JSON.parse(r.jsonResponse)
	}
	const idxData = _ygorgDb.prepare('SELECT * FROM nameToIdIndex').all()
	if (idxData.length) {
		for (r of idxData) {
			_apiResponseCache.nameToIdIndex[r.locale] = JSON.parse(r.jsonResponse)
		}
	}
	else {
		// Force-cache the name to ID index if we don't have it in the database for some reason.
		await _cacheNameToIdIndex()
	}
	await _cachePropertyMetadata()

	return true
}

/**
 * Saves off the YGORG card name -> ID search index for all locales.
 * @param {Array<String>} locale An array of locales to query the search index for.
 */
async function _cacheNameToIdIndex(locales = Object.keys(Locales)) {
	let localesToRequest = [...locales]
	// Resolve any outstanding requests we have and evict ones with bad responses so we re-request them.
	for (const loc in _apiResponseCache.nameToIdIndex) {
		const idxData = await Promise.resolve(_apiResponseCache.nameToIdIndex[loc])
		if (!idxData) {
			delete _apiResponseCache.nameToIdIndex[loc]
			if (!localesToRequest.includes(loc)) {
				localesToRequest.push(loc)
			}
		}
	}
	// Only request the locales that we don't have cached.
	localesToRequest = localesToRequest.filter(l => !(l in _apiResponseCache.nameToIdIndex))
	if (!localesToRequest.length) return

	for (const l of localesToRequest) {
		_apiResponseCache.nameToIdIndex[l] = fetch(`${YGORG_NAME_ID_INDEX}/${l}`, { signal: AbortSignal.timeout(API_TIMEOUT) })
			.then(async r => {
				logger.info(`Resolved name->ID index for locale ${l}.`)
				const jsonResponse = await r.json()
				_ygorgDb.prepare('INSERT OR REPLACE INTO nameToIdIndex(locale, jsonResponse) VALUES(?, ?)').run(indexLocale, JSON.stringify(jsonResponse))
				return jsonResponse
			})
			.catch(err => {
				logError(err.message, `YGOrg API query for name -> ID index for locale ${l} failed.`)
			})
	}

	logger.info(`Sent new YGOrg API requests for caching name->ID index for locales ${localesToRequest.join(', ')}.`)
}

/**
 * Saves off the YGOrg localization metadata for properties and types.
 */
async function _cachePropertyMetadata() {
	try {
		var resp = await fetch(YGORG_PROPERTY_METADATA, { signal: AbortSignal.timeout(API_TIMEOUT) })
	}
	catch (err) {
		logError(err.message, 'YGOrg API query to initialize property metadata failed.')
		return
	}

	if (resp) {
		const jsonResponse = await resp.json()
		_apiResponseCache.propertyArray = jsonResponse
		// Also rejig this by pulling out the EN values to make them keys in a map for easy future lookups.
		for (const prop of jsonResponse) {
			if (!prop) continue
			else if (!('en' in prop)) continue

			// Pull out the EN property name and make it a key.
			const enProp = prop['en']
			_propertyToLocaleIndex[enProp] = {}
			for (const locale in prop) {
				// Make each locale a key under EN that maps to the translation of that property.
				_propertyToLocaleIndex[enProp][locale] = prop[locale]
			}
		}

		// Also load some hardcoded ones the bot tracks for itself (not given by YGOrg DB since it doesn't have any use for them).
		_propertyToLocaleIndex['Level'] = {
			'de': 'Stufe',
			'en': 'Level',
			'es': 'Nivel',
			'fr': 'Niveau',
			'it': 'Livello',
			'ja': 'レベル',
			'ko': '레벨',
			'pt': 'Nível'
		}
		_propertyToLocaleIndex['Rank'] = {
			'de': 'Rang',
			'en': 'Rank',
			'es': 'Rango',
			'fr': 'Rang',
			'it': 'Rango',
			'ja': 'ランク',
			'ko': '랭크',
			'pt': 'Classe'
		}
		_propertyToLocaleIndex['Pendulum Effect'] = {
			'de': 'Pendeleffekt',
			'en': 'Pendulum Effect',
			'es': 'Efecto de Péndulo',
			'fr': 'Effet Pendule',
			'it': 'Effetto Pendulum',
			'ja': 'ペンデュラム効果',
			'ko': '펜듈럼 효과',
			'pt': 'Efeito de Pêndulo'
		}
		_propertyToLocaleIndex['Pendulum Scale'] = {
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
}

/**
 * Caches the artwork manifest for repo searches.
 * If a manifest is already cached, it does nothing.
 */
async function _cacheArtworkManifest() {
	// First get the manifest. Used the cached one if we've got it.
	if (!_apiResponseCache.artworkManifest) {
		try {
			const resp = await fetch(`${YGORG_ARTWORK_API}/manifest.json`, { signal: AbortSignal.timeout(API_TIMEOUT) })
			const jsonResponse = await resp.json()
			if ('cards' in jsonResponse) {
				_apiResponseCache.artworkManifest = jsonResponse.cards
				logger.info('Cached new artwork repo manifest, resetting in 24 hrs.')
				setTimeout(() => {
					_apiResponseCache.artworkManifest = null
					logger.info('Evicted cached artwork repo manifest, will re-cache the next time it is necessary.')
				}, 24 * 60 * 60 * 1000)
			}
			else {
				logError(undefined, 'No card data in artwork repo manifest?')
			}
		}
		catch (err) {
			logError(err.message, 'Failed processing artwork repo manifest!')
		}
	}
}

async function checkForDataManifestUpdate() {
	// If the API response cache hasn't been initialized yet,
	// load it from the SQLite database.
	if (!('lastManifestRevision' in _apiResponseCache) || _apiResponseCache.lastManifestRevision === undefined) {
		const success = await _loadApiResponseCache()
		if (!success) {
			logError('Could not load the last manifest revision, so cannot check for updates. Exiting early.')
			return
		}
	}

	const lastManifestRevision = _apiResponseCache['lastManifestRevision']
	logger.info(`Starting check for new manifest; last revision seen was ${lastManifestRevision}.`)
	try {
		var resp = await fetch(`${YGORG_MANIFEST}/${lastManifestRevision}`, { signal: AbortSignal.timeout(API_TIMEOUT) })
	}
	catch (err) {
		logError(err.message, 'Failed processing YGOrg DB manifest.')
		return
	}

	if (resp) {
		const currManifestRevision = resp.headers.get('x-cache-revision')
		if (lastManifestRevision < currManifestRevision) {
			const jsonResponse = await resp.json()
			const manifest = jsonResponse.data
			
			if (!manifest) {
				logError(undefined, 'Received manifest with no data, exiting.')
				return
			}

			logger.info(`Found new manifest ${currManifestRevision}!`)

			const deleteCardData = _ygorgDb.prepare('DELETE FROM cardData WHERE id = ?')
			const deleteQaData = _ygorgDb.prepare('DELETE FROM qaData WHERE id = ?')
			const deleteIdxData = _ygorgDb.prepare('DELETE FROM nameToIdIndex WHERE locale = ?')

			for (const cid in manifest.card) {
				// Evict cached data first.
				delete _apiResponseCache.cardData[cid]
				deleteCardData.run(cid)

				_apiResponseCache.cardData[cid] = fetch(`${YGORG_CARD_DATA_API}/${cid}`, { signal: AbortSignal.timeout(API_TIMEOUT) })
					.then(async r => {
						const jsonResponse = await r.json()
						_ygorgDb.prepare('INSERT OR REPLACE INTO cardData(id, jsonResponse) VALUES(?, ?)').run(cid, JSON.stringify(jsonResponse))
						return jsonResponse
					})
					.catch(err => {
						logError(err.message, `Encountered error when querying YGOrg DB for card ID ${cid}.`)
					})
			}
			for (const qid in manifest.qa) {
				// Evict cached data first.
				delete _apiResponseCache.qaData[qid]
				deleteQaData.run(qid)

				_apiResponseCache.qaData[qid] = fetch(`${YGORG_QA_DATA_API}/${qid}`, { signal: AbortSignal.timeout(API_TIMEOUT) })
					.then(async r => { 
						const jsonResponse = await r.json()
						_ygorgDb.prepare('INSERT OR REPLACE INTO qaData(id, jsonResponse) VALUES(?, ?)').run(qid, JSON.stringify(jsonResponse))
						return jsonResponse
					})
					.catch(err => {
						logError(err.message, `Encountered error when querying YGOrg DB for ruling ID ${qid}.`)
					})
			}
			const hasNameIdxChanges = 'idx' in manifest && 'card' in manifest.idx && 'name' in manifest.idx.card
			if (hasNameIdxChanges) {
				for (const loc in manifest.idx.card.name) {
					// Evict cached data first.
					delete _apiResponseCache.nameToIdIndex[loc]
					deleteIdxData.run(loc)

					_apiResponseCache.nameToIdIndex[loc] = fetch(`${YGORG_NAME_ID_INDEX}/${loc}`, { signal: AbortSignal.timeout(API_TIMEOUT) })
						.then(async r => {
							const jsonResponse = await r.json()
							_ygorgDb.prepare('INSERT OR REPLACE INTO nameToIdIndex(locale, jsonResponse) VALUES(?, ?)').run(loc, JSON.stringify(jsonResponse))
							return jsonResponse
						})
						.catch(err => {
							logError(err.message, `Encountered error when querying YGOrg DB for name->ID index for locale ${loc}.`)
						})
				}
			}

			_apiResponseCache['lastManifestRevision'] = currManifestRevision
			_ygorgDb.prepare('DELETE FROM manifestData').run()
			_ygorgDb.prepare('INSERT OR REPLACE INTO manifestData(lastManifestRevision) VALUES(?)').run(currManifestRevision)
			logger.info(`Cached new YGOrg manifest revision ${currManifestRevision}.`)
			if ('card' in manifest) {
				const evictCards = Object.keys(manifest.card).length
				logger.info(`- Card data: ${evictCards} evicted`)
			}
			if ('qa' in manifest) {
				const evictQas = Object.keys(manifest.qa).length
				logger.info(`- QA data: ${evictQas} evicted`)
			}
			if (hasNameIdxChanges) {
				const updatedLocales = Object.keys(manifest.idx.card.name)
				const evictIdx = updatedLocales.length
				logger.info(`- Index data: ${evictIdx} locale(s) evicted (${updatedLocales.join(', ')})`)
			}
		}
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
	const qaSearches = []
	const cardSearches = []
	// Track all searches that weren't cached so we send API requests for them.
	const uncachedSearches = []

	// First search locally for any searches that might direct here.
	for (const currSearch of searches) {
		let isQaSearch = currSearch.hasType('q')
		if (!isQaSearch) {
			// Non-QA often come in as card names.
			// If the search term isn't a number, assume it's a name and convert it to an ID.
			if (!(Number.isInteger(currSearch.term))) {
				const localesToSearch = ['en']
				for (const locale of currSearch.localeToTypesMap.keys())
					if (!localesToSearch.includes(locale)) localesToSearch.push(locale)
				
				const matches = await searchNameToIdIndex(currSearch.term, localesToSearch)
				if (matches.size) {
					const bestMatchId = matches.keys().next().value
					const matchScore = matches.get(bestMatchId)
					if (matchScore >= 0.5) {
						// Update the search term if we have an ID match to use.
						currSearch.term = parseInt(bestMatchId, 10)
					}
				}
			}
		}

		// If, at this point, our search term isn't a number, bail. We need an ID to go further.
		if (!(Number.isInteger(currSearch.term))) continue
		
		if (isQaSearch) {
			// Use good cached data if we have it.
			if (currSearch.term in _apiResponseCache.qaData) {
				const cacheData = await Promise.resolve(_apiResponseCache.qaData[currSearch.term])
				if (cacheData) {
					currSearch.rawData = cacheData
					qaSearches.push(currSearch)
				}
				else {
					uncachedSearches.push(currSearch)
				}
			}
			else {
				uncachedSearches.push(currSearch)
			}
		}
		else {
			// Use good cached data if we have it.
			if (currSearch.term in _apiResponseCache.cardData) {
				const cacheData = await Promise.resolve(_apiResponseCache.cardData[currSearch.term])
				if (cacheData) {
					currSearch.rawData = cacheData
					cardSearches.push(currSearch)
				}
				else {
					uncachedSearches.push(currSearch)
				}
			}
			else {
				uncachedSearches.push(currSearch)
			}
		}
	}

	// Kick off any API requests we have to deal with.
	const requests = []
	for (const s of uncachedSearches) {
		const id = s.term
		if (s.hasType('q')) {
			requests.push(fetch(`${YGORG_QA_DATA_API}/${id}`, { signal : AbortSignal.timeout(API_TIMEOUT) })
				.then(async r => await r.json())
				.catch(err => {
					logError(err.message, `YGOrg API query for QA ID ${id} failed.`)
			}))
		}
		else {
			requests.push(fetch(`${YGORG_CARD_DATA_API}/${id}`, { signal: AbortSignal.timeout(API_TIMEOUT) })
				.then(async r => await r.json())
				.catch(err => {
					logError(err.message, `YGOrg API query for card ID ${id} failed.`)
				}))
		}
	}

	if (requests.length) {
		const responses = await Promise.allSettled(requests)

		for (let i = 0; i < responses.length; i++) {
			const resp = responses[i].value
			if (!resp) continue

			// The promises return in the same order we sent the requests in,
			// so the indices in this array map to the corresponding search.
			const origSearch = uncachedSearches[i]
			origSearch.rawData = resp

			if (origSearch.hasType('q')) {
				qaSearches.push(origSearch)
			}
			else {
				cardSearches.push(origSearch)
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
	await _cacheArtworkManifest()

	const manifestCardData = _apiResponseCache.artworkManifest

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
			for (const [artId, artPaths] of Object.entries(cardArtData)) {
				// Send requests for each art.
				const bestArtRepoLoc = artPaths.bestArt
				const bestArtFullUrl = new URL(bestArtRepoLoc, YGORG_ARTWORK_API)
				const req = fetch(bestArtFullUrl.toString(), { signal: AbortSignal.timeout(API_TIMEOUT) })
					.then(async r => await r.arrayBuffer())
					.catch(err => {
						logError(err.message, `Failed art repo query for card ${card}, art ID ${artId}.`)
					})

				repoResponses[i].push(req)
			}
		}
	}

	// Wait for all our requests to settle.
	for (const idx in repoResponses) {
		if (repoResponses[idx].length) {
			const reqs = repoResponses[idx]
			repoResponses[idx] = await Promise.allSettled(reqs)
		}
	}
	// Process the data we received.
	for (const [idx, resps] of Object.entries(repoResponses)) {
		const origSearch = artSearches[idx]
		for (let i = 0; i < resps.length; i++) {
			const resp = resps[i]
			if (resp.status === 'rejected') {
				continue
			}

			if (resp.value) {
				// Artworks were queried in order of ID, but are zero-indexed.
				// Therefore, our index in the array +1 is the art ID.
				const artId = i + 1
				origSearch.data.addImageData(artId, resp.value)
			}
		}
	}
}

/**
 * Surveys the file system and the artwork manifest to determine where the paths
 * to the raw image data associated with this card ID are, then sets the card's imageData accordingly.
 * @param {Card} card The card object to populate the image data for.
 */
async function getAllNeuronArts(card) {
	await _cacheArtworkManifest()
	if (!_apiResponseCache.artworkManifest) return
	const manifestData = _apiResponseCache.artworkManifest

	const cardId = card.dbId
	if (cardId in manifestData) {
		const baseArtPath = `${process.cwd()}/data/card_images`
		for (const [artId, repoPathData] of Object.entries(manifestData[cardId])) {
			const bestRepoTcgPath = repoPathData.bestTCG
			const bestRepoOcgPath = repoPathData.bestOCG

			// First check if we have crops for the relevant arts already and use those.
			const tcgCropPath = baseArtPath + `/cropped_neuron/${cardId}_tcg_${artId}.png`
			const ocgCropPath = baseArtPath + `/cropped_neuron/${cardId}_ocg_${artId}.png`
			const tcgCropExists = fs.existsSync(tcgCropPath)
			const ocgCropExists = fs.existsSync(ocgCropPath)
			if (tcgCropExists) {
				card.addImageData('tcg', artId, tcgCropPath)
			}
			if (ocgCropExists) {
				card.addImageData('ocg', artId, ocgCropPath)
			}
			// If we have cropped arts for all paths that exist in the repo, then nothing more to do here.
			if ((!bestRepoTcgPath || (bestRepoTcgPath && tcgCropExists)) &&
					(!bestRepoOcgPath || (bestRepoOcgPath && ocgCropExists)))
			{
				continue
			}

			// If we get here, we're missing an existing crop(s) so we need to look for the source image(s) from the repo.
			// As of writing this, paths in the manifest look like:
			// https://artworks-jp-n.ygorganization.com/2/0/41_1.png
			// We have local copies of the repo that follow the same subdir structure,
			// but need to replace the entire https://...com section with our base path instead.
			if (bestRepoTcgPath) {
				const bestLocalTcgPath = bestRepoTcgPath.replace(/\/\/.*\.com/, baseArtPath + '/en_neuron')
				if (fs.existsSync(bestLocalTcgPath)) {
					card.addImageData('tcg', artId, bestLocalTcgPath)
				}
			}
			if (bestRepoOcgPath) {
				const bestLocalOcgPath = bestRepoOcgPath.replace(/\/\/.*\.com/, baseArtPath + '/jp_neuron')
				if (fs.existsSync(bestLocalOcgPath)) {
					card.addImageData('ocg', artId, bestLocalOcgPath)
				}
			}
		}
	}
}

/**
 * Populates a Ruling's data with data from the YGOrg DB API.
 * @param {Object} apiData The API data returned from the YGOrg API for this ruling ID.
 * @param {Ruling} ruling The ruling to populate with data.
 */
function populateRulingFromYgorgApi(apiData, ruling) {
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
 * @param {Array<Search>} qaSearches Search data containing new QAs to add.
 * @param {Array<Search>} cardSearches Search data containing new card data to add.
 */
function addToYgorgDb(qaSearches, cardSearches) {
	if (qaSearches.length) {
		const insertQa = _ygorgDb.prepare(`INSERT OR REPLACE INTO qaData(id, jsonResponse) VALUES(?, ?)`)
		let insertAllQas = _ygorgDb.transaction(searchData => {
			for (const s of searchData) {
				insertQa.run(s.data.id, JSON.stringify(s.rawData))
				_apiResponseCache.qaData[s.data.id] = s.rawData
			}
		})
		insertAllQas(qaSearches)
	}
	if (cardSearches.length) {
		const insertCard = _ygorgDb.prepare(`INSERT OR REPLACE INTO cardData(id, jsonResponse) VALUES(?, ?)`)
		let insertAllCards = _ygorgDb.transaction(searchData => {
			for (const s of searchData) {
				insertCard.run(s.data.dbId, JSON.stringify(s.rawData))
				_apiResponseCache.cardData[s.data.dbId] = s.rawData
			}
		})
		insertAllCards(cardSearches)
	}
}

/**
 * Searches the name to ID index for the best match among all locales.
 * @param {String} search The value to search for. 
 * @param {Array<String>} locales The array of locales to search for.
 * @param {Number} returnMatches The number of matches to return, sorted in descending order (better matches first).
 * @param {Boolean} returnNames Whether to return the names of what was matched in addition to IDs.
 * @returns {Promise<Map<Number, Number>>} Relevant matches mapped to their score.
 */
async function searchNameToIdIndex(search, locales, returnMatches = 1, returnNames = false) {
	// Make sure we have the necessary locales cached before trying to search.
	await _cacheNameToIdIndex(locales)

	const matches = new Map()

	for (const l of locales) {
		if (!(l in _apiResponseCache.nameToIdIndex)) continue

		const idx = await Promise.resolve(_apiResponseCache.nameToIdIndex[l])
		if (!idx) continue

		const searchFilter = new CardDataFilter(idx, search, 'CARD_NAME')
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
	
	return Promise.resolve(matches)
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
	if (typeof prop === 'string' && prop in _propertyToLocaleIndex)
		return _propertyToLocaleIndex[prop][locale]
	else {
		// Otherwise, loop through our properties to map each of them to the proper value.
		for (const p of prop) {
			if (p in _propertyToLocaleIndex)
				props.push(_propertyToLocaleIndex[p][locale])
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
	const prop = _apiResponseCache.propertyArray.at(index)
	if (prop)
		return prop[locale]
}

module.exports = {
	checkForDataManifestUpdate, searchYgorgDb, searchArtworkRepo, addToYgorgDb, 
	populateCardFromYgorgApi, populateRulingFromYgorgApi,
	searchNameToIdIndex, searchPropertyToLocaleIndex, searchPropertyArray, getAllNeuronArts
}