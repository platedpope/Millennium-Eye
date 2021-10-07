/* eslint-disable no-unused-vars */
const { Guild } = require('discord.js')
const MillenniumEyeBot = require('../../../utils/structures/MillenniumEyeBot')
const Event = require('../../../utils/structures/Event')

module.exports = new Event({
	event: 'guildDelete',
	once: false,
	/**
	 * @param {MillenniumEyeBot} bot 
	 * @param {Guild} guild
	 */
	execute: async (bot, guild) => {
		// delete from cache if applicable
		bot.guildSettings.remove(guild.id)
	}
})