/* eslint-disable no-unused-vars */
const { GuildChannel } = require('discord.js')
const MillenniumEyeBot = require('../../../utils/structures/MillenniumEyeBot')
const Event = require('../../../utils/structures/Event')

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