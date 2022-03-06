const config = require('config')
const { logger, logError } = require ('lib/utils/logging')
const { updateCommandPermissions } = require('lib/utils/permissions')
const MillenniumEyeBot = require('lib/models/MillenniumEyeBot')
const Event = require('lib/models/Event')

module.exports = new Event({
	event: 'ready', 
	once: true,
	/**
	 * @param {MillenniumEyeBot} bot 
	 */
	execute: async bot => {
		// cache log channel
		bot.logChannel = bot.channels.cache.get(config.logChannel)
		
		// refresh slash commands
		try {
			const applicationGuildCommands = []
			const applicationGlobalCommands = []
			for (const cmd of bot.commands.values()) {
				// if it requires specific permissions, make it a guild command
				// because slash command permissions are only configurable by user/role ID, which has to be guild specific
				if (config.testMode || cmd.permissions) 
					applicationGuildCommands.push(cmd.options)
				else 
					applicationGlobalCommands.push(cmd.options)
			}

			logger.info('Beginning refresh of application commands.')

			if (applicationGuildCommands.length) {
				logger.info(`Refreshing ${applicationGuildCommands.length} guild commands.`)
				applicationGuildCommands.map(cmd => logger.debug(`- ${cmd.name}`))
				if (config.testMode) {
					logger.info('Test mode is enabled, only refreshing in test server.')
					const testGuild = bot.guilds.cache.get(config.testGuild)
					await testGuild.commands.set(applicationGuildCommands)
					// update permissions as well
					await updateCommandPermissions(bot, testGuild)
				}
				else {
					bot.guilds.cache.each(async guild => {
						await guild.commands.set(applicationGuildCommands)
						// update permissions as well
						await updateCommandPermissions(bot, guild)
					})
				}
			}
			if (applicationGlobalCommands.length) {
				logger.info(`Refreshing ${applicationGlobalCommands.length} global commands.`)
				applicationGlobalCommands.map(cmd => logger.debug(`- ${cmd.name}`))
				await bot.application.commands.set(applicationGlobalCommands)
			}

			logger.info('Successfully refreshed application commands.')
		}
		catch (err) {
			logError(err, 'Failed to refresh application commands.', bot)
		}

		// set bot presence
		bot.user.setActivity('/help for info!', { type: 'WATCHING' })

		logger.info('Bot has finished initialization!')
	}
})