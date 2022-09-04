const { Message, CommandInteraction, GuildChannel } = require('discord.js')

const Search = require('./Search')
const { MillenniumEyeBot } = require('./MillenniumEyeBot')
const { KONAMI_DB_CARD_REGEX, KONAMI_DB_QA_REGEX, YGORG_DB_CARD_REGEX, YGORG_DB_QA_REGEX, IGNORE_LINKS_REGEX, Locales } = require('./Defines')
const { logError, logger } = require('lib/utils/logging')

/**
 * Container class that tracks the results of an entire query (which can contain multiple searches).
 * On top of tracking details about the channel the querying message was sent in,
 * contains an array of Searches within the Query, whose details can be evaluated by databases/APIs.
 */
class Query {
	/**
	 * Initializes the query's properties (regexes to use to parse the message, official mode, etc.)
	 * by referencing the properties of the given qry.
	 * @param {Message | CommandInteraction | Query | Array<Search>} qry The message associated with the query, another Query to copy the data of, or an array of searches to treat as a query.
	 * @param {MillenniumEyeBot} bot The bot.
	 */
	constructor(qry, bot) {
		// Keep track of whether we matched any DB links (either Konami or YGOrg).
		// They produce automatic Discord embeds that we want to try to suppress.
		this.matchedDbLinks = false
		
		if (qry instanceof Query) {
			this.channel = qry.channel
			this.official = qry.official
			this.rulings = qry.rulings
			this.locale = qry.locale
			this.bot = qry.bot
			/**
			 * @type {Array<Search>}
			 */
			this.searches = qry.searches 
		}
		else if (qry instanceof Array)
			/**
			 * @type {Array<Search>}
			 */
			this.searches = qry
		else {
			// Save off state info about where this message was sent.
			this.channel = qry.channel
			this.official = bot.getCurrentChannelSetting(this.channel, 'official')
			this.rulings = bot.getCurrentChannelSetting(this.channel, 'rulings')
			this.locale = bot.getCurrentChannelSetting(this.channel, 'locale')
			this.bot = bot
			/**
			 * @type {Array<Search>}
			 */
			this.searches = []

			this.evaluateMessage(qry)
		}
	}

	/**
	 * Evaluates the contents of a message to extract the raw search data 
	 * (i.e., the content and types to query) from it.
	 * @param {Message | CommandInteraction} msg The message to evaluate.
	 * @returns {Array} An array of raw search data, each member is an array of [search content, type, locale].
	 */
	evaluateMessage(msg) {
		if (msg instanceof CommandInteraction) {
			var msgContent = msg.options.getString('content', true)
		}
		else if (msg instanceof Message) {
			msgContent = msg.content
		}
		else {
			// If it's none of the usual suspects, just assume it's a raw string.
			msgContent = msg
		}

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
		
		const guildQueries = this.bot.getGuildQueries(this.channel.guild)
		if (guildQueries) {
			for (const locale in guildQueries) {
				let realLocale = locale
				// Sub out default locale for whatever this query's locale is.
				if (locale === 'default')
					realLocale = this.locale

				const matches = [...msgContent.matchAll(guildQueries[locale])]
				for (const m of matches) {
					let sContent = m[3]
					// If the search content has a link in it, ignore it to avoid really dumb behavior.
					if (IGNORE_LINKS_REGEX.test(sContent)) continue

					let sType = m[1] ?? (this.rulings ? 'r' : 'i')
					let sLocale = m[4] ?? realLocale
					// Check for JA/JP alias.
					if (sLocale === 'jp') sLocale = 'ja'
					// Multiple types can be contained in the first match. Iterate through all that we have.
					for (let i = 0; i < sType.length; i++) {
						const currType = sType.charAt(i)
						// Try converting the search to an integer to see if it's a card or ruling ID.
						let intSContent = parseInt(sContent, 10)
						if (!isNaN(intSContent)) {
							// Special case: there is a card named "7"...
							if (currType !== 'q' && sContent !== '7') {
								sContent = intSContent
							}
						}

						searchData.push([sContent, currType, sLocale])
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
				let sLocale = this.locale

				searchData.push([sContent, sType, sLocale])
			}
			this.matchedDbLinks = true
		}

		const qaLinks = [
			...msgContent.matchAll(KONAMI_DB_QA_REGEX),
			...msgContent.matchAll(YGORG_DB_QA_REGEX)
		]
		if (qaLinks.length) {
			for (const l of qaLinks) {
				let sType = 'q'
				let sContent = parseInt(l[1], 10)
				let sLocale = this.locale
	
				searchData.push([sContent, sType, sLocale])
			}
			this.matchedDbLinks = true
		}

		for (const s of searchData)
			this.addSearch(s[0], s[1], s[2])
	}

	/**
	 * Adds a search to the search array. If the search content already exists,
	 * then add a new locale-type pair to it as necessary.
	 * @param {String | Number} content The content of the search (i.e., what is being searched for).
	 * @param {String} type The type of search (e.g., i, r, etc.)
	 * @param {String} locale The locale of the search (e.g., en, es, etc.)
	 */
	addSearch(content, type, locale) {
		// Handle duplicates. If we already have a search of this content,
		// then track any new type or locale to evaluate for it.
		const oldSearch = this.findSearch(content)
		if (oldSearch !== undefined)
			// Don't merge QA searches with non-QA searches.
			if (type !== 'q' || (type === 'q' && oldSearch.hasType('q'))) {
				oldSearch.addTypeToLocale(type, locale)
				return
			}
		// Something new to look for...
		this.searches.push(new Search(content, type, locale))
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
	async getDataEmbeds() {
		const embedData = {}

		for (const s of this.searches) {
			if (!s.data) continue
			for (const [searchLocale, searchTypes] of s.localeToTypesMap) {
				for (const t of searchTypes) {
					let newData = await s.data.generateEmbed({
						'type': t,
						'locale': searchLocale,
						'official': this.official,
						'rulings': this.rulings,
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
			}
		}

		return embedData
	}

	/**
	 * Returns a string that reports any quirks of the given searches' that would cause
	 * any of their data to not show.
	 * @param {Array<Search>} searches All the searches to evaluate for unresolved data.
	 * @returns {String} A report string indicating what data is unresolved in these searches.
	 */
	static generateSearchResolutionReport(searches) {
		let str = ''
		const unresolvedLocaleData = new Map()
		const officialModeBlocks = new Set()

		for (const s of searches) {
			const unresolvedLocaleTypes = s.getUnresolvedData()

			// If this was an FAQ or QA-type query in an official-mode channel, report that instead of a generic "unresolved".
			if (this.official && (s.hasType('f') || s.hasType('q'))) {
				officialModeBlocks.add(...s.originals)
			}
			// If this had any generic unresolved data, report it.
			else if (unresolvedLocaleTypes.size) {
				for (const locale of unresolvedLocaleTypes.keys()) {
					if (!unresolvedLocaleData.has(locale))
						unresolvedLocaleData.set(locale, new Set)
					unresolvedLocaleData.get(locale).add(...s.originals)
				}
			}
		}

		if (unresolvedLocaleData.size) {
			unresolvedLocaleData.forEach((searches, locale) => {
				str += `Could not resolve ${Locales[locale]} data for searches: ${[...searches].join(', ')}\n`
			})
		}
		if (officialModeBlocks.size) {
			str += `Not reporting QA or FAQ data in official mode for searches: ${[...officialModeBlocks].join(', ')}\n`
		}

		return str
	}
}

module.exports = Query