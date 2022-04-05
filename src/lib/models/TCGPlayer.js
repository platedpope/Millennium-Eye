/**
 * @typedef {Object} Prices
 * @property lowPrice
 * @property midPrice
 * @property highPrice
 * @property marketPrice
 * @property cacheTime
 */

/**
 * Container class for all information relevant to us related to a given
 * TCGPlayer product.
 */
class TCGPlayerProduct {
	constructor() {
		this.productId = null			// TCGPlayer product ID. Unique per print.
		this.fullName = null			// TCGPlayer product full name.

		/**
		 * @type {TCGPlayerSet}
		 */
		this.set = null					// TCGPlayer set this product is in.

		this.rarity = null				// The rarity this card was printed in.
		this.printCode = null			// The print code (i.e., <SETCODE>-<CARD#>) associated with this print.

		/**
		 * @type {Map<String,Prices>}
		 */
		this.priceData = new Map()		// Price data for this card. Each key is a type of print (Unlimited, 1st Ed, etc.).
	
		this.cacheTime = undefined		// A Date timestamp for when this product's data finished being cached.
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

		/**
		 * @type {Array<TCGPlayerProduct>}
		 */
		this.products = []				// The products that are a part of this set.

		this.cacheTime = undefined		// A Date timestamp for when this set's data finished being cached.
	}

	getProductsWithoutPriceData() {
		return this.products.filter(p => !p.priceData.size)
	}
}

module.exports = {
	TCGPlayerProduct, TCGPlayerSet
}