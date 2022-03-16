const { Message, CommandInteraction } = require('discord.js')

const MillenniumEyeBot = require('./MillenniumEyeBot')
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
		 * @type {Map<String,Set} Each type-language duo associated with this search.
		 */
		this.types = new Map()
		if (type !== undefined && language !== undefined)
			this.types.set(type, new Set([language]))
		
		// This starts as nothing, but will become actual data if this search
		// ever gets as far as being mapped to proper data.
		this.data = undefined
	}

	/**
	 * Adds a search type to the types map.
	 * @param {String} type The type of search (e.g., i, r, etc.)
	 * @param {String} language The language of the search (e.g., en, es, etc.)
	 */
	addType(type, language) {
		// If this one doesn't already exist in the map, just add it.
		if (this.types.get(type) === undefined)
			this.types.set(type, new Set([language]))
		// Otherwise, add it and let JS Set handle conflicts.
		else this.types.get(type).add(language)
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
		otherSearch.types.forEach((otherLans, otherType) => {
			const thisSearchType = this.types.get(otherType)
			if (thisSearchType === undefined)
				// If the other search has a type this one doesn't, just add it.
				this.types.set(otherType, otherLans)
			else
				// This type exists in both Searches. Add any new languages to this one, let JS Set handle conflicts.
				thisSearchType.add(...otherLans)
		})
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
	 * @param {Message | CommandInteraction} qry The message or interaction associated with the query.
	 * @param {MillenniumEyeBot} bot The bot.
	 */
	constructor(qry, bot) {
		// Save off state info about where this message was sent.
		this.official = bot.getCurrentChannelSetting(qry.channel, 'official')
		this.rulings = bot.getCurrentChannelSetting(qry.channel, 'rulings')
		this.language = bot.getCurrentChannelSetting(qry.channel, 'language')
		this.bot = bot
		
		/**
		 * @type {Array{Search}} The data associated with all searches in this query.
		 */
		this.searches = []

		this.evaluateMessage(qry)
	}

	/**
	 * Evaluates the contents of a message to determine what to query, 
	 * and what types those queries are.
	 * @param {Message | CommandInteraction} msg The message to evaluate. 
	 */
	evaluateMessage(msg) {
		if (msg instanceof CommandInteraction)
			var msgContent = msg.options.getString('content', true)
		else
			msgContent = msg.content

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

		const guildQueries = this.bot.getGuildQueries(msg.guild)
		if (guildQueries) {
			for (const lan in guildQueries) {
				const matches = [...msgContent.matchAll(guildQueries[lan])]
				if (matches.length) {
					for (const m of matches) {
						let sContent = m[2]
						// If the query content has a link in it, ignore it to avoid really dumb behavior.
						if (IGNORE_LINKS_REGEX.test(sContent)) continue
						// Try converting the query to an integer to see if it's a card or ruling ID.
						let intSContent = parseInt(sContent, 10)
						if (!isNaN(intSContent)) {
							// Special case: there is a card named "7"...
							if (sType !== 'q' && sContent !== '7') {
								sContent = intSContent
							}
						}
						let sType = m[1] ?? (this.rulings ? 'r' : 'i')
						let sLan = m[3] ?? lan

						this.addSearch(sContent, sType, sLan)
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

				this.addSearch(sContent, sType, sLan)
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

				this.addSearch(sContent, sType, sLan)
			}
		}
	}

	/**
	 * Adds a search to the search array. If the search content already exists,
	 * then add a new type/language to it as necessary.
	 * @param {String | Number} content The content of the search (i.e., what is being searched for).
	 * @param {String} type The type of search (e.g., i, r, etc.)
	 * @param {String} language The language of the search (e.g., en, es, etc.)
	 */
	addSearch(content, type, language) {
		// Handle duplicates. If we already have a search of this content,
		// then track any new type or language to evaluate for it.
		const oldSearch = this.findSearch(content)
		if (oldSearch !== undefined) {
			oldSearch.addType(type, language)
		}
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
	 * Returns all searches in this Query that have no resolved data.
	 * @returns {Array<Search>} All searches with undefined data properties.
	 */
	getUnresolvedSearches() {
		return this.searches.filter(s => s.data === undefined)
	}

	/**
	 * Updates the search term associated with the Search object that has the given original search.
	 * If any other Search objects we know of are already using this term, they will all be
	 * consolidated into one.
	 * @param {String} originalTerm The original term used to create the search.
	 * @param {String} newTerm The new term to be associated with that search.
	 */
	updateSearchTerm(originalTerm, newTerm) {
		let originalSearch = this.findSearch(originalTerm)

		// Does a search already exist that's using the new term?
		let newSearch = this.findSearch(newTerm)
		if (newSearch !== undefined) {
			// If so, then just consolidate these two searches into one.
			newSearch.mergeWith(originalSearch)
			// Remove the original Search from our array.
			this.searches.splice(this.searches.findIndex(s => s.originals.has(originalTerm)), 1)
		}
		else
			// Otherwise, just update the term of the one we found originally.
			originalSearch.term = newTerm
	}

	/**
	 * Find the difference between two queries. More precisely, this function evaluates searches
	 * that ONLY exist in the object this function is called on, and NOT in the other query it is being diffed from.
	 * Essentially, it treats this as the "new" object and the other query as the "old" object.
	 * @param {Query} otherQuery The other Query object to diff from.
	 * @returns {Array<Search>} All Searches of terms and types that did not exist in the other query.
	 */
	diffFrom(otherQuery) {
		const onlyInThis = []

		for (const thisSearch of this.searches) {
			const trimmedSearch = new Search(thisSearch.term)

			// If there's a search in this Query that's not in the other, then just add it to our trimmed search.
			const otherSearch = otherQuery.findSearch(thisSearch.term)
			if (otherSearch === undefined)
				onlyInThis.push(thisSearch)
			else {
				// If both have the same searches, only track any new search types.
				thisSearch.types.forEach((thisLans, thisType) => {
					const otherSearchLans = otherSearch.types.get(thisType)
					if (otherSearchLans === undefined) {
						// If the new search has a type this one doesn't, just add it.
						trimmedSearch.types.set(thisType, thisLans)
					}
					else {
						// This type exists in both Searches. 
						// Look for any languages that exist in this one but not in the other, then add them.
						const lansOnlyInThis = new Set()
						thisLans.forEach(lan => {
							if (!otherSearchLans.has(lan))
								lansOnlyInThis.add(lan)
						})

						if (lansOnlyInThis.size)
							trimmedSearch.types.set(thisType, lansOnlyInThis)
					}
				})

				// If we found any unique search types, add our trimmed search to the return.
				if (trimmedSearch.types.size)
					onlyInThis.push(trimmedSearch)
			}
		}

		return onlyInThis
	}
}

module.exports = Query