const Discord = require('discord.js')

const { prepareDiscordLogJsMessage } = require ('lib/utils/logging')
const MillenniumEyeBot = require('lib/models/MillenniumEyeBot')
const Event = require('lib/models/Event')
const { processQuery } = require('user/QueryHandler')

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

		const qry = processQuery(bot, message)

		if (qry.searches.length !== 0) 
			for (const m of prepareDiscordLogJsMessage(qry.searches)) {
				message.channel.send(m)
			}
	}
})