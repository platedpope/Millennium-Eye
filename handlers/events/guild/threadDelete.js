/* eslint-disable no-unused-vars */
const { ThreadChannel } = require('discord.js')
const MillenniumEyeBot = require('../../../utils/structures/MillenniumEyeBot')
const Event = require('../../../utils/structures/Event')

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