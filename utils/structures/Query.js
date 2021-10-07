// eslint-disable-next-line no-unused-vars
const { Message, CommandInteraction }= require('discord.js')
// eslint-disable-next-line no-unused-vars
const MillenniumEyeBot = require('./MillenniumEyeBot')

class Query {
	/**
	 * Initializes the query's properties (regexes to use to parse the message, official mode, etc.)
	 * by referencing the properties of the given qry.
	 * @param {Message | CommandInteraction} message 
	 * @param {MillenniumEyeBot} bot 
	 */
	constructor(qry, bot) {
		// if this is a message (rather than an interaction), 
		// strip the content and evaluate regexes as well for future parsing
		if (qry instanceof Message) {
			/* strip text we want to ignore from the message content:
			* - characters between `` (code tags)
			* - characters between || (spoiler tags)
			* - characters in quote lines (> text...)
			* also, convert entire message content to lowercase for case insensitivity
			*/
			this.content = qry.content.replace(/`+.*?`+/gs, '')
				.replace(/\|{2}.*?\|{2}/gs, '')
				.replace(/^\s*> .*$/gm, '')
				.toLowerCase()

			// initialize regexes using default first, then merge server-specific settings if present
			this.regexes = bot.guildQueries.get(['default']) 
			if (qry.guild && bot.guildQueries.get([qry.guild.id])) this.regexes = {...this.regexes, ...bot.guildQueries.get([qry.guild.id])}
		}

		if (qry.guild) {
			const guildOfficial = bot.guildSettings.get([qry.guild.id, 'offiical']) || bot.guildSettings.get(['default', 'official'])
			const guildRulings = bot.guildSettings.get([qry.guild.id, 'rulings']) || bot.guildSettings.get(['default', 'rulings'])
			const guildLanguage = bot.guildSettings.get([qry.guild.id, 'language']) || bot.guildSettings.get(['default', 'language'])

			// obey channel overrides compared to server setting
			this.official = guildOfficial === bot.channelSettings.get([qry.channel.id, 'official']) ?
				guildOfficial : bot.channelSettings.get([qry.channel.id, 'official'])
			this.rulings = guildRulings === bot.channelSettings.get([qry.channel.id, 'rulings']) ?
				guildRulings : bot.channelSettings.get([qry.channel.id, 'rulings'])
			this.language = guildLanguage === bot.channelSettings.get([qry.channel.id, 'language']) ?
				guildLanguage : bot.channelSettings.get([qry.channel.id, 'language'])
		}
		else {
			this.official = bot.channelSettings.get(['default', 'official'])
			this.rulings = bot.channelSettings.get(['default', 'rulings'])
			this.language = bot.channelSettings.get(['default', 'language'])
		}

		this.results = this.evaluateContent()
	}

	/**
	 * Evaluates the content of the query as initialized in the constructor.
	 * @returns {Object} An object with properties equal to each language for which a regex match was found,
	 * with values equal to an array of all matches that are to be evaluated with that language.
	 */
	evaluateContent() {
		const results = {}

		if (this.regexes) {
			for (const lan in this.regexes) {
				const regex = this.regexes[lan]
				const matches = [...this.content.matchAll(regex)]

				if (matches.length) {
					for (const m of matches) {
						const queryType = m[1]
						const query = m[2]
						// language given in query takes precedence if applicable
						const language = m[3] ? m[3] : lan
						
						if (!Object.prototype.hasOwnProperty.call(results, language)) {
							results[language] = [ 
								{
									'type': queryType,
									'query': query
								}
							]
						}
						else results[language].push({
							'type': queryType,
							'query': query
						})
					}
				}
			}
		}

		return results
	}
}

module.exports = Query
