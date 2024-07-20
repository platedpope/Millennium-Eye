const Database = require('better-sqlite3')
const fs = require('fs')

const Search = require('lib/models/Search')
const { BOT_DB_PATH, TCGPLAYER_PRICE_TIMEOUT } = require('lib/models/Defines')
const { logger, logError } = require('lib/utils/logging')
const { TCGPlayerSet, TCGPlayerProduct, TCGPlayerPrice } = require('lib/models/TCGPlayer')
const Card = require('lib/models/Card')

const botDb = new Database(BOT_DB_PATH)

// For some reason, the name on some TCGPlayer listings is different from the official name on the database.
// This is a map of "official name" -> "TCGPlayer name" used to resolve those name differences.
const tcgplayerNameAliases = {
	'Mystical Elf - White Lightning': 'Mystical Elf White Lightning'
}

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
			let setQry = botDb.prepare(`SELECT * FROM tcgplayerSets WHERE setCode = ? COLLATE NOCASE`)
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
				// Remove any other search type associated with this, they don't work with sets.
				const removeLocales = []
				for (const locale of currSearch.localeToTypesMap.keys()) {
					const trimmedTypes = [...currSearch.localeToTypesMap.get(locale)].filter(t => t === '$')
					if (trimmedTypes.length)
						currSearch.localeToTypesMap.set(locale, new Set(...trimmedTypes))
					else
						removeLocales.push(locale)
				}
				// Prune any locales that lost all their types from this.
				for (const loc of removeLocales)
					currSearch.localeToTypesMap.delete(loc)
				
				tcgSet.setId = setRow.tcgplayerSetId
				tcgSet.setCode = setRow.setCode
				tcgSet.fullName = setRow.setFullName
				tcgSet.cacheTime = new Date(setRow.cachedTimestamp)
				// Get its products.
				const productRows = productQry.all(tcgSet.setId)
				for (const r of productRows) {
					const tcgProduct = new TCGPlayerProduct()
					tcgProduct.productId = r.tcgplayerProductId
					tcgProduct.fullName = r.fullName
					tcgProduct.set = tcgSet
					tcgProduct.rarity = r.rarity
					tcgProduct.printCode = r.printCode
					tcgProduct.cacheTime = new Date(r.cachedTimestamp)
					// Get the product's price data if we have it.
					const priceRows = priceQry.all(tcgProduct.productId)
					for (const p of priceRows) {
						const pd = new TCGPlayerPrice()
						// Ignore this if the cache time is too old.
						const cacheTime = new Date(p.cachedTimestamp)
						if (!pd.updateCacheTime(cacheTime)) continue

						pd.type = p.type
						pd.lowPrice = p.lowPrice
						pd.midPrice = p.midPrice
						pd.highPrice = p.highPrice
						pd.marketPrice = p.marketPrice
						tcgProduct.priceData.push(pd)
					}
					tcgSet.products.push(tcgProduct)
				}
			}
		}
		else if (searchData instanceof Card) {
			// If we have a Card, then we need to try and fill out its products.
			const productQry = botDb.prepare(`SELECT * FROM tcgplayerProducts WHERE dbId = ? OR fullName = ? COLLATE NOCASE`)
			const priceQry = botDb.prepare('SELECT * FROM tcgplayerProductPrices WHERE tcgplayerProductId = ?')
			let productRows = productQry.all(searchData.dbId, searchData.name.get('en'))
			// If this doesn't result in anything, check our name aliases too
			// to make sure we're not missing it due to TCGPlayer having a weird name for the card.
			if (!(productRows.length)) {
				productRows = productQry.all(searchData.dbId, tcgplayerNameAliases[searchData.name.get('en')]) 
			}

			for (const r of productRows) {
				const tcgProduct = new TCGPlayerProduct()
				tcgProduct.productId = r.tcgplayerProductId
				tcgProduct.fullName = r.fullName
				tcgProduct.set = new TCGPlayerSet()
				tcgProduct.set.setId = r.setId
				// Don't fill out the rest of the set, we don't need it.
				tcgProduct.rarity = r.rarity
				tcgProduct.printCode = r.printCode
				tcgProduct.cacheTime = new Date(r.cachedTimestamp)
				// Get the product's price data if we have it.
				const priceRows = priceQry.all(tcgProduct.productId)
				for (const p of priceRows) {
					const pd = new TCGPlayerPrice()
					// Ignore this if the cache time is too old.
					const cacheTime = new Date(p.cachedTimestamp)
					if (!pd.updateCacheTime(cacheTime)) continue

					pd.type = p.type
					pd.lowPrice = p.lowPrice
					pd.midPrice = p.midPrice
					pd.highPrice = p.highPrice
					pd.marketPrice = p.marketPrice
					tcgProduct.priceData.push(pd)
				}
				searchData.products.push(tcgProduct)
			}
		}
	}
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
	const insertProductPriceData = botDb.prepare(`
		INSERT OR REPLACE INTO tcgplayerProductPrices(tcgplayerProductId, type, lowPrice, midPrice, highPrice, marketPrice, cachedTimestamp)
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
				insertSetData.run(s.setId, s.setCode, s.fullName, s.cacheTime.toISOString())
			}
			else if (s instanceof TCGPlayerProduct) {
				// Insert product data here. Technically we have its set's data too, but in this context populating it is redundant.
				insertProductData.run(s.productId, null, s.fullName, s.set.setId, s.printCode, s.rarity, s.cacheTime.toISOString())
			}
			else if (s instanceof Search) {
				const searchData = s.data
				for (const p of searchData.products) {
					for (const pd of p.priceData)
						insertProductPriceData.run(p.productId, pd.type, pd.lowPrice, pd.midPrice, pd.highPrice, pd.marketPrice, pd.cacheTime.toISOString())
					// Update card database ID too.
					if (searchData instanceof Card)
						botDb.prepare('UPDATE tcgplayerProducts SET dbId = ? WHERE fullName = ?').run(searchData.dbId, searchData.name.get('en'))
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
		const pd = new TCGPlayerPrice()
		// Ignore this if the cache time is too old.
		const cacheTime = new Date(r.cachedTimestamp)
		if (!pd.updateCacheTime(cacheTime)) continue

		const forProduct = cachedData.products[r.tcgplayerProductId]
		if (forProduct) {
			pd.type = r.type
			pd.lowPrice = r.lowPrice
			pd.midPrice = r.midPrice
			pd.highPrice = r.highPrice
			pd.marketPrice = r.marketPrice
			forProduct.priceData.push(pd)
		}
	}

	return cachedData
}

module.exports = {
	searchTcgplayerData, addTcgplayerDataToDb, getCachedProductData
}