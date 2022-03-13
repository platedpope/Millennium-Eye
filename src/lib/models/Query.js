const { Message, CommandInteraction } = require('discord.js')

const MillenniumEyeBot = require('./MillenniumEyeBot')
const { KONAMI_DB_CARD_REGEX, KONAMI_DB_QA_REGEX, YGORG_DB_CARD_REGEX, YGORG_DB_QA_REGEX } = require('./Defines')

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
		
		/* This object will contain all the data associated with this message.
		 * It is of the general form:
		 * "card name"/ID: {
		 * 		queryTypes : [{
		 * 			infoType : ...
		 * 			lan : ...
		 * 		}, ...]
		 * 		data: Card/QNA object
		 * }
		 * In other words, each property/key is a distinct point of data being queried for (e.g., card name),
		 * and stored under that are the types of queries and languages for that card name (there can theoretically be multiple),
		 * as well as the object that holds the data for that query.
		 */
		this.eval = {}

		this.evaluateMessage(qry)
	}

	/**
	 * Evaluates the contents of a message to determine what to query, 
	 * and what types those queries are.
	 * @param {Message | CommandInteraction} qry The query to evaluate. 
	 */
	evaluateMessage(qry) {
		if (qry instanceof CommandInteraction)
			var qryContent = qry.options.getString('content', true)
		else
			qryContent = qry.content

		/* Strip text we want to ignore from the message content:
		* - characters between `` (code tags)
		* - characters between || (spoiler tags)
		* - characters in quote lines (> text...)
		* Also, convert entire message content to lowercase for case insensitivity.
		*/
		qryContent = qryContent.replace(/`+.*?`+/gs, '')
			.replace(/\|{2}.*?\|{2}/gs, '')
			.replace(/^\s*> .*$/gm, '')
			.toLowerCase()

		const guildQueries = this.bot.getGuildQueries(qry.guild)
		if (guildQueries) {
			for (const lan in guildQueries) {
				const matches = [...qryContent.matchAll(guildQueries[lan])]
				if (matches.length) {
					for (const m of matches) {
						let qType = m[1] ?? (this.rulings ? 'r' : 'i')
						let q = m[2]
						// Try converting the query to an integer to see if it's a card or ruling ID.
						let intQ = parseInt(q, 10)
						if (!isNaN(intQ)) {
							// Special case: there is a card named "7"...
							if (qType !== 'q' && q !== '7') {
								q = intQ
							}
						}
						let qLan = m[3] ?? lan

						this.addQueryToEval(qType, q, qLan)
					}
				}
			}
		}

		// After checking for any matches to the query syntax,
		// also check for database links (cards or QAs) we can use.
		const cardLinks = [
			...qryContent.matchAll(KONAMI_DB_CARD_REGEX), 
			...qryContent.matchAll(YGORG_DB_CARD_REGEX)
		]
		if (cardLinks.length) {
			for (const l of cardLinks) {
				let qType = this.rulings ? 'r' : 'i'
				let q = parseInt(l[1], 10)
				let qLan = this.language

				this.addQueryToEval(qType, q, qLan)
			}
		}

		const qaLinks = [
			...qryContent.matchAll(KONAMI_DB_QA_REGEX),
			...qryContent.matchAll(YGORG_DB_QA_REGEX)
		]
		if (qaLinks.length) {
			for (const l of qaLinks) {
				let qType = 'q'
				let q = parseInt(l[1], 10)
				let qLan = this.language

				this.addQueryToEval(qType, q, qLan)
			}
		}
	}

	/**
	 * Adds a query to the eval. If it's a duplicate, it is ignored.
	 * @param {String} type The type of query (i, r, etc.)
	 * @param {String | Number} content The content of the query (typically the card name or database ID).
	 * @param {String} language The language to associate with the query.
	 */
	addQueryToEval(type, content, language) {
		// Handle duplicates. If we already have a query of this content,
		// then track any new type or language to evaluate for it.
		if (content in this.eval) {
			const existingQuery = this.eval[content]

			let duplicate = existingQuery.queryTypes.some(qt => qt.infoType === type && qt.lan === language)
			if (!duplicate)
				existingQuery.queryTypes.push({
					'infoType': type,
					'lan': language
				})
		}
		// Something new to look for...
		else {
			this.eval[content] = {
				'queryTypes': [{
					'infoType': type,
					'lan': language
				}]
				// Don't have data yet, but will get it in the future.
			}
		}
	}

	/**
	 * Find the difference between two queries. More precisely, this function evaluates content data
	 * that ONLY exists in the object this function is called on, and NOT in the other query it is being diffed from.
	 * Essentially, it treats this as the "new" object and the other query as the "old" object.
	 * @param {Query} otherQuery The other Query object to diff from.
	 * @returns An Object of the same structure as this.eval, containing content unique to this Query object.
	 */
	diffFrom(otherQuery) {
		const onlyInThis = {}

		for (const identifier in this.eval) {
			const idEval = this.eval[identifier]
			// If there's an identifier in this Query that's not in the other,
			// then anything under it is also new.
			if (!(identifier in otherQuery.eval))
				onlyInThis[identifier] = idEval
			else {
				const otherIdEval = otherQuery.eval[identifier]
				// If both have the same identifier, diff their query types for anything new.
				const sameQryType = (a, b) => a.infoType === b.infoType && a.lan === b.lan
				const onlyInLeft = (left, right) => {
					return left.filter(lv =>
						!right.some(rv =>
							sameQryType(lv, rv)))
				}

				const qTypesInThis = onlyInLeft(idEval.queryTypes, otherIdEval.queryTypes)

				if (qTypesInThis.length)
					onlyInThis[identifier] = {
						'queryTypes': qTypesInThis
					}
			}
		}

		return onlyInThis
	}
}

module.exports = Query
