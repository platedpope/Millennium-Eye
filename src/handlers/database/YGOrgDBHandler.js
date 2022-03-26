const axios = require('axios')
const Database = require('better-sqlite3')

const { Languages, YGORG_NAME_ID_INDEX, YGORG_LOCALE_METADATA, YGORG_DB_PATH, YGORG_MANIFEST } = require('lib/models/Defines')
const { logError, logger } = require('lib/utils/logging')
const { CardDataFilter } = require('lib/utils/search')

let cachedRevision = undefined
const nameToIdIndex = {}
const localePropertyMetadata = {}

/**
 * Caches the most recent manifest revision we know about.
 * @param {Number} newRevision The new revision number. 
 */
function cacheManifestRevision(newRevision) {
	db = new Database(YGORG_DB_PATH)
	// First time, have to load this from the DB.
	if (newRevision === undefined && cachedRevision === undefined) {
		const dbData = db.prepare('SELECT * FROM manifest').get()
		if (dbData)
			cachedRevision = dbData.lastKnownRevision
	}
	else {
		db.prepare('DELETE FROM manifest').run()
		db.prepare('INSERT INTO manifest(lastKnownRevision) VALUES (?)').run(newRevision)
		cachedRevision = newRevision
	}

	db.close()

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
		'timeout': 3 * 1000
	}).then(r => {
		if (r.status === 200) {
			logger.info(`Processing new manifest revision ${newRevision}...`)
			const changes = r.data.data 
			const ygorgDb = new Database(YGORG_DB_PATH)

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
				const { evictFromBotCache } = require('database/BotDBHandler')
				evictFromBotCache(evictIds)

				logger.info(`Evicted all FAQ and cached bot data associated with database IDs: ${evictIds.join(', ')}`)
			}
			// Invalidate cached QA data.
			if ('qa' in changes) {
				const evictQas = Object.keys(changes.qa)

				const delQa = ygorgDb.prepare('DELETE FROM qaData WHERE qaId = ?')
				const delMany = ygorgDb.transaction(ids => {
					for (const id of ids) delQa.run(id)
				})
				delMany(evictQas)

				logger.info(`Evicted all QA data for QA IDs: ${evictQas.join(', ')}`)
			}
			// Invalidate any cached indices we care about.
			if ('idx' in changes) {
				const idxChanges = changes.idx
				if ('name' in idxChanges) {
					logger.info(`Evicted languages ${Object.keys(idxChanges).join(', ')} from name index.`)
					for (l in idxChanges.name) delete nameToIdIndex[l]
				}
			}

			ygorgDb.close()
			cacheManifestRevision(newRevision)
		}
		else throw new Error(`YGOrg DB returned bad status (${r.status}) when trying to update manifest.`)
	}).catch(err => {
		logError(err, 'Failed processing YGOrg DB manifest.')
	})
}

/**
 * Saves off the YGORG card name -> ID search index for all languages.
 * @param {Array<String>} language An array of languages to query the search index for.
 */
async function cacheNameToIdIndex(lans = Object.keys(Languages)) {
	// Only request the languages that we don't have cached.
	const lansNotCached = lans.filter(l => !(l in nameToIdIndex))
	if (!lansNotCached.length) return

	const apiRequests = []
	for (const l of lansNotCached) {
		const lanIndex = axios.get(`${YGORG_NAME_ID_INDEX}/${l}`, {
			'timeout': 3 * 1000
		}).then(r => {
			if (r.status === 200) return r
		})

		apiRequests.push(lanIndex)
	}

	// Track results for logging.
	const successfulRequests = []

	const indices = await Promise.allSettled(apiRequests)

	// Look at the manifest revision first so we evict anything before repopulating.
	const goodReq = indices.find(i => i.status === 'fulfilled')
	if (goodReq) {
		const manifestRevsion = goodReq.value.headers['x-cache-revision']
		await processManifest(manifestRevsion)
	}

	for (let i = 0; i < indices.length; i++) {
		const index = indices[i]
		// These promises in the same order we sent the requests in.
		// Use that to map each response to a given language.
		const indexLanguage = lansNotCached[i]

		if (index.status === 'rejected') {
			logError(index.reason, `Failed to refresh cached YGORG name->ID index for language ${indexLanguage}.`)
			continue
		}

		nameToIdIndex[indexLanguage] = {}
		// Make all the names lowercase for case-insensitive lookups.
		for (const n of Object.keys(index.value.data)) {
			const lcName = n.toLowerCase()
			nameToIdIndex[indexLanguage][lcName] = index.value.data[n]
		}
		successfulRequests.push(indexLanguage)
	}

	if (successfulRequests.length)
		logger.info(`Refreshed cached YGOrg name->ID index for language(s): ${successfulRequests.join(', ')}`)
}

/**
 * Searches the name to ID index for the best match among all languages.
 * @param {String} search The value to search for. 
 * @param {Array<String>} lans The array of languages to search for.
 * @param {Number} returnMatches The number of matches to return, sorted in descending order (better matches first).
 * @returns {Object} All relevant matches.
 */
function searchNameToIdIndex(search, lans, returnMatches = 1) {
	// First make sure we've got everything cached.
	cacheNameToIdIndex(lans)
	// Note: in rare scenarios this can cache something but evict another (if a manifest revision demands it),
	// leaving us with nothing for a given language. This will cause this function to find no matches for the given search's language index,
	// which is unfortunate, but the logic will fail gracefully and I'm hoping it's rare enough that it won't be a practical issue.

	let matches = {}

	for (const l of lans) {
		if (!(l in nameToIdIndex)) continue

		const searchFilter = new CardDataFilter(nameToIdIndex[l], search, 'CARD_NAME')
		const lanMatches = searchFilter.filterIndex(returnMatches)
		for (const id in lanMatches) {
			const score = lanMatches[id]
			if (score > 0) 
				matches[id] = Math.max(score, matches[id] || 0)
		}
	}

	// If we had more than one language and more than one match, we need to re-sort our matches in case each language added some.
	if (lans.length > 1 && Object.keys(matches).length > 1) {
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
async function cacheLocaleMetadata() {
	await axios.get(YGORG_LOCALE_METADATA, {
		'timeout': 3 * 1000
	}).then(r => {
		if (r.status === 200) {
			// Rejig this metadata, it comes in as an array but I want to pull out the EN values
			// to make them keys in a map for easy future lookups.
			for (const prop of r.data) {
				if (!prop) continue
				else if (!('en' in prop)) continue

				// Pull out the EN property name and make it a key.
				const enProp = prop['en']
				localePropertyMetadata[enProp] = {}
				for (const lan in prop) {
					// Make each language a key under EN that maps to the translation of that property.
					localePropertyMetadata[enProp][lan] = prop[lan]
				}
			}

			// Also load some hardcoded ones the bot tracks for itself (not given by YGOrg DB since it doesn't have any use for them).
			localePropertyMetadata['Level'] = {
				'de': 'Stufe',
				'en': 'Level',
				'es': 'Nivel',
				'fr': 'Niveau',
				'it': 'Livello',
				'ja': 'レベル',
				'ko': '레벨',
				'pt': 'Nível'
			}
			localePropertyMetadata['Rank'] = {
				'de': 'Rang',
				'en': 'Rank',
				'es': 'Rango',
				'fr': 'Rang',
				'it': 'Rango',
				'ja': 'ランク',
				'ko': '랭크',
				'pt': 'Classe'
			}
			localePropertyMetadata['Pendulum Effect'] = {
				'de': 'Pendeleffekt',
				'en': 'Pendulum Effect',
				'es': 'Efecto de Péndulo',
				'fr': 'Effet Pendule',
				'it': 'Effetto Pendulum',
				'ja': 'ペンデュラム効果',
				'ko': '펜듈럼 효과',
				'pt': 'Efeito de Pêndulo'
			}
			localePropertyMetadata['Pendulum Scale'] = {
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
 * Searches the locale property metadata to map an English property(s) to its version in another language.
 * @param {String | Array<String>} type The property(s) in English.
 * @param {String} language The language's version of the property to search for.
 * @returns {String | Array<String>} The property(s) in the given language.
 */
function searchLocalePropertyMetadata(prop, language) {
	let props = []

	// If we're just converting the one property, return immediately once we find it.
	if (typeof prop === 'string' && prop in localePropertyMetadata)
		return localePropertyMetadata[prop][language]
	else {
		// Otherwise, loop through our properties to map each of them to the proper value.
		for (const p of prop) {
			if (p in localePropertyMetadata)
				props.push(localePropertyMetadata[p][language])
		}
	}

	return props
}

module.exports = {
	cacheManifestRevision, cacheNameToIdIndex, searchNameToIdIndex, cacheLocaleMetadata, searchLocalePropertyMetadata
}