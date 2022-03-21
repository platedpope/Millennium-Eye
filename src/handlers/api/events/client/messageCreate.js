const Discord = require('discord.js')

const { prepareDiscordLogJsMessage } = require ('lib/utils/logging')
const MillenniumEyeBot = require('lib/models/MillenniumEyeBot')
const Event = require('lib/models/Event')
const { processMessage, sendReply } = require('user/QueryHandler')

module.exports = new Event({
	event: 'messageCreate',
	once: false,
	/**
	 * @param {MillenniumEyeBot} bot 
	 * @param {Discord.Message} message 
	 */
	execute: async (bot, message) => {
		if (!bot.isReady) return
		if (message.author.bot) return
		if (!message.content) return

		const qry = await processMessage(bot, message)

		if (qry.searches.length !== 0)  {
			const embeds = qry.getDataEmbeds()
			if (embeds)
				sendReply(bot, message, '', qry, {
					allowedMentions: { repliedUser: false },
					embeds: embeds
				})
			/*
			for (const m of prepareDiscordLogJsMessage(qry.searches)) {
				sendReply(bot, message, m, qry, { 
					allowedMentions: { repliedUser: false } 
				})
			}
			*/
		}
	}
})