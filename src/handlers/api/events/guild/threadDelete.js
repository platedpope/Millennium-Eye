const { ThreadChannel } = require('discord.js')

const MillenniumEyeBot = require('lib/models/MillenniumEyeBot')
const Event = require('lib/models/Event')

module.exports = new Event({
	event: 'threadDelete',
	once: false,
	/**
	 * @param {MillenniumEyeBot} bot 
	 * @param {ThreadChannel} thread
	 */
	execute: async (bot, thread) => {
		// delete from cache if applicable
		bot.channelSettings.remove(thread.id)
	}
})