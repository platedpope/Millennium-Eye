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
		// save off state info about where this message was sent
		this.official = bot.getCurrentChannelSetting(qry.channel, 'official')
		this.rulings = bot.getCurrentChannelSetting(qry.channel, 'rulings')
		this.language = bot.getCurrentChannelSetting(qry.channel, 'language')
		this.qry = qry
		this.bot = bot
		
		// object that will contain all important details
		// about what we need to respond to in this query
		this.eval = []

		this.evaluate(qry)
	}

	/**
	 * Evaluates the contents of a message to determine what to query, 
	 * and what types those queries are.
	 * @param {Message | CommandInteraction} qry The query to evaluate. 
	 */
	evaluate(qry) {
		if (qry instanceof CommandInteraction)
			var qryContent = qry.options.getString('content', true)
		else
			qryContent = qry.content

		/* strip text we want to ignore from the message content:
		* - characters between `` (code tags)
		* - characters between || (spoiler tags)
		* - characters in quote lines (> text...)
		* also, convert entire message content to lowercase for case insensitivity
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
						// try converting the query to an integer to see if it's a card or ruling ID
						let intQ = parseInt(q, 10)
						if (!isNaN(intQ)) {
							// annoying special case: there is technically a card named "7"...
							if (qType !== 'q' && q !== '7') {
								q = intQ
							}
						}
						let qLan = m[3] ?? lan

						this.addQueryToEval({
							'type': qType,
							'content': q,
							'lan': qLan
						})
					}
				}
			}
		}

		// also check for any particular link syntax
		// first, card links
		const cardLinks = [
			...qryContent.matchAll(KONAMI_DB_CARD_REGEX), 
			...qryContent.matchAll(YGORG_DB_CARD_REGEX)
		]
		if (cardLinks.length) {
			for (const l of cardLinks) {
				let qType = this.rulings ? 'r' : 'i'
				let q = parseInt(l[1], 10)
				let qLan = this.language

				this.addQueryToEval({
					'type': qType,
					'content': q,
					'lan': qLan
				})
			}
		}

		// now QA links
		const qaLinks = [
			...qryContent.matchAll(KONAMI_DB_QA_REGEX),
			...qryContent.matchAll(YGORG_DB_QA_REGEX)
		]
		if (qaLinks.length) {
			for (const l of qaLinks) {
				let qType = 'q'
				let q = parseInt(l[1], 10)
				let qLan = this.language

				this.addQueryToEval({
					'type': qType,
					'content': q,
					'lan': qLan
				})
			}
		}
	}

	/**
	 * Adds a query (with type, content, and language) to the eval.
	 * Does not add the query if one exists in the eval with the same type, content, and language.
	 * @param {Object} qry The query to add to the eval.
	 */
	addQueryToEval(qry) {
		// ignore this query if there's one in eval with the same parameters
		const identicalQuery = this.eval.some(oldQry =>
			qry.type === oldQry.type &&
			qry.content === oldQry.content &&
			qry.lan === oldQry.lan)

		if (!identicalQuery)
			this.eval.push(qry)
	}
}

module.exports = Query
