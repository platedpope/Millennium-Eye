const { Guild, Events } = require('discord.js')

const { MillenniumEyeBot } = require('lib/models/MillenniumEyeBot')
const Event = require('lib/models/Event')

module.exports = new Event({
	event: Events.GuildDelete,
	once: false,
	/**
	 * @param {MillenniumEyeBot} bot 
	 * @param {Guild} guild
	 */
	execute: async (bot, guild) => {
		// Delete from cache if applicable.
		bot.guildSettings.remove(guild.id)
		bot.guildQueries.remove(guild.id)
		// Also any channels in this server.
		guild.channels.cache.forEach(ch => bot.channelSettings.remove(ch.id))
	}
})