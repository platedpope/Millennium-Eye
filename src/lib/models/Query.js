const { Message, CommandInteraction, MessageEmbed } = require('discord.js')

const { MillenniumEyeBot } = require('./MillenniumEyeBot')
const { KONAMI_DB_CARD_REGEX, KONAMI_DB_QA_REGEX, YGORG_DB_CARD_REGEX, YGORG_DB_QA_REGEX, IGNORE_LINKS_REGEX } = require('./Defines')

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
		this.originals = new Set([content])
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
		// If this one doesn't already exist in the map, just add it.
		if (this.lanToTypesMap.get(language) === undefined)
			this.lanToTypesMap.set(language, new Set([type]))
		// Otherwise, add it and let JS Set handle conflicts.
		else {
			if (type instanceof Set) this.types.set(language, type) 
			else this.lanToTypesMap.get(language).add(type)
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

/**
 * Container class that tracks the results of an entire query (which can contain multiple searches).
 * On top of tracking details about the channel the querying message was sent in,
 * contains an array of Searches within the Query, whose details can be evaluated by databases/APIs.
 */
class Query {
	/**
	 * Initializes the query's properties (regexes to use to parse the message, official mode, etc.)
	 * by referencing the properties of the given qry.
	 * @param {Message | CommandInteraction | Query} qry The message or interaction associated with the query, or another Query to copy the data of.
	 * @param {MillenniumEyeBot} bot The bot.
	 */
	constructor(qry, bot) {
		if (qry instanceof Query) {
			this.official = qry.official
			this.rulings = qry.rulings
			this.language = qry.language
			this.rawSearchData = qry.rawSearchData
			this.bot = qry.bot
			/**
			 * @type {Array<Search>}
			 */
			this.searches = qry.searches 
		}
		else {
			// Save off state info about where this message was sent.
			this.official = bot.getCurrentChannelSetting(qry.channel, 'official')
			this.rulings = bot.getCurrentChannelSetting(qry.channel, 'rulings')
			this.language = bot.getCurrentChannelSetting(qry.channel, 'language')
			this.bot = bot
			this.rawSearchData = this.evaluateMessage(qry)
			
			/**
			 * @type {Array<Search>}
			 */
			this.searches = []
			for (const s of this.rawSearchData)
				this.addSearch(s[0], s[1], s[2])
		}
	}

	/**
	 * Evaluates the contents of a message to extract the raw search data 
	 * (i.e., the content and types to query) from it.
	 * @param {Message | CommandInteraction} msg The message to evaluate.
	 * @returns {Array} An array of raw search data, each member is an array of [search content, type, language].
	 */
	evaluateMessage(msg) {
		let msgContent = msg instanceof CommandInteraction ? msg.options.getString('content', true) : msg.content

		/* Strip text we want to ignore from the message content:
		* - characters between `` (code tags)
		* - characters between || (spoiler tags)
		* - characters in quote lines (> text...)
		* Also, convert entire message content to lowercase for case insensitivity.
		*/
		msgContent = msgContent.replace(/`+.*?`+/gs, '')
			.replace(/\|{2}.*?\|{2}/gs, '')
			.replace(/^\s*> .*$/gm, '')
			.toLowerCase()

		const searchData = []
		
		const guildQueries = this.bot.getGuildQueries(msg.guild)
		if (guildQueries) {
			for (const lan in guildQueries) {
				const matches = [...msgContent.matchAll(guildQueries[lan])]
				if (matches.length) {
					for (const m of matches) {
						let sContent = m[2]
						// If the search content has a link in it, ignore it to avoid really dumb behavior.
						if (IGNORE_LINKS_REGEX.test(sContent)) continue
						let sType = m[1] ?? (this.rulings ? 'r' : 'i')
						// Try converting the search to an integer to see if it's a card or ruling ID.
						let intSContent = parseInt(sContent, 10)
						if (!isNaN(intSContent)) {
							// Special case: there is a card named "7"...
							if (sType !== 'q' && sContent !== '7') {
								sContent = intSContent
							}
						}
						let sLan = m[3] ?? lan

						searchData.push([sContent, sType, sLan])
					}
				}
			}
		}

		// After checking for any matches to the query syntax,
		// also check for database links (cards or QAs) we can use.
		const cardLinks = [
			...msgContent.matchAll(KONAMI_DB_CARD_REGEX), 
			...msgContent.matchAll(YGORG_DB_CARD_REGEX)
		]
		if (cardLinks.length) {
			for (const l of cardLinks) {
				let sType = this.rulings ? 'r' : 'i'
				let sContent = parseInt(l[1], 10)
				let sLan = this.language

				searchData.push([sContent, sType, sLan])
			}
		}

		const qaLinks = [
			...msgContent.matchAll(KONAMI_DB_QA_REGEX),
			...msgContent.matchAll(YGORG_DB_QA_REGEX)
		]
		if (qaLinks.length) {
			for (const l of qaLinks) {
				let sType = 'q'
				let sContent = parseInt(l[1], 10)
				let sLan = this.language

				searchData.push([sContent, sType, sLan])
			}
		}

		return searchData
	}

	/**
	 * Updates the query's content and searches array to correspond to the contents of a new message.
	 * This will add or remove searches that are new or no longer present (respectively),
	 * and update existing searches that may have new types or languages based on the new message.
	 * @param {Message | CommandInteraction} msg The new message from which to update the search data. 
	 */
	updateSearchData(msg) {
		const newSearchData = this.evaluateMessage(msg)

		// First, just insert everything to add or update existing searches as necessary.
		for (const s of newSearchData)
			this.addSearch(s[0], s[1], s[2])
		// Now remove any searches that were in the old query but not in the new one.
		const onlyInOldSearch = 
			this.rawSearchData.filter(os => 
				!newSearchData.some(ns => os[0] === ns[0] && os[1] === ns[1] && os[2] === ns[2]))
		for (const oldS of onlyInOldSearch) {
			const sContent = oldS[0]
			const sType = oldS[1]
			const sLan = oldS[2]

			const currSearch = this.findSearch(sContent)
			if (currSearch) {
				// Remove this search's language -> type pair from the map.
				const currTypes = currSearch.lanToTypesMap.get(sLan)
				currTypes.delete(sType)
				// If this left no types for this language, delete the language from the map.
				if (!currTypes.size) {
					currSearch.lanToTypesMap.delete(sLan)
					// If deleting this language left no languages for this search,
					// then this search isn't being used anymore. Delete it entirely.
					if (!currSearch.lanToTypesMap.size) 
						this.searches.splice(this.searches.indexOf(s => s.originals.has(originalTerm)), 1)
				} 
			}
		}

		// Last, update our raw search data.
		this.rawSearchData = newSearchData
	}

	/**
	 * Adds a search to the search array. If the search content already exists,
	 * then add a new language-type pair to it as necessary.
	 * @param {String | Number} content The content of the search (i.e., what is being searched for).
	 * @param {String} type The type of search (e.g., i, r, etc.)
	 * @param {String} language The language of the search (e.g., en, es, etc.)
	 */
	addSearch(content, type, language) {
		// Handle duplicates. If we already have a search of this content,
		// then track any new type or language to evaluate for it.
		const oldSearch = this.findSearch(content)
		if (oldSearch !== undefined)
			oldSearch.addTypeToLan(type, language)
		// Something new to look for...
		else this.searches.push(new Search(content, type, language))
	}

	/**
	 * Finds a search of the given content in this Query's search array.
	 * This checks both the original value of each Search and its current search term.
	 * @param {String} content The content of the search to be found.
	 * @returns {Search} The Search that has the given content as either its search term or within its original terms array.
	 */
	findSearch(content) {
		return this.searches.find(s => content === s.term || s.originals.has(content))
	}

	/**
	 * Returns all searches in this Query that have not resolved all info relevant to them.
	 * @returns {Array<Search>} All searches with undefined data properties.
	 */
	findUnresolvedSearches() {
		return this.searches.filter(s => !s.isDataFullyResolved())
	}

	/**
	 * Updates the search term associated with the Search object that has the given original search.
	 * If any other searches we know of are already using this term, they will all be
	 * consolidated into one.
	 * @param {String} originalTerm The current term used to refer to the search.
	 * @param {String} newTerm The new term to be used to refer to the search.
	 * @returns {Boolean} If the search already existed and caused a consolidation, returns true. Otherwise, false.
	 */
	updateSearchTerm(originalTerm, newTerm) {
		let originalSearch = this.findSearch(originalTerm)

		// Does a search already exist that's using the new term?
		let newSearch = this.findSearch(newTerm)
		if (newSearch !== undefined) {
			// Remove the original Search from our array.
			this.searches.splice(this.searches.indexOf(s => s.originals.has(originalTerm)), 1)
			// Consolidate the two.
			newSearch.mergeWith(originalSearch)

			return true
		}
		else {
			// Otherwise, just update the term of the one we found originally.
			originalSearch.term = newTerm
			return false
		}
	}

	/**
	 * Gets all embed data (embeds and associated attachments) formed from these searches.
	 * @returns {Object} Every embed and attachment for this Query.
	 */
	 getDataEmbeds() {
		const embedData = {
			'embeds': [],
			'attachments': []
		}

		for (const s of this.searches) {
			if (!s.data) continue
			s.lanToTypesMap.forEach((searchTypes, searchLan) => {
				for (const t of searchTypes) {
					const newData = s.data.generateEmbed(t, searchLan, this.official)
					if (newData.embed) embedData.embeds.push(newData.embed)
					if (newData.attachment) embedData.attachments.push(newData.attachment)
				}
			})
		}
		
		return embedData
	 }
}

module.exports = { 
	Query, Search 
}