/* eslint-disable no-unused-vars */
const { Guild } = require('discord.js')
const { mainClient } = require('../../../data/config.json')
const MillenniumEyeBot = require('../../../utils/structures/MillenniumEyeBot')
const Event = require('../../../utils/structures/Event')
const { logger, logError } = require('../../../utils/modules/logging')
const { updateCommandPermissions } = require('../../../utils/modules/permissions')

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
			logError(err, 'Could not set guild commands.', bot, guild)
		}
	}
})