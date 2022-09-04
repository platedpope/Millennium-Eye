const Card = require('./Card')
const Ruling = require('./Ruling')
const { TCGPlayerSet } = require('./TCGPlayer')

/**
 * Container class for a single search. It tracks any original terms used to map to its data,
 * the current best-available search term it used to resolve any data,
 * the search types that are associated with any terms that resolved to this search, and, of course,
 * the actual data that the search resolves to, e.g., any associated Card object.
 */
 class Search {
	/**
	 * Initializes the search properties.
	 * @param {String | Number} content The content of the search (i.e., what is being searched for).
	 * @param {String} type The type of search (e.g., i, r, etc.)
	 * @param {String} locale The locale of the search (e.g., en, es, etc.)
	 */
	constructor(content, type, locale) {
		// The original search term associated with this card data.
		// This is a Set because it may end up containing multiple original searches over time.
		this.originals = new Set()
		this.originals.add(content)
		// The search term that will be used to resolve data for this object.
		// This starts the same as the original, but can change over time
		// as the databases/APIs find a better search term.
		this.term = content
		/** 
		 * @type {Map<String,Set<String>>} Each locale-type pair associated with this search.
		 */
		this.localeToTypesMap = new Map()
		if (type !== undefined && locale !== undefined)
			this.addTypeToLocale(type, locale)

		/**
		 * @type {Card | Ruling | TCGPlayerSet} This starts out unset but will be set to something when data is found.
		 */
		this.data = undefined

		// This is used to store any raw data we found while making our way through databases/APIs.
		// It is then converted into a proper Card or Ruling, depending on what produced the data.
		// It is voided after use.
		this.rawData = undefined
	}

	/**
	 * Adds a search type to the types map.
	 * @param {String} type The type of search (e.g., i, r, etc.)
	 * @param {String} locale The locale of the search (e.g., en, es, etc.)
	 */
	addTypeToLocale(type, locale) {
		const localeTypes = this.localeToTypesMap.get(locale)
		// If this one doesn't already exist in the map, just add it.
		if (localeTypes === undefined) {
			this.localeToTypesMap.set(locale, new Set())
			this.localeToTypesMap.get(locale).add(type)
		}
		// Otherwise, add it and let JS Set handle conflicts.
		else {
			if (type instanceof Set) 
				localeTypes.add(...type) 
			else localeTypes.add(type)
		}
	}

	/**
	 * Checks whether this Search has a given type.
	 * @param {String} type The type of search to check for.
	 * @returns {Boolean} Whether or not this search has the given type.
	 */
	hasType(type) {
		for (const l of this.localeToTypesMap.keys()) 
			if (this.localeToTypesMap.get(l).has(type))
				return true
		
		return false
	}

	/**
	 * Checks whether a search has resolved all necessary data related to its search types.
	 * i.e., does it have data for all the locales and types it searched?
	 * @returns {Boolean} True if all types/locales have corresponding data.
	 */
	isDataFullyResolved() {
		if (this.data === undefined) return false

		// Go through our locale/types map and check what we need to see for each.
		for (const locale of this.localeToTypesMap.keys()) {
			// Broad case: if this is a Card and we don't have a name in this locale,
			// pretty good bet we don't have the data resolved.
			if (this.data instanceof Card) {
				if ( !this.data.name.has(locale) ) 
					return false
			}
			// Otherwise, if this is a Set then we want to check whether our price data is resolved.
			else if (this.data instanceof TCGPlayerSet) {
				return this.data.hasResolvedPriceData()
			}

			// Alright, this is a Card and we have the basic info. Check for what we need for any further types.
			const types = this.localeToTypesMap.get(locale)
			// If this has 'r' or 'i'-type search, it needs name + effect text for this locale at a minimum.
			if (types.has('i') || types.has('r'))
				if ( (this.data.name && !(this.data.name.has(locale))) || 
					 (this.data.effect && !(this.data.effect.has(locale))) )
					return false
			// If this has 'a'-type search, it needs image data (locale independent).
			if (types.has('a'))
				if (!this.data.imageData.size)
					return false
			// If this has 'd'-type search, it needs print data for this locale.
			if (types.has('d'))
				if (!(this.data.printData.has(locale)))
					return false
			// If this has '$'-type search, it needs corresponding price data.
			if (types.has('$'))
				if (!this.data.hasResolvedPriceData())
					return false
			// If this has 'f'-type search, it needs FAQ data for this locale.
			if (types.has('f'))
				if (!(this.data.faqData.has(locale)))
					return false
			// If this has 'q'-type search, it needs QA data for this locale.
			if (types.has('q'))
				if ( (this.data.title && !(this.data.title.has(locale))) || 
					 (this.data.question && !(this.data.question.has(locale))) || 
					 (this.data.answer && !(this.data.answer.has(locale))) )
					return false
		}

		// If we got this far, everything looks good.
		return true
	}

	/**
	 * Gets all the unresolved data of this search. Returns the same format as the localeToTypes map
	 * to indicate which locales and types did not get resolved.
	 * This is basically a more specific form of isDataFullyResolved, but more comprehensive, since it will
	 * return ALL data unresolved rather than just a true/false as soon as it finds something bad.
	 * @returns {Map} The map of locales -> types that did not have resolved data.
	 */
	getUnresolvedData() {
		// If this has no data, all of its locales -> types are unresolved.
		if (this.data === undefined) {
			return this.localeToTypesMap
		}

		const unresolvedLocaleTypes = new Map()

		this.localeToTypesMap.forEach((types, locale) => {
			// Broad case: if this is a Card and we don't have name or effect text in this locale,
			// pretty good bet we don't have the data resolved.
			if (this.data instanceof Card) {
				if ( !this.data.name.has(locale) ) {
					unresolvedLocaleTypes.set(locale, types)
					return
				}
			}
			// Otherwise, if this is a Set then we want to check whether our price data is resolved.
			else if (this.data instanceof TCGPlayerSet) {
				if ( !this.data.hasResolvedPriceData() )
					unresolvedLocaleTypes.set(locale, types)
				return
			}

			// Alright, this is a Card and we have the basic info. Check for what we need for any further types.
			for (const t of types) {
				let unresolvedType = false
				// Any 'a'-type search should have image data.
				if (t === 'a') {
					if (!this.data.imageData.size)
						unresolvedType = true
				}
				// Any 'd'-type search should have print data in this locale.
				else if (t === 'd') {
					if (!this.data.printData.has(locale))
						unresolvedType = true
				}
				// Any '$' or '€'-type search should have corresponding price data.
				else if (t === '$') {
					if (!this.data.hasResolvedPriceData())
						unresolvedType = true
				}
				// Any 'f'-type search should have FAQ data in this locale.
				else if (t === 'f') {
					if (!this.data.faqData.has(locale))
						unresolvedType = true
				}
				// Any 'q'-type search should have QA data in this locale.
				else if (t === 'q') {
					if ( (this.data.title && !this.data.title.has(locale)) || 
						 (this.data.question && !this.data.question.has(locale)) || 
						 (this.data.answer && !this.data.answer.has(locale)) )
						unresolvedType = true
				}

				if (unresolvedType) {
					if (!unresolvedLocaleTypes.has(locale))
						unresolvedLocaleTypes.set(locale, new Set())
					unresolvedLocaleTypes.get(locale).add(t)
				}
			}
		})

		return unresolvedLocaleTypes
	}

	/**
	 * Merges the values of this search with another Search object.
	 * @param {Search} otherSearch The other Search object to be merged into this one.
	 */
	mergeWith(otherSearch) {
		// Add any original search values to associate with this search, let JS Set handle conflicts.
		this.originals.add(...otherSearch.originals)
		
		// We don't need to update the search term associate with this object.
		// The only situation in which this function is called is when 
		// this object was using a search term that the other search object was going to update to.
		// In other words, this object already has the correct search term.

		// Add any new search types to associate with this search.
		otherSearch.localeToTypesMap.forEach((otherTypes, otherLocale) => {
			const thisSearchLocale = this.localeToTypesMap.get(otherLocale)
			if (thisSearchLocale === undefined)
				// If the other search has a type this one doesn't, just add it.
				this.localeToTypesMap.set(otherLocale, otherTypes)
			else
				// This type exists in both Searches. Add any new locales to this one, let JS Set handle conflicts.
				thisSearchLocale.add(...otherTypes)
		})

		// Integrate any new data this might have.
		if (this.data === undefined && otherSearch.data !== undefined)
			this.data = otherSearch.data
	}
}

module.exports = Search