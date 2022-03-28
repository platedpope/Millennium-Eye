const { Message, CommandInteraction } = require('discord.js')

const Search = require('./Search')
const Card = require('./Card')
const Ruling = require('./Ruling')
const { MillenniumEyeBot } = require('./MillenniumEyeBot')
const { KONAMI_DB_CARD_REGEX, KONAMI_DB_QA_REGEX, YGORG_DB_CARD_REGEX, YGORG_DB_QA_REGEX, IGNORE_LINKS_REGEX, Languages } = require('./Defines')
const { logError } = require('lib/utils/logging')

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

		// After checking for any matches to the query syntax,
		// also check for database links (cards or QAs) we can use.
		const cardLinks = [
			...msgContent.matchAll(KONAMI_DB_CARD_REGEX), 
			...msgContent.matchAll(YGORG_DB_CARD_REGEX)
		]
		for (const l of cardLinks) {
			let sType = this.rulings ? 'r' : 'i'
			let sContent = parseInt(l[1], 10)
			let sLan = this.language

			searchData.push([sContent, sType, sLan])
		}

		const qaLinks = [
			...msgContent.matchAll(KONAMI_DB_QA_REGEX),
			...msgContent.matchAll(YGORG_DB_QA_REGEX)
		]
		for (const l of qaLinks) {
			let sType = 'q'
			let sContent = parseInt(l[1], 10)
			let sLan = this.language

			searchData.push([sContent, sType, sLan])
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
			// Don't merge QA searches with non-QA searches.
			if (type !== 'q' || (type === 'q' && oldSearch.hasType('q'))) {
				oldSearch.addTypeToLan(type, language)
				return
			}
		// Something new to look for...
		this.searches.push(new Search(content, type, language))
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
		const embedData = {}

		for (const s of this.searches) {
			if (!s.data) continue
			s.lanToTypesMap.forEach((searchTypes, searchLan) => {
				for (const t of searchTypes) {
					let newData = s.data.generateEmbed({
						'type': t,
						'language': searchLan,
						'official': this.official,
						'random': false
					})
					
					if (newData && Object.keys(newData).length) {
						if ('embed' in newData) {
							if (!('embeds' in embedData)) embedData.embeds = []
							embedData.embeds.push(newData.embed)
						}
						if ('attachment' in newData) {
							if (!('attachments' in embedData)) embedData.attachments = []
							embedData.attachments.push(newData.attachment)
						}
					}
				}
			})
		}

		return embedData
	}

	/**
	 * Returns a string that reports any quirks of this Query's resolution that would cause
	 * any of its search data to not show.
	 * @returns {String} A report string indicating what data is unresolved in this query.
	 */
	reportResolution() {
		let str = ''
		const unresolvedLanData = new Map()
		const officialModeBlocks = new Set()

		for (const s of this.searches) {
			const unresolvedLanTypes = s.getUnresolvedData()

			// If this had unresolved data, report it.
			if (unresolvedLanTypes.size) {
				for (const lan of unresolvedLanTypes.keys()) {
					if (!unresolvedLanData.has(lan))
						unresolvedLanData.set(lan, new Set)
					unresolvedLanData.get(lan).add(...s.originals)
				}
			}

			// If this was an FAQ or QA-type query in an official-mode channel, report an issue regardless of whether they're resolved.
			if (this.official && (s.hasType('f') || s.hasType('q'))) {
				officialModeBlocks.add(...s.originals)
			}
		}

		if (unresolvedLanData.size) {
			unresolvedLanData.forEach((searches, lan) => {
				str += `Could not resolve ${Languages[lan]} data for searches: ${[...searches].join(', ')}\n`
			})
		}
		if (officialModeBlocks.size) {
			str += `Not reporting QA or FAQ data in official mode for searches: ${[...officialModeBlocks].join(', ')}\n`
		}

		return str
	}
}

module.exports = Query