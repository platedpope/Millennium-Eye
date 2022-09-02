const { ThreadChannel, Events } = require('discord.js')

const { MillenniumEyeBot } = require('lib/models/MillenniumEyeBot')
const Event = require('lib/models/Event')

module.exports = new Event({
	event: Events.ThreadDelete,
	once: false,
	/**
	 * @param {MillenniumEyeBot} bot 
	 * @param {ThreadChannel} thread
	 */
	execute: async (bot, thread) => {
		// Delete from cache if applicable.
		bot.channelSettings.remove(thread.id)
	}
})