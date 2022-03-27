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
	 * @param {String} language The language of the search (e.g., en, es, etc.)
	 */
	constructor(content, type, language) {
		// The original search term associated with this card data.
		// This is a Set because it may end up containing multiple original searches over time.
		this.originals = new Set()
		this.originals.add(content)
		// The search term that will be used to resolve data for this object.
		// This starts the same as the original, but can change over time
		// as the databases/APIs find a better search term.
		this.term = content
		/** 
		 * @type {Map<String,Set} Each language-type pair associated with this search.
		 */
		this.lanToTypesMap = new Map()
		if (type !== undefined && language !== undefined)
			this.addTypeToLan(type, language)

		// This starts as nothing, but will become actual data if this search
		// ever gets as far as being mapped to proper data.
		this.data = undefined
	}

	/**
	 * Adds a search type to the types map.
	 * @param {String} type The type of search (e.g., i, r, etc.)
	 * @param {String} language The language of the search (e.g., en, es, etc.)
	 */
	addTypeToLan(type, language) {
		const lanTypes = this.lanToTypesMap.get(language)
		// If this one doesn't already exist in the map, just add it.
		if (lanTypes === undefined) {
			this.lanToTypesMap.set(language, new Set())
			this.lanToTypesMap.get(language).add(type)
		}
		// Otherwise, add it and let JS Set handle conflicts.
		else {
			if (type instanceof Set) 
				lanTypes.add(...type) 
			else lanTypes.add(type)
		}
	}

	/**
	 * Checks whether this Search has a given type.
	 * @param {String} type The type of search to check for.
	 * @returns {Boolean} Whether or not this search has the given type.
	 */
	hasType(type) {
		for (const l of this.lanToTypesMap.keys()) 
			return this.lanToTypesMap.get(l).has(type)
	}

	/**
	 * Checks whether a search has resolved all necessary data related to its search types.
	 * i.e., does it have data for all the languages and types it searched?
	 * @returns {Boolean} True if all types/languages have corresponding data.
	 */
	isDataFullyResolved() {
		if (this.data === undefined) return false

		// Go through our language/types map and check what we need to see for each.
		for (const lan of this.lanToTypesMap.keys()) {
			const types = this.lanToTypesMap.get(lan)

			// If this has 'r' or 'i'-type search, it needs name + effect text for this language at a minimum.
			if (types.has('i') || types.has('r'))
				if ( !(this.data.name.has(lan)) || !(this.data.effect.has(lan)) )
					return false
			// If this has 'a'-type search, it needs image data (language independent).
			if (types.has('a'))
				if (!this.data.imageData.size)
					return false
			// If this has 'd'-type search, it needs print data for this language.
			if (types.has('d'))
				if (!(this.data.printData.has(lan)))
					return false
			// If this has 'p'-type search... honestly these are nonstandard, just check for name in this language for now.
			if (types.has('p'))
				if (!(this.data.name.has(lan)))
					return false
			const usPrice = types.has('$')
			const euPrice = types.has('€')
			// If this has '$' or '€'-type search, it needs corresponding price data.
			if (usPrice || euPrice)
				if (usPrice && !(this.data.priceData.has('us')))
					return false
				if (euPrice && !(this.data.priceData.has('eu')))
					return false
			// If this has 'f'-type search, it needs FAQ data for this language.
			if (types.has('f'))
				if (!(this.data.faqData.has(lan)))
					return false
			// If this has 'q'-type search, it needs QA data for this language.
			if (types.has('q'))
				if ( !(this.data.title.has(lan)) || !(this.data.question.has(lan)) || !(this.data.answer.has(lan)) )
					return false
		}

		// If we got this far, everything looks good.
		return true
	}

	/**
	 * Gets all the unresolved data of this search. Returns the same format as the lanToTypes map
	 * to indicate which languages and types did not get resolved.
	 * This is basically a more specific form of isDataFullyResolved, but more comprehensive, since it will
	 * return ALL data unresolved rather than just a true/false as soon as it finds something bad.
	 * @returns {Map} The map of languages -> types that did not have resolved data.
	 */
	getUnresolvedData() {
		const unresolvedLanTypes = new Map()

		this.lanToTypesMap.forEach((types, lan) => {
			for (const t of types) {
				let unresolvedType = false
				// Any 'r' or 'i'-type search should have name + effect text in this language.
				if (t === 'i' || t === 'r') {
					if ( !(this.data.name.has(lan)) || !(this.data.effect.has(lan)) )
						unresolvedType = true
				}
				// Any 'a'-type search should have image data.
				else if (t === 'a') {
					if (!this.data.imageData.size())
						unresolvedType = true
				}
				// Any 'd'-type search should have print data in this language.
				else if (t === 'd') {
					if (!this.data.printData.has(lan))
						unresolvedType = true
				}
				// Any 'p'-type search should have... honestly these are nonstandard, just check for name in this language for now.
				else if (t === 'p') {
					if (!this.data.name.has(lan))
						unresolvedType = true
				}
				// Any '$' or '€'-type search should have corresponding price data.
				else if (t === '$') {
					if (!this.data.priceData.has('us'))
						unresolvedType = true
				else if (t === '€')
					if (!this.data.priceData.has('eu'))
						unresolvedType = true
				}
				// Any 'f'-type search should have FAQ data in this language.
				else if (t === 'f') {
					if (!this.data.faqData.has(lan))
						unresolvedType = true
				}
				// Any 'q'-type search should have QA data in this language.
				else if (t === 'q') {
					if (!this.data.title.has(lan) || !this.data.question.has(lan) || !this.data.answer.has(lan))
						unresolvedType = true
				}

				if (unresolvedType) {
					if (!unresolvedLanTypes.has(lan))
						unresolvedLanTypes.set(lan, new Set())
					unresolvedLanTypes.get(lan).add(t)
				}
			}
		})

		return unresolvedLanTypes
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
		otherSearch.lanToTypesMap.forEach((otherTypes, otherLan) => {
			const thisSearchLan = this.lanToTypesMap.get(otherLan)
			if (thisSearchLan === undefined)
				// If the other search has a type this one doesn't, just add it.
				this.lanToTypesMap.set(otherLan, otherTypes)
			else
				// This type exists in both Searches. Add any new languages to this one, let JS Set handle conflicts.
				thisSearchLan.add(...otherTypes)
		})

		// Integrate any new data this might have.
		if (this.data === undefined && otherSearch.data !== undefined)
			this.data = otherSearch.data
	}
}

module.exports = Search