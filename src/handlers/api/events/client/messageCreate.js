const Discord = require('discord.js')

const { prepareDiscordLogJsMessage } = require ('lib/utils/logging')
const MillenniumEyeBot = require('lib/models/MillenniumEyeBot')
const Event = require('lib/models/Event')
const Query = require('lib/models/Query')

module.exports = new Event({
	event: 'messageCreate',
	once: false,
	/**
	 * @param {MillenniumEyeBot} bot 
	 * @param {Discord.Message} message 
	 */
	execute: async (bot, message) => {
		if (message.author.bot) return
		if (!message.content) return

		// construct list of properties that are important to evaluating this query
		const qry = new Query(message, bot)

		if (Object.keys(qry.eval).length !== 0) 
			for (const m of prepareDiscordLogJsMessage(qry.eval)) {
				message.channel.send(m)
			}
	}
})