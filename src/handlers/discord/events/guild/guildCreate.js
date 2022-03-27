const { Guild } = require('discord.js')

const config = require('config')
const { logger, logError } = require('lib/utils/logging')
const { updateCommandPermissions } = require('lib/utils/permissions')
const { setupQueryRegex } = require('lib/utils/regex')
const { MillenniumEyeBot } = require('lib/models/MillenniumEyeBot')
const Event = require('lib/models/Event')

module.exports = new Event({
	event: 'guildCreate',
	once: false,
	/**
	 * @param {MillenniumEyeBot} bot 
	 * @param {Guild} guild 
	 */
	execute: async (bot, guild) => {
		logger.info(`Joined server ${guild.name}!`)
		// initialize commands and permissions in this guild
		try {
			const guildCommands = []
			for (const cmd of bot.commands.values())
				// if it requires specific permissions, it's a guild command
				if (cmd.permissions) guildCommands.push(cmd.options)

			if (guildCommands.length) {
				logger.info(`Adding ${guildCommands.length} commands to guild ${guild.name} and setting permissions.`)
				guild.commands.set(guildCommands)
				// update permissions as well
				await updateCommandPermissions(bot, guild)
			}
		}
		catch (err) {
			logError(err, 'Could not set guild commands.', guild)
		}

		// set up default query syntax
		const defRegex = setupQueryRegex(config.defaultOpen, config.defaultClose)
		bot.guildQueries.put([guild.id, config.defaultLanguage], defRegex)
	}
})