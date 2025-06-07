const { ActivityType, PresenceUpdateStatus, Events } = require('discord.js')

const config = require('config')
const { logger, logError } = require ('lib/utils/logging')
const { MillenniumEyeBot } = require('lib/models/MillenniumEyeBot')
const Event = require('lib/models/Event')
const { clearSearchCache } = require('handlers/QueryHandler')
const { addTcgplayerDataToDb } = require('handlers/BotDBHandler')
const { checkForDataManifestUpdate } = require('handlers/YGOResourcesHandler')
const { cacheSetProductData } = require('handlers/TCGPlayerHandler')
const { updateKonamiDb } = require('handlers/KonamiDBHandler')

module.exports = new Event({
	event: Events.ClientReady, 
	once: true,
	/**
	 * @param {MillenniumEyeBot} bot 
	 */
	execute: async bot => {
		// Cache log channel.
		bot.logChannel = await bot.channels.fetch(bot.logChannel)
		
		// Refresh slash commands.
		try {
			const applicationGuildCommands = []
			const applicationGlobalCommands = []
			for (const cmd of bot.commands.values()) {
				// Currently, everything is a global command unless test mode is enabled.
				// Future commands may be implemented that are guild-only.
				if (config.testMode)
					applicationGuildCommands.push(cmd.data.toJSON())
				else 
					applicationGlobalCommands.push(cmd.data.toJSON())
			}

			if (applicationGuildCommands.length) {
				logger.info(`Refreshing ${applicationGuildCommands.length} guild commands.`)
				applicationGuildCommands.map(cmd => logger.debug(`- ${cmd.name}`))
				if (config.testMode) {
					logger.info('Test mode is enabled, only refreshing in test server.')
					const testGuild = bot.guilds.cache.get(config.testGuild)
					await testGuild.commands.set(applicationGuildCommands)
				}
				else {
					bot.guilds.cache.each(async guild => {
						await guild.commands.set(applicationGuildCommands)
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
			await logError(err, 'Failed to refresh application commands.')
		}

		// Initialize default query syntax in every server.
		bot.guilds.cache.forEach(g => {
			const guildQuerySyntax = bot.getGuildQueries(g)
			if (guildQuerySyntax) {
				if (!('default' in guildQuerySyntax)) {
					try {
						bot.setGuildQuery(g, config.defaultOpen, config.defaultClose, 'default')
					}
					catch (err) {
						// This might fail if the server already has a specific language using the default open/close syntax.
						// If so, nothing to be done, just assume that was an intentional change on their part.
						logger.debug(`Server ${g.name} overwrote the default syntax, skipping adding a default to their guild settings.`)
					}
				}
			}
			else {
				bot.setGuildQuery(g, config.defaultOpen, config.defaultClose, 'default')
			}
		})

		// Set up all our caches and periodics updates.
		
		// Search term cache clear: once every hour.
		// (This doesn't actually clear the cache, it just checks for stale entries and evicts those).
		setInterval(clearSearchCache, 1000 * 60 * 60)
		if (!config.testMode) {
			// YGOResources manifest check: once per 30 min.
			await checkForDataManifestUpdate()
			setInterval(checkForDataManifestUpdate, 30 * 60 * 1000)
			// Konami database update: once per day.
			await updateKonamiDb()
			setInterval(updateKonamiDb, 24 * 60 * 60 * 1000)
			// TCGPlayer set product data update: once per day.
			await cacheSetProductData(addTcgplayerDataToDb)
			setInterval(cacheSetProductData, 24 * 60 * 60 * 1000, addTcgplayerDataToDb)
		}

		const setBotPresence = () => {
			bot.user.setPresence({ 
				activities: [{ name: 'for /help!', type: ActivityType.Watching }],
				status: PresenceUpdateStatus.Online
			})
		}
		setBotPresence()
		// Set bot presence every 5 minutes because sometimes it falls off for some reason.
		setInterval(setBotPresence, 5 * 60 * 1000)

		logger.info('Bot has finished initialization!')
		bot.isReady = true
	}
})