const { EmbedBuilder } = require('discord.js')
const Table = require('ascii-table')

const { TCGPLAYER_LOGO, TCGPLAYER_SET_SEARCH, TCGPLAYER_PRICE_TIMEOUT } = require('./Defines')
const { logger } = require('lib/utils/logging')

/**
 * @typedef {Object} Prices
 * @property {Number} lowPrice
 * @property {Number} midPrice
 * @property {Number} highPrice
 * @property {Number} marketPrice
 * @property {Date} cacheTime
 */

/**
 * Container class for all information relevant to us related to a given
 * TCGPlayer product.
 */
class TCGPlayerProduct {
	constructor() {
		this.productId = null			// TCGPlayer product ID. Unique per print.
		this.fullName = null			// TCGPlayer product full name.

		/** @type {TCGPlayerSet} */
		this.set = null					// TCGPlayer set this product is in.

		this.rarity = null				// The rarity this card was printed in.
		this.printCode = null			// The print code (i.e., <SETCODE>-<CARD#>) associated with this print.

		/** @type {Array<TCGPlayerPrice>} */
		this.priceData = []				// Price data associated with this product.
	
		this.cacheTime = undefined		// A Date timestamp for when this product's data finished being cached.
	}

	/**
	 * Gathers the relevant price data to be displayed.
	 * @param {Object} options Options relevant to what data to display.
	 * @returns {Array<Object>} An array of price data relevant for display.
	 */
	getPriceDataForDisplay(options) {
		const displayPriceData = []

		// If this has no rarity or print code, it's not a card. Probably a booster or tin, skip.
		if (!this.rarity || !this.printCode)
			return displayPriceData

		const useName = options && options.useName 
		
		if (this.priceData.length) {
			// Trim the "Rare" from the rarity, it's redundant for display purposes.
			let trimmedRarity = this.rarity !== 'Rare' ? this.rarity.replace(/\s*Rare$/, '') : this.rarity
			// Also trim down DT and prismatic rarities, they're friggin' long otherwise.
			trimmedRarity = trimmedRarity.replace(/Duel Terminal Technology/, 'DT')
				.replace(/Duel Terminal/, 'DT')
				.replace(/Prismatic/, 'Pris.')
				.replace(/Quarter Century/, 'QC')

			const productData = { 
				identifier: useName ? this.fullName : this.printCode,
				rarity: trimmedRarity
			}

			let cheapestPrint = undefined
			let expensivePrint = undefined
			for (const pd of this.priceData) {
				// If there's only one type in here, treat it as Unlimited.
				// (There's no distinction to be made with 1st Ed in this case).
				const adjType = this.priceData.length === 1 ? 'Unlimited' : pd.type

				// Find the cheapest + most expensive prices among these.
				if (!cheapestPrint || pd.marketPrice < cheapestPrint.marketPrice)
					cheapestPrint = { ...pd, type: adjType, ...productData }
				if (!expensivePrint || pd.marketPrice > expensivePrint.marketPrice)
					expensivePrint = { ...pd, type: adjType, ...productData }
			}
			// If the difference between the market price of the cheapest and most expensive prints are >=25%, display both.
			const diff = Math.abs(cheapestPrint.marketPrice - expensivePrint.marketPrice) /
				( (cheapestPrint.marketPrice + expensivePrint.marketPrice) / 2 )
			if (diff > 0.25)
				displayPriceData.push(expensivePrint)
			displayPriceData.push(cheapestPrint)
		}

		return displayPriceData
	}
}

/**
 * Container class for all information relevant to us related to a given
 * TCGPlayer group (i.e., set).
 */
class TCGPlayerSet {
	constructor() {
		this.setId = null				// TCGPlayer group ID (group === set in the API).
		this.setCode = null				// Abbreviated code of the set (e.g., ROTD, MRD, etc.)
		this.fullName = null			// Full name of the set (e.g., Return of the Duelist, Metal Raiders, etc.)

		/** @type {Array<TCGPlayerProduct>} */
		this.products = []				// The products that are a part of this set.

		this.cacheTime = undefined		// A Date timestamp for when this set's data finished being cached.
	}

	/**
	 * Generic wrapper for generating any type of embed.
	 * @param {Object} options Relevant options (type, locale, etc.) that are passed on to more specific embed functions.
	 * @returns {Object} An object containing the generated embed and data relevant to it (e.g., attachments).
	 */
	async generateEmbed(options) {
		let embedData = {}

		if ('type' in options)
			var type = options.type
		if ('locale' in options)
			var locale = options.locale
		if ('official' in options)
			var official = options.official

		// Always assume set embeds are price embeds.
		embedData = this.generatePriceEmbed(locale, official)

		return embedData
	}

	/**
	 * Generates an embed containing all of the price data of products associated with this set.
	 * @param {String} locale The locale to reference for the price data. 
	 * @param {Boolean} official Whether to only include official Konami information.
	 * @param filters Any data filters (rarity, name, price, etc.) to be applied to the data.
	 * @returns The generated EmbedBuilder.
	 */
	generatePriceEmbed(locale, official, filters) {
		const embedData = {}
		
		// We shouldn't be here with no product data, but do a final sanity check to make sure we leave if so.
		if (!this.products.length)
			return embedData
		
		const finalEmbed = new EmbedBuilder()

		// Default descending (most expensive first). If we're given a sort, use that.
		const sort = filters && 'sort' in filters ? filters.sort : 'desc'
		if (sort === 'asc')
			var sortFunction = (l, r) => l.marketPrice - r.marketPrice
		else 
			sortFunction = (l, r) => r.marketPrice - l.marketPrice

		// Gather the prices to put in the table.
		let pricesToDisplay = []
		for (const p of this.products) {
			// Apply any filters so we know which products we don't care about.
			if (filters && Object.keys(filters).length) {
				if ('rarity' in filters && p.rarity) 
					// If the rarity filter has "Rare" in the name, we want an exact match. This is to cover special cases where they'd otherwise be caught as substrings of other rarities,
					// e.g. "Secret Rare" is also part of "Quarter Century Secret Rare", or "Gold Secret Rare", etc.
					if (filters.rarity.inclues('Rare') && p.rarity !== filters.rarity) {
						continue
					}
					else if (!p.rarity.match(new RegExp(filters.rarity))) continue
			}

			let priceDataOptions = { useName: true }
			if (filters)
				priceDataOptions = { ...priceDataOptions, ...filters }
			const productDisplayData = p.getPriceDataForDisplay(priceDataOptions)
			if (productDisplayData.length) {
				pricesToDisplay.push(...productDisplayData)
			}
		}
		// Didn't find any prices to display.
		if (!pricesToDisplay.length) return embedData

		// Sort according to whatever we were given.
		pricesToDisplay = pricesToDisplay.sort((p1, p2) => sortFunction(p1, p2))

		const priceTable = new Table()
		priceTable.setHeading('Name', 'Rarity', 'Low-Market')
		// Only display prices until our table is too big for one field. Keep track of any we omit.
		let fieldFull = false
		const omittedPrints = {}
		let oldestPriceCache = undefined
		for (const price of pricesToDisplay) {
			if (!fieldFull) {
				// Distinguish 1st Ed prints in the table.
				const typeRarity = price.type === '1st Edition' ? `${price.rarity} (1st)` : price.rarity
				// Truncate names that are too long.
				const truncName = price.identifier.length > 23 ? price.identifier.slice(0, 20) + '…' : price.identifier
				priceTable.addRow(truncName, typeRarity, `$${price.lowPrice}-${price.marketPrice}`)

				// Make sure this row hasn't made the table too big.
				if (priceTable.toString().length >= 1018) {
					fieldFull = true
					// Dump this table to a JSON, remove the last row in it since we don't want it, then reload.
					const tableJson = priceTable.toJSON()
					tableJson.rows.pop()
					priceTable.fromJSON(tableJson)
				}
			}
			if (fieldFull) {
				if (!(price.rarity in omittedPrints))
					omittedPrints[price.rarity] = 0
				omittedPrints[price.rarity]++
			}
			else {
				// Find a representative price cache time from among the prices we're displaying.
				// They can be different, so just pick the oldest one.
				if (!oldestPriceCache || price.cacheTime < oldestPriceCache)
					oldestPriceCache = price.cacheTime
			}
		}
		let extraInfo = `\nOldest price(s) cached at **${oldestPriceCache.toUTCString()}**, will go stale after 8 hrs.\nDisplaying ${sort === 'desc' ? 'most expensive' : 'least expensive'} prices first. This ignores 1st Edition prices unless they are 25%+ more expensive than the Unlimited print.`
		// Count our omissions.
		const omissions = []
		for (const rarity in omittedPrints) 
			omissions.push(`${omittedPrints[rarity]} ${rarity}`)
		if (omissions.length)
			extraInfo += `\n**Omitted:** ${omissions.join(', ')} print(s)`

		// Set up the embed now that we have all our info.
		// Still display the typical "author line" (name, property, link, etc.)
		const embedName = this.fullName + ` (${this.setCode})`
		finalEmbed.setAuthor({ name: embedName })
		finalEmbed.setFooter({ text: 'This bot uses TCGPlayer price data, but is not endorsed or certified by TCGPlayer.', iconURL: TCGPLAYER_LOGO })
		finalEmbed.setTitle('View on TCGPlayer')
		const tcgplayerUrlName = this.fullName.replace(/\s/g, '-').toLowerCase()
		finalEmbed.setURL(`${TCGPLAYER_SET_SEARCH}${tcgplayerUrlName}?setName=${tcgplayerUrlName}`)
		finalEmbed.setDescription(extraInfo)
		finalEmbed.addFields({ name: '__Price Data__', value: '```\n' + priceTable.toString() + '```', inline: false })

		embedData.embed = finalEmbed
		return embedData
	}

	/**
	 * Returns the members of the products array of TCGPlayerProducts that do not have any price data.
	 * @returns {Array<TCGPlayerProduct>}
	 */
	getProductsWithoutPriceData() {
		return this.products.filter(p => !p.priceData.length)
	}

	/**
	 * Determines whether the price data for this Set is considered resolved.
	 * Sometimes we can't get prices for every product but still want to report what we do have,
	 * so this also considers prices to be "resolved" if enough of our products have price data.
	 * @returns {Boolean} Whether the price data is to be considered resolved.
	 */
	hasResolvedPriceData() {
		const numProductsWithoutPriceData = this.getProductsWithoutPriceData().length
		// If all of our products have price data, we're definitely resolved.
		let fullyResolved = numProductsWithoutPriceData === 0

		// If not, call a threshold for declaring whether things are "good enough".
		// Currently, if >90% of our products have price data, we call it resolved.
		// (Or in this case, we're testing for whether <10% of the products DON'T have price data.)
		if (!fullyResolved) {
			if (numProductsWithoutPriceData / this.products.length < 0.10)
				fullyResolved = true
		}

		return fullyResolved
	}

	/**
	 * Prints this object as a string. Uses set name and code if available.
	 * @returns {String}
	 */
	toString() {
		const strParts = []

		if (this.fullName) strParts.push(`Name(${this.fullName})`)
		if (this.setCode) strParts.push(`Code(${this.setCode})`)

		return strParts.join(', ')
	}
}

/**
 * Container class for all information relevant to us related to a TCGPlayer price.
 */
class TCGPlayerPrice {
	constructor() {
		this.type = null			// Price type (Unlimited, 1st Ed, etc.)
		this.lowPrice = null		// Lowest price listing.
		this.midPrice = null		// Median price listing.
		this.highPrice = null		// Highest price listing.
		this.marketPrice = null		// TCGPlayer market price.
		/** @type {Date} */
		this.cacheTime = null		// When this data was retrieved.
	}

	/**
	 * Sets the cache time for the price.
	 * This wraps a check for whether the given time is stale (i.e., too old).
	 * If so, it does not set the cache time and keeps it null.
	 * @param {Date | String} time The new cache time.
	 * @returns Whether the cache time was updated.
	 */
	updateCacheTime(newTime) {
		if (newTime instanceof String)
			newTime = new Date(newTime)
			
		const staleTime = new Date(newTime.valueOf() + TCGPLAYER_PRICE_TIMEOUT)
		const update = new Date() < staleTime

		if (update) this.cacheTime = newTime

		return update
	}
}

module.exports = {
	TCGPlayerProduct, TCGPlayerSet, TCGPlayerPrice
}