const Discord = require('discord.js')

const { MillenniumEyeBot } = require('lib/models/MillenniumEyeBot')
const Event = require('lib/models/Event')
const { logError } = require('lib/utils/logging')

module.exports = new Event({
	event: Discord.Events.MessageDelete,
	once: false,
	/**
	 * @param {MillenniumEyeBot} bot 
	 * @param {Discord.Message} message 
	 */
	execute: async (bot, message) => {
		if (message.author.bot) return

		const cachedMessage = bot.replyCache.get(message.id)
		if (cachedMessage) {
			try {
				for (const r of cachedMessage.replies) await r.delete()
				bot.replyCache.remove(message.id)
			}
			catch (err) {
				await logError(err)
			}
		}
	}
})