const Database = require('better-sqlite3')

const Card = require('lib/models/Card')
const { BOT_DB_PATH } = require('lib/models/Defines')
const { Search, Query } = require('lib/models/Query')
const { logger } = require('lib/utils/logging')
const { searchKonamiDb } = require('database/KonamiDBHandler')

/**
 * Search within the search term cache to find any matches for the given searches.
 * If a match is found, then branch off to the correct logic for resolving that match to data.
 * @param {Array<Search>} searches The array of relevant searches to evaluate.
 * @param {Query} qry The query that contains all relevant searches.
 * @param {Database} db Connection to the database that is being used, if any.
 */
function searchTermCache(searches, qry, db) {
	if (db === undefined)
		db = new Database(BOT_DB_PATH, { readonly: true })
	
	// Track all searches in each location so we can divvy things up and query them all at once.
	const cachedBotData = []
	const cachedKonamiData = []
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

		const dbRows = db.prepare(sqlQry).all(currTerm)
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
			if (repRow.dbId)
				var updateMerged = qry.updateSearchTerm(currTerm, repRow.dbId)
			else if (repRow.passcode)
				updateMerged = qry.updateSearchTerm(currTerm, repRow.passcode)
			else
				updateMerged = qry.updateSearchTerm(currTerm, repRow.fullName)
			// If updating the search term resulted in a consolidation (i.e., another search is the same),
			// then just skip passing this one along, it's no longer relevant.
			if (updateMerged) continue

			if (repRow.location === 'bot')
				cachedBotData.push(currSearch)
			else if (repRow.location === 'konami')
				cachedKonamiData.push(currSearch)
		}
		// If there's nothing in the cache, nothing more to do with this search for now.
	}

	// Resolve bot and konami database before trying to fill out price data.
	if (cachedBotData.length)
		searchBotDb(cachedBotData, qry, db)
	if (cachedKonamiData.length)
		searchKonamiDb(cachedKonamiData, qry)
	/* TODO
	if (cachedPriceData.length)
	*/

	db.close()
}

/**
 * Adds search terms to the cache. If one already exists, it will update the existing one.
 * @param {Array<Search>} newData All searches (and their data) to add to the search term cache.
 * @param {String} fromLoc The location this data is stored in (bot or konami DB).
 * @param {Database} db Connection to the database that is being used, if any.
 */
function addToTermCache(newData, fromLoc, db) {
	if (db === undefined)
		db = new Database(BOT_DB_PATH)

	const insertTerm = db.prepare(`INSERT OR REPLACE INTO termCache(term, dbId, passcode, fullName, location, language)
								   VALUES(?, ?, ?, ?, ?, ?)`)

	const insertMany = db.transaction(searchData => {
		for (const s of searchData) {
			s.data.name.forEach((n, l) => {
				// Capture any "original" searches that ended up mapping to this.
				for (const o of s.originals) insertTerm.run(o, s.data.dbId, s.data.passcode, n, fromLoc, l)
			})
		}
	})
	insertMany(newData)

	db.close()
}

/**
 * Search the bot database for data that is associated with our searches.
 * Note that nothing gets into the bot database without also being in the term cache,
 * so the only way to get to this logic is through matching a cached search term.
 * @param {Array<Search>} searches The array of relevant searches to evaluate.
 * @param {Query} qry The query that contains all relevant searches.
 * @param {Database} db Connection to the database that is being used, if any.
 */
function searchBotDb(searches, qry, db) {
	if (db === undefined)
		db = new Database(BOT_DB_PATH, { readonly: true })

	// Function to fill out Card data using rows returned from the database.
	const formCard = dbRows => {
		const card = new Card()

		// Just use the first row as a representative for all the stats that aren't language-sensitive.
		const repRow = dbRows[0]
		
		// Map language-sensitive rows.
		for (const r of dbRows) {
			card.name.set(r.language, r.name)
			card.effect.set(r.language, r.effect)
			card.pendEffect.set(r.language, r.pendEffect)
		}
		card.dbId = repRow.dbId
		card.passcode = repRow.passcode
		card.cardType = repRow.cardType
		card.property = repRow.property
		card.attribute = repRow.attribute
		card.levelRank = repRow.levelRank
		card.attack = repRow.attack
		card.defense = repRow.defense
		card.pendScale = repRow.pendScale
		card.notInCg = repRow.notInCg	

		// Need to grab junction table values too.
		// We can search in those based on DB ID, passcode, or name.
		// Change what we're searching for based on what values we have:
		// - if we have DB ID, use that,
		// - if no DB ID but we have passcode, use that,
		// - use name as a last resort.
		if (card.dbId !== null) {
			var where = 'WHERE dbId = ?'
			var searchParam = card.dbId
		}
		else if (card.passcode !== null) {
			where = 'WHERE passcode = ?'
			searchParam = card.passcode
		}
		else {
			where = 'WHERE name = ?'
			searchParam = card.name
		}

		const getCardTypes = `SELECT type FROM cardDataTypes ${where}`
		const getLinkMarkers = `SELECT marker FROM cardDataLinkMarkers ${where}`
	
		// If this is a monster, get its types.
		if (card.cardType === 'Monster') {
			let isLink = false
			const typeRows = db.prepare(getCardTypes).all(searchParam)
			for (const r of typeRows) {
				card.types.push(r.type)
				if (!isLink && r.type === 'Link') isLink = true
			}

			// If this is a Link Monster, get its markers.
			if (isLink) {
				const markerRows = db.prepare(getLinkMarkers).all(searchParam)
				for (const r of markerRows) card.linkMarkers.push(r.marker)
			}
		}

		// TODO: Gather pricing and print information as well.

		return card
	}

	const getDbId = 'SELECT * FROM dataCache WHERE dbId = ?'
	const getPasscode = 'SELECT * FROM dataCache WHERE passcode = ?'
	const getDataName = 'SELECT * FROM dataCache WHERE dataName = ?'
	// Track anything we need to update in the database so we can process them in a batch.
	const termsToUpdate = []

	// Iterate through the array backwards because we might modify it as we go.
	for (let i = searches.length - 1; i >= 0; i--) {
		const currSearch = searches[i]
		// If the search term is a number, then it's a database ID or passcode.
		if (Number.isInteger(currSearch.term)) {
			const dataRows = db.prepare(getDbId).all(currSearch.term)
			if (dataRows.length) currSearch.data = formCard(dataRows)
			else {
				// DB ID didn't give anything, move to passcode.
				const dataRows = db.prepare(getPasscode).all(currSearch.term)
				if (dataRows.length) {
					currSearch.data = formCard(dataRows)
					// If we have a better term, update where necessary.
					if (currSearch.data.dbId) {
						const mergedSearch = qry.updateSearchTerm(currSearch.term, currSearch.data.dbId)
						if (!mergedSearch)
							termsToUpdate.push(currSearch)
					}
				}
			}
			
		}
		else {
			const dataRows = db.prepare(getDataName).all(currSearch.term)
			if (dataRows.length) {
				currSearch.data = formCard(dataRows)
				// If we have a better term, update where necessary.
				const betterTerm = currSearch.data.dbId ?? currSearch.data.passcode
				if (betterTerm) {
					const mergedSearch = qry.updateSearchTerm(currSearch.term, betterTerm)
					if (!mergedSearch)
						termsToUpdate.push(currSearch)
				}
			}
		}
	}

	db.close()

	if (termsToUpdate.length)
		addToTermCache(termsToUpdate, 'bot')
}

/**
 * Adds card data to the bot database. If a card already exists with given data, it will update the existing one.
 * @param {Array<Search>} searchData The searches with card data to add to the bot database.
 */
function addToBotDb(searchData) {
	const db = new Database(BOT_DB_PATH)

	const insertDataCache = db.prepare(`INSERT OR REPLACE INTO dataCache(dataName, language, dbId, passcode, cardType, property, attribute, levelRank, attack, defense, effect, pendEffect, pendScale, requirement, image, notInCg)
							 		  VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
	const insertCardTypes = db.prepare(`INSERT OR REPLACE INTO cardDataTypes(dbId, passcode, fullName, type)
									  VALUES(?, ?, ?, ?)`)
	const insertLinkMarkers = db.prepare(`INSERT OR REPLACE INTO cardDataLinkMarkers(dbId, passcode, fullName, marker)
										VALUES(?, ?, ?, ?)`)
	// TODO: Check and update pricing information as well.

	let insertAllData = db.transaction(cardData => {
		for (const c of cardData) {
			c.name.forEach((n, l) => {
				insertDataCache.run(
					n, l, c.dbId, c.passcode, c.cardType, c.property, c.attribute, c.levelRank, c.attack,
					c.defense, c.effect.get(l), c.pendEffect.get(l), c.pendScale, c.requirement, c.image, c.notInCg
				)
			})
			// Update types and link markers as necessary too.
			for (const t of c.types) insertCardTypes.run(c.dbId, c.passcode, c.name, t)
			for (const m of c.linkMarkers) insertLinkMarkers.run(c.dbId, c.passcode, c.name, m)
		}
	})
	insertAllData(searchData)

	// Add search terms for all of these as well.
	addToTermCache(searchData, 'bot', db)

	db.close()
}

/**
 * Evicts any values matching the given IDs from the bot database.
 * @param {Array<Number>} ids The set of IDs to evict.
 */
function evictFromBotCache(ids) {
	const db = new Database(BOT_DB_PATH)

	const delTerms = db.prepare('DELETE FROM termCache WHERE dbId = ? AND location = \'bot\'')
	const delData = db.prepare('DELETE FROM dataCache WHERE dbId = ?')

	const delMany = db.transaction(vals => {
		for (const v of vals) {
			delTerms.run(v)
			delData.run(v)
		}
	})
	delMany(ids)

	db.close()
}

/**
 * Clears the bot cache by removing all cached search terms and data.
 * @param {Boolean} clearKonamiTerms Whether to remove search terms that reference the Konami database too.
 */
function clearBotCache(clearKonamiTerms = false) {
	const db = new Database(BOT_DB_PATH)

	db.prepare('PRAGMA foreign_keys = 1').run()
	db.prepare('DELETE FROM dataCache').run()
	db.prepare('VACUUM').run()

	// Default behavior is to only remove search terms that reference the bot data cache,
	// and leave cached Konami terms untouched. But every now and again we want to fully reset
	// the search term cache for sanity's sake.
	if (clearKonamiTerms)
		db.prepare('DELETE FROM termCache').run()
	else
		db.prepare('DELETE FROM termCache WHERE location = \'bot\'').run()

	db.close()

	logger.info('The bot database cache has been reset.')
}

module.exports = {
	searchTermCache, addToTermCache, searchBotDb, addToBotDb, evictFromBotCache, clearBotCache
}