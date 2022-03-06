const { GuildChannel } = require('discord.js')

const MillenniumEyeBot = require('lib/models/MillenniumEyeBot')
const Event = require('lib/models/Event')

module.exports = new Event({
	event: 'channelDelete',
	once: false,
	/**
	 * @param {MillenniumEyeBot} bot 
	 * @param {GuildChannel} channel 
	 */
	execute: async (bot, channel) => {
		// delete from cache if applicable
		bot.channelSettings.remove(channel.id)
	}
})