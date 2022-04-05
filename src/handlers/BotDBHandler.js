const Database = require('better-sqlite3')
const fs = require('fs')

const Search = require('lib/models/Search')
const { BOT_DB_PATH } = require('lib/models/Defines')
const { logger, logError } = require('lib/utils/logging')
const { TCGPlayerSet, TCGPlayerProduct } = require('lib/models/TCGPlayer')
const Card = require('lib/models/Card')

const botDb = new Database(BOT_DB_PATH)

/**
 * @typedef {Object} SetData
 * @property {Number} setId
 * @property {TCGPlayerSet} setData
 */
/**
 * @typedef {Object} ProductData
 * @property {Number} productId
 * @property {TCGPlayerProduct} productData
 */
/**
 * @typedef {Object} PriceData
 * @property {SetData} sets
 * @property {ProductData} products 
 */

/**
 * Search within the search term cache to find any matches for the given searches.
 * If a match is found, then branch off to the correct logic for resolving that match to data.
 * @param {Array<Search>} searches The array of relevant searches to evaluate.
 * @param {Query} qry The query that contains all relevant searches.
 * @param {Function} dataHandlerCallback The callback for handling the data produced by this search.
 */
function searchTermCache(searches, qry, dataHandlerCallback) {
	// Track all searches in each location so we can divvy things up and query them all at once.
	const cachedBotData = []
	const cachedKonamiData = []
	const cachedTcgplayerData = []

	const sqlQry = `SELECT dbId, passcode, fullName, location, locale
					FROM termCache 
					WHERE term = ?`
	// Iterate through the array backwards because we might modify it as we go.
	for (let i = searches.length - 1; i >= 0; i--) {
		const currSearch = searches[i]
		const currTerm = currSearch.term

		const dbRows = botDb.prepare(sqlQry).all(currTerm)
		// Find a representative row. Prioritize any EN locale one.
		let repRow = dbRows.filter(r => r.locale === 'en')
		if (!repRow) {
			// Otherwise, get one with a locale we need.
			repRow = dbRows.filter(r => currSearch.localeToTypesMap.has(r.locale))
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
			if (repRow.location === 'konami')
				cachedKonamiData.push(currSearch)
		}
		// If this is a $-type search, look at our cached TCGPlayer data too.
		if (currSearch.hasType('$')) {
			cachedTcgplayerData.push(currSearch)
		}
		// Otherwise, there's nothing here, so nothing to do.
	}

	// Resolve bot data.
	let resolvedBotSearches = []
	let termUpdates = []
	if (cachedBotData.length) {
		const botSearchResults = searchBotDb(cachedBotData, qry)
		resolvedBotSearches = botSearchResults.resolved
		termUpdates = botSearchResults.termUpdates
	}
	if (cachedTcgplayerData.length) {
		searchTcgplayerData(cachedTcgplayerData)
	}
	
	dataHandlerCallback(resolvedBotSearches, termUpdates, cachedKonamiData)
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
	const searchResults = {
		'resolved': [],
		'termUpdates': []
	}

	const getDbId = 'SELECT * FROM dataCache WHERE dbId = ?'
	const getPasscode = 'SELECT * FROM dataCache WHERE passcode = ?'
	const getDataName = 'SELECT * FROM dataCache WHERE dataName = ?'

	// Iterate through the array backwards because we might modify it as we go.
	for (let i = searches.length - 1; i >= 0; i--) {
		const currSearch = searches[i]
		// If the search term is a number, then it's a database ID or passcode.
		if (Number.isInteger(currSearch.term)) {
			const dataRows = botDb.prepare(getDbId).all(currSearch.term)
			if (dataRows.length) {
				currSearch.rawData = dataRows
				searchResults.resolved.push(currSearch)
			}
			else {
				// DB ID didn't give anything, move to passcode.
				const dataRows = botDb.prepare(getPasscode).all(currSearch.term)
				if (dataRows.length) {
					currSearch.rawData = dataRows
					// If we have a better term, update where necessary.
					const dbId = dataRows[0].dbId
					if (dbId) {
						const mergedSearch = qry.updateSearchTerm(currSearch.term, dbId)
						if (!mergedSearch) {
							searchResults.resolved.push(currSearch)
							searchResults.termUpdates.push(currSearch)
						}
					}
				}
			}
			
		}
		else {
			// Only thing this can be is a card name.
			const dataRows = botDb.prepare(getDataName).all(currSearch.term)
			if (dataRows.length) {
				currSearch.rawData = dataRows
				// If we have a better term, update where necessary.
				const betterTerm = dataRows[0].dbId ?? dataRows[0].passcode
				if (betterTerm) {
					const mergedSearch = qry.updateSearchTerm(currSearch.term, betterTerm)
					if (!mergedSearch) {
						searchResults.resolved.push(currSearch)
						searchResults.termUpdates.push(currSearch)
					}
				}
			}
		}
	}

	return searchResults
}

/**
 * Search the bot database for any cached TCGPlayer data related to these searches.
 * @param {Array<Search>} searches The searches to evaluate for cached TCGPlayer data. 
 */
function searchTcgplayerData(searches) {
	for (const currSearch of searches) {
		// Sanity check: non-$-type searches shouldn't be making it here, don't waste time on them if they do.
		if (!currSearch.hasType('$')) continue

		const searchData = currSearch.data
		// We don't know what this is yet. The only thing we might be able to find at this point is a set, so look for that.
		if (!searchData) {
			let setQry = botDb.prepare(`SELECT * FROM tcgplayerSets WHERE setCode = ?`)
			let setRow = setQry.get(currSearch.term)
			if (!setRow) {
				// Try set name next.
				setQry = botDb.prepare('SELECT * FROM tcgplayerSets WHERE setFullName = ? COLLATE NOCASE')
				setRow = setQry.get(currSearch.term)
			}
		
			if (setRow) {
				// Yep, this is a set. Just grab the data in here.
				const productQry = botDb.prepare('SELECT * FROM tcgplayerProducts WHERE setId = ?')
				const priceQry = botDb.prepare('SELECT * FROM tcgplayerProductPrices WHERE tcgplayerProductId = ?')

				const tcgSet = new TCGPlayerSet()
				currSearch.data = tcgSet
				tcgSet.setId = setRow.tcgplayerSetId
				tcgSet.setCode = setRow.setCode
				tcgSet.fullName = setRow.setFullName
				tcgSet.cacheTime = new Date(row.cachedTimestamp)
				// Get its products.
				const productRows = productQry.all(tcgSet.setId)
				for (const r of productRows) {
					const tcgProduct = new TCGPlayerProduct()
					tcgProduct.productId = r.tcgplayerProductId
					tcgProduct.fullName = r.fullName
					tcgProduct.set = tcgSet
					tcgProduct.rarity = r.rarity
					tcgProduct.priceCode = r.printCode
					tcgProduct.cacheTime = new Date(r.cachedTimestamp)
					// Get the product's price data if we have it.
					const priceRows = priceQry.all(tcgProduct.productId)
					for (const p of priceRows) {
						tcgProduct.priceData.set(p.type, {
							lowPrice: p.lowPrice,
							midPrice: p.midPrice,
							highPrice: p.highPrice,
							marketPrice: p.marketPrice,
							cacheTime: p.cachedTimestamp
						})
					}
					tcgSet.products.push(tcgProduct)
				}
			}
		}
		else if (searchData instanceof Card) {
			// If we have a Card, then we need to try and fill out its products.
			// Use either its DB ID (if we have it) or its English name as the search.
			if (searchData.dbId) { 
				var searchTerm = searchData.dbId
				var where = 'WHERE dbId = ?'
			}
			else {
				searchTerm = searchData.name.get('en')
				where = 'WHERE fullname = ?'
			}
			
			const productQry = botDb.prepare(`SELECT * FROM tcgplayerProducts ${where}`)
			const priceQry = botDb.prepare('SELECT * FROM tcgplayerProductPrices WHERE tcgplayerProductId = ?')
			const productRows = productQry.all(searchTerm)
			for (const r of productRows) {
				const tcgProduct = new TCGPlayerProduct()
				tcgProduct.productId = r.tcgplayerProductId
				tcgProduct.fullName = r.fullName
				// Don't fill out the set, we don't need it.
				tcgProduct.rarity = r.rarity
				tcgProduct.priceCode = r.printCode
				tcgProduct.cacheTime = new Date(r.cachedTimestamp)
				// Get the product's price data if we have it.
				const priceRows = priceQry.all(tcgProduct.productId)
				for (const p of priceRows) {
					tcgProduct.priceData.set(p.type, {
						lowPrice: p.lowPrice,
						midPrice: p.midPrice,
						highPrice: p.highPrice,
						marketPrice: p.marketPrice,
						cacheTime: p.cachedTimestamp
					})
				}
				searchData.products.push(tcgProduct)
			}
		}
	}
}

/**
 * Adds search terms to the cache. If one already exists, it will update the existing one.
 * @param {Array<Search>} searchData All searches (and their data) to add to the search term cache.
 * @param {String} fromLoc The location this data is stored in (bot or konami DB).
 */
function addToTermCache(searchData, fromLoc) {
	const insertTerm = botDb.prepare(`INSERT OR REPLACE INTO termCache(term, dbId, passcode, fullName, location, locale)
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
 * Populates a Card's data with data from the bot database.
 * This function will not overwrite any data that already exists in the Card that is passed.
 * @param {Array<botDataCacheRow>} dbRows Rows of data returned from the dataCache bot DB table.
 * @param {Card} card The card with data to populate.
 */
 function populateCardFromBotData(dbRows, card) {
	// Just use the first row as a representative for all the stats that aren't locale-sensitive.
	const repRow = dbRows[0]
	
	// Map locale-sensitive rows.
	for (const r of dbRows) {
		if (!card.name.get(r.locale)) card.name.set(r.locale, r.dataName)
		if (!card.name.get(r.locale)) card.effect.set(r.locale, r.effect)
		if (r.pendEffect && !card.pendEffect.get(r.locale))
			card.pendEffect.set(r.locale, r.pendEffect)
	}
	if (!card.dbId) card.dbId = repRow.dbId
	if (!card.passcode) card.passcode = repRow.passcode
	if (!card.cardType) card.cardType = repRow.cardType
	if (!card.property) card.property = repRow.property
	if (!card.attribute) card.attribute = repRow.attribute
	if (!card.levelRank) card.levelRank = repRow.levelRank
	if (!card.attack) card.attack = repRow.attack
	if (!card.defense) card.defense = repRow.defense
	if (!card.pendScale) card.pendScale = repRow.pendScale
	if (!card.notInCg) card.notInCg = repRow.notInCg	

	// Grab junction table values too. We can search in those based on DB ID, passcode, or name.
	// Change what we're searching for based on what values we have:
	// - if we have DB ID, use that,
	// - if no DB ID but we have passcode, use that,
	// - use name as a last resort.
	if (card.dbId) {
		var where = 'WHERE dbId = ?'
		var searchParam = card.dbId
	}
	else if (card.passcode) {
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
	if (card.cardType === 'monster') {
		let isLink = false
		const typeRows = botDb.prepare(getCardTypes).all(searchParam)
		for (const r of typeRows) {
			card.types.push(r.type)
			if (!isLink && r.type === 'Link') isLink = true
		}

		// If this is a Link Monster, get its markers.
		if (isLink) {
			const markerRows = botDb.prepare(getLinkMarkers).all(searchParam)
			for (const r of markerRows) card.linkMarkers.push(r.marker)
		}
	}

	// Gather art data.
	const getImages = `SELECT artId, artPath FROM cardDataImages ${where}`
	const imageRows = botDb.prepare(getImages).all(searchParam)
	for (const r of imageRows) {
		const localPath = r.artPath.includes('data/card_images')
		card.addImageData(r.artId, r.artPath, localPath, !localPath)
	}
	
	// Gather print data.
	const getPrints = `SELECT printCode, locale, printDate FROM cardDataPrints ${where}`
	const printRows = botDb.prepare(getPrints).all(searchParam)
	for (const r of printRows) {
		const printsInLocale = card.printData.get(r.locale)

		if (printsInLocale) printsInLocale.set(r.printCode, r.printDate)
		else {
			card.printData.set(r.locale, new Map())
			card.printData.get(r.locale).set(r.printCode, r.printDate)
		}
	}

	// TODO: Gather pricing information as well.
}

/**
 * Adds card data to the bot database. If a card already exists with given data, it will update the existing one.
 * @param {Array<Search>} searchData The searches with card data to add to the bot database.
 */
function addToBotDb(searchData) {
	if (!searchData.length) return
	
	const insertDataCache = botDb.prepare(`
		INSERT OR REPLACE INTO dataCache(dataName, locale, dbId, passcode, cardType, property, attribute, levelRank, attack, defense, effect, pendEffect, pendScale, notInCg)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
		INSERT OR REPLACE INTO cardDataImages(dbId, passcode, fullName, artId, artPath)
		VALUES(?, ?, ?, ?, ?)
	`)
	const insertPrintData = botDb.prepare(`
		INSERT OR REPLACE INTO cardDataPrints(printCode, locale, dbId, printDate)
		VALUES(?, ?, ?, ?)
	`)
	// TODO: Check and update pricing information as well.

	let insertAllData = botDb.transaction(searches => {
		for (const s of searches) {
			const c = s.data
			c.name.forEach((n, l) => {
				insertDataCache.run(
					n, l, c.dbId, c.passcode, c.cardType, c.property, c.attribute, c.levelRank, c.attack,
					c.defense, c.effect.get(l) || null, c.pendEffect.get(l) || null, c.pendScale, c.notInCg
				)
			})
			// Update types and link markers as necessary too.
			for (const t of c.types) insertCardTypes.run(c.dbId, c.passcode, c.name.get('en'), t)
			for (const m of c.linkMarkers) insertLinkMarkers.run(c.dbId, c.passcode, c.name.get('en'), m)
			// Update image data. Don't care about locale for this.
			if (c.imageData.size)
				c.imageData.forEach((imgPath, id) => {
					insertImageData.run(c.dbId, c.passcode, c.name.get('en'), id, imgPath)
				})
			// Update print data.
			if (c.printData.size)
				c.printData.forEach((prints, locale) => {
					if (prints)
						prints.forEach((date, code) => {
							insertPrintData.run(code, locale, c.dbId, date)
						})
				})
		}
	})
	insertAllData(searchData)

	// Add search terms for all of these as well.
	addToTermCache(searchData, 'bot', db)
}

/**
 * Inserts the given product or set data (or searches containing said data) into the bot database.
 * @param {Array<TCGPlayerSet|TCGPlayerProduct|Search>} tcgData The data to add to the database (or searches containing set data to add).
 */
function addTcgplayerDataToDb(tcgData) {
	if (!tcgData.length) return
	
	const insertProductData = botDb.prepare(`
		INSERT OR REPLACE INTO tcgplayerProducts(tcgplayerProductId, dbId, fullName, setId, printCode, rarity, cachedTimestamp)
		VALUES(?, ?, ?, ?, ?, ?, ?)
	`)
	const insertSetData = botDb.prepare(`
		INSERT OR REPLACE INTO tcgplayerSets(tcgplayerSetId, setCode, setFullName, cachedTimestamp)
		VALUES(?, ?, ?, ?)
	`)

	let insertAllData = botDb.transaction(data => {
		for (const s of data) {
			if (s instanceof TCGPlayerSet) {
				// Only insert set data here. That's all we have enough to do.
				insertSetData.run(s.setId, s.setCode, s.fullName, s.cacheTime.toString())
			}
			else if (s instanceof TCGPlayerProduct) {
				// Insert product data here. Technically we have its set's data too, but in this context populating it is redundant.
				insertProductData.run(s.productId, null, s.fullName, s.set.setId, s.printCode, s.rarity, s.cacheTime.toString())
			}
			else if (s instanceof Search) {
				const searchData = s.data
				for (const p of searchData.products) {
					insertProductData.run(
						p.productId, s.dbId, s.name.get('en'), pSet.setId, p.printCode, p.rarity,
						p.lowPrice, p.midPrice, p.highPrice, p.marketPrice)
				}
			}
		}
	})
	insertAllData(tcgData)
}

/**
 * Loads all cached TCGPlayer product data from the database.
 * This is primarily used by the TCGPlayer update crawler to find products that need to be updated.
 * @returns {PriceData} 
 */
function getCachedProductData() {
	/**
	 * @type {PriceData}
	 */
	const cachedData = {
		'sets': {},
		'products': {}
	}

	const getSetData = botDb.prepare('SELECT * FROM tcgplayerSets')
	const getProductData = botDb.prepare('SELECT * FROM tcgplayerProducts')
	const getProductPrices = botDb.prepare('SELECT * FROM tcgplayerProductPrices')

	// Load set data first so products can reference it.
	let dbRows = getSetData.all()
	for (const r of dbRows) {
		const tcgSet = new TCGPlayerSet()

		tcgSet.setId = r.tcgplayerSetId
		tcgSet.setCode = r.setCode
		tcgSet.fullname = r.setFullName
		tcgSet.cacheTime = new Date(r.cachedTimestamp)

		cachedData.sets[tcgSet.setId] = tcgSet
	}
	// Then load product data, associating it to sets along the way.
	dbRows = getProductData.all()
	for (const r of dbRows) {
		const tcgProduct = new TCGPlayerProduct()

		tcgProduct.productId = r.tcgplayerProductId
		tcgProduct.rarity = r.rarity
		tcgProduct.printCode = r.printCode
		tcgProduct.cacheTime = new Date(r.cachedTimestamp)

		// Associate this product and the set it's from.
		const fromSet = cachedData.sets[r.setId]
		if (fromSet) {
			tcgProduct.set = cachedData.sets[r.setId]
			fromSet.products.push(tcgProduct)
		}
	}
	// Then load price data, associating it to products along the way.
	// This probably won't end up doing much considering price data should be wiped often,
	// but may as well check.
	dbRows = getProductPrices.all()
	for (const r of dbRows) {
		const forProduct = cachedData.products[r.tcgplayerProductId]
		if (forProduct) {
			forProduct.priceData.set(r.type, {
				lowPrice: r.lowPrice,
				midPrice: r.midPrice,
				highPrice: r.highPrice,
				marketPrice: r.marketPrice,
				cacheTime: new Date(r.cachedTimestamp)
			})
		}
	}

	return cachedData
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
	searchTermCache, searchBotDb, populateCardFromBotData, searchTcgplayerData, 
	addToTermCache, addToBotDb, addTcgplayerDataToDb,
	getCachedProductData, evictFromBotCache, clearBotCache
}