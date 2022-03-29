const Database = require('better-sqlite3')
const fs = require('fs')

const Search = require('lib/models/Search')
const { BOT_DB_PATH } = require('lib/models/Defines')
const { logger, logError } = require('lib/utils/logging')

const botDb = new Database(BOT_DB_PATH)

/**
 * Search within the search term cache to find any matches for the given searches.
 * If a match is found, then branch off to the correct logic for resolving that match to data.
 * @param {Array<Search>} searches The array of relevant searches to evaluate.
 * @param {Query} qry The query that contains all relevant searches.
 * @param {Function} callback The callback for handling the data produced by this search.
 */
function searchTermCache(searches, qry, callback) {
	// Track all searches in each location so we can divvy things up and query them all at once.
	const cachedBotData = []
	/* TODO
	const cachedPriceData = []
	*/

	const sqlQry = `SELECT dbId, passcode, fullName, location, language
					FROM termCache 
					WHERE term = ?`
	// Iterate through the array backwards because we might modify it as we go.
	for (let i = searches.length - 1; i >= 0; i--) {
		const currSearch = searches[i]
		// Skip QA searches, their terms aren't card database IDs.
		if (currSearch.hasType('q')) continue

		const currTerm = currSearch.term

		const dbRows = botDb.prepare(sqlQry).all(currTerm)
		// Find a representative row. Prioritize any EN language one.
		let repRow = dbRows.filter(r => r.language === 'en')
		if (!repRow) {
			// Otherwise, get one with a language we need.
			repRow = dbRows.filter(r => currSearch.lanToTypesMap.has(r.language))
			if (!repRow)
				// If still nothing, just pick the first one and call it good enough.
				repRow = dbRows
		}
		if (repRow.length) {
			repRow = repRow[0]
			// The cache will give us a better search term to use. Update it accordingly:
			// - prioritize using DB ID if we have it,
			// - if no DB ID but we have passcode, use that,
			// - use full name as a last resort.
			if (qry) {
				if (repRow.dbId)
					var updateMerged = qry.updateSearchTerm(currTerm, repRow.dbId)
				else if (repRow.passcode)
					updateMerged = qry.updateSearchTerm(currTerm, repRow.passcode)
				else
					updateMerged = qry.updateSearchTerm(currTerm, repRow.fullName)
				// If updating the search term resulted in a consolidation (i.e., another search is the same),
				// then just skip passing this one along, it's no longer relevant.
				if (updateMerged) continue
			}
			
			// Grab anything cached in the bot database.
			if (repRow.location === 'bot')
				cachedBotData.push(currSearch)
		}
		// If there's nothing in the cache, nothing more to do with this search for now.
	}

	// Resolve bot data.
	if (cachedBotData.length) {
		const botSearchResults = searchBotDb(cachedBotData, qry, db)
		callback(botSearchResults.resolved, botSearchResults.termUpdates)
	}

	/* TODO
	if (cachedPriceData.length)
	*/
}

/**
 * Search the bot database for data that is associated with our searches.
 * Note that nothing gets into the bot database without also being in the term cache,
 * so the only way to get to this logic is through matching a cached search term.
 * @param {Array<Search>} searches The array of relevant searches to evaluate.
 * @param {Query} qry The query that contains all relevant searches.
 * @returns {Array<Search>} The array of Searches that had data resolved.
 */
function searchBotDb(searches, qry) {
	const getDbId = 'SELECT * FROM dataCache WHERE dbId = ?'
	const getPasscode = 'SELECT * FROM dataCache WHERE passcode = ?'
	const getDataName = 'SELECT * FROM dataCache WHERE dataName = ?'

	// Keep track of the searches that we've resolved during this trip through the database.
	const resolvedSearches = []
	const termsToUpdate = []

	// Iterate through the array backwards because we might modify it as we go.
	for (let i = searches.length - 1; i >= 0; i--) {
		const currSearch = searches[i]
		// If the search term is a number, then it's a database ID or passcode.
		if (Number.isInteger(currSearch.term)) {
			const dataRows = botDb.prepare(getDbId).all(currSearch.term)
			if (dataRows.length) {
				currSearch.data = dataRows
				resolvedSearches.push(currSearch)
			}
			else {
				// DB ID didn't give anything, move to passcode.
				const dataRows = botDb.prepare(getPasscode).all(currSearch.term)
				if (dataRows.length) {
					currSearch.data = currSearch.dataRows
					// If we have a better term, update where necessary.
					const repRow = dataRows[0]
					if (repRow.dbId) {
						const mergedSearch = qry.updateSearchTerm(currSearch.term, repRow.dbId)
						if (!mergedSearch) {
							resolvedSearches.push(currSearch)
							termsToUpdate.push(currSearch)
						}
					}
				}
			}
			
		}
		else {
			const dataRows = botDb.prepare(getDataName).all(currSearch.term)
			if (dataRows.length) {
				currSearch.data = dataRows
				// If we have a better term, update where necessary.
				const repRow = dataRows[0]
				const betterTerm = repRow.dbId ?? repRow.passcode
				if (betterTerm) {
					const mergedSearch = qry.updateSearchTerm(currSearch.term, betterTerm)
					if (!mergedSearch) {
						resolvedSearches.push(currSearch)
						termsToUpdate.push(currSearch)
					}
				}
			}
		}
	}

	return {
		'resolved': resolvedSearches,
		'termUpdates': termsToUpdate
	}
}

/**
 * Adds search terms to the cache. If one already exists, it will update the existing one.
 * @param {Array<Search>} searchData All searches (and their data) to add to the search term cache.
 * @param {String} fromLoc The location this data is stored in (bot or konami DB).
 */
function addToTermCache(searchData, fromLoc) {
	const insertTerm = botDb.prepare(`INSERT OR REPLACE INTO termCache(term, dbId, passcode, fullName, location, language)
								   VALUES(?, ?, ?, ?, ?, ?)`)

	const insertMany = botDb.transaction(termSearches => {
		for (const s of termSearches) {
			s.data.name.forEach((n, l) => {
				// Capture any "original" searches that ended up mapping to this.
				for (const o of s.originals) insertTerm.run(o, s.data.dbId, s.data.passcode, n, fromLoc, l)
			})
		}
	})
	insertMany(searchData)
}

/**
 * Adds card data to the bot database. If a card already exists with given data, it will update the existing one.
 * @param {Array<Search>} searchData The searches with card data to add to the bot database.
 */
function addToBotDb(searchData) {
	if (!searchData.length) return
	
	const insertDataCache = botDb.prepare(`
		INSERT OR REPLACE INTO dataCache(dataName, language, dbId, passcode, cardType, property, attribute, levelRank, attack, defense, effect, pendEffect, pendScale, requirement, notInCg)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`)
	const insertCardTypes = botDb.prepare(`
		INSERT OR REPLACE INTO cardDataTypes(dbId, passcode, fullName, type)
		VALUES(?, ?, ?, ?)
	`)
	const insertLinkMarkers = botDb.prepare(`
		INSERT OR REPLACE INTO cardDataLinkMarkers(dbId, passcode, fullName, marker)
		VALUES(?, ?, ?, ?)
	`)
	const insertImageData = botDb.prepare(`
		INSERT INTO cardDataImages(dbId, passcode, fullName, artId, artPath)
		VALUES(?, ?, ?, ?, ?)
	`)
	const insertPrintData = botDb.prepare(`
		INSERT INTO cardDataPrints(printCode, language, dbId, printDate)
		VALUES(?, ?, ?, ?)
	`)
	// TODO: Check and update pricing information as well.

	let insertAllData = botDb.transaction(searches => {
		for (const s of searches) {
			const c = s.data
			c.name.forEach((n, l) => {
				insertDataCache.run(
					n, l, c.dbId, c.passcode, c.cardType, c.property, c.attribute, c.levelRank, c.attack,
					c.defense, c.effect.get(l), c.pendEffect.get(l), c.pendScale, c.requirement, c.notInCg
				)
			})
			// Update types and link markers as necessary too.
			for (const t of c.types) insertCardTypes.run(c.dbId, c.passcode, c.name.get('en'), t)
			for (const m of c.linkMarkers) insertLinkMarkers.run(c.dbId, c.passcode, c.name.get('en'), m)
			// Update image data. Don't care about language for this.
			if (c.imageData.size)
				c.imageData.forEach((imgPath, id) => {
					insertImageData.run(c.dbId, c.passcode, c.name.get('en'), id, imgPath)
				})
			// Update print data.
			if (c.printData.size)
				c.printData.forEach((prints, lan) => {
					if (prints)
						prints.forEach((date, code) => {
							insertPrintData.run(code, lan, c.dbId, date)
						})
				})
		}
	})
	insertAllData(searchData)


	// Insert the new images into the bot DB.
	botDb.transaction(imageSearches => {
		for (const s of imageSearches)  {
			const card = s.data
			card.imageData.forEach((imgPath, id) => {
				addImageData.run(card.dbId, card.passcode, card.name.get('en'), id, imgPath)
			})
		}
	})
	// Add search terms for all of these as well.
	addToTermCache(searchData, 'bot', db)
}

/**
 * Evicts any values matching the given IDs from the bot database.
 * @param {Array<Number>} ids The set of IDs to evict.
 */
function evictFromBotCache(ids) {
	const delTerms = botDb.prepare('DELETE FROM termCache WHERE dbId = ? AND location = \'bot\'')
	const delData = botDb.prepare('DELETE FROM dataCache WHERE dbId = ?')
	const delPrints = botDb.prepare('DELETE FROM cardDataPrints WHERE dbId = ?')

	const delMany = botDb.transaction(vals => {
		for (const v of vals) {
			delTerms.run(v)
			delData.run(v)
			delPrints.run(v)
		}
	})
	delMany(ids)
}

/**
 * Clears the bot cache by removing all cached search terms and data.
 * @param {Boolean} clearKonamiTerms Whether to remove search terms that reference the Konami database too.
 */
function clearBotCache(clearKonamiTerms = false) {
	botDb.prepare('PRAGMA foreign_keys = 1').run()
	botDb.prepare('DELETE FROM dataCache').run()
	botDb.prepare('DELETE FROM cardDataPrints').run()
	botDb.prepare('VACUUM').run()

	// Default behavior is to only remove search terms that reference the bot data cache,
	// and leave cached Konami terms untouched. But every now and again we want to fully reset
	// the search term cache for sanity's sake.
	if (clearKonamiTerms)
		botDb.prepare('DELETE FROM termCache').run()
	else
		botDb.prepare('DELETE FROM termCache WHERE location = \'bot\'').run()

	// Delete our cached card images too.
	const imagesPath = `${process.cwd()}/data/card_images`
	const files = fs.readdirSync(imagesPath)
	for (const f of files)
		fs.unlinkSync(`${imagesPath}/${f}`)

	logger.info('The bot database cache has been reset.')
}

module.exports = {
	botDb, searchTermCache, searchBotDb, addToTermCache, addToBotDb, evictFromBotCache, clearBotCache
}