const { Guild, Events } = require('discord.js')

const config = require('config')
const { logger, logError } = require('lib/utils/logging')
const { setupQueryRegex } = require('lib/utils/regex')
const { MillenniumEyeBot } = require('lib/models/MillenniumEyeBot')
const Event = require('lib/models/Event')

module.exports = new Event({
	event: Events.GuildCreate,
	once: false,
	/**
	 * @param {MillenniumEyeBot} bot 
	 * @param {Guild} guild 
	 */
	execute: async (bot, guild) => {
		logger.info(`Joined server ${guild.name}!`)

		// Set up default query syntax.
		const defRegex = setupQueryRegex(config.defaultOpen, config.defaultClose)
		bot.guildQueries.put([guild.id, 'default'], defRegex)
	}
})