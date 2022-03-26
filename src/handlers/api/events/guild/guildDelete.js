const { Guild } = require('discord.js')

const { MillenniumEyeBot } = require('lib/models/MillenniumEyeBot')
const Event = require('lib/models/Event')

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
		bot.guildQueries.remove(guild.id)
	}
})