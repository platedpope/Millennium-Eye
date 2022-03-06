const { Message, CommandInteraction } = require('discord.js')

const MillenniumEyeBot = require('./MillenniumEyeBot')

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
		this.qry = qry
		this.bot = bot
		
		// object that will contain all important details
		// about what we need to respond to in this query
		this.eval = {}

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
						let qLan = m[3] ?? lan

						if (!(qLan in this.eval))
							this.eval[qLan] = []

						const qDetails = { 'type': qType, 'query': q }
						this.eval[qLan]  = [ ...this.eval[qLan], qDetails ]
					}
				}
			}
		}
	}
}

module.exports = Query
