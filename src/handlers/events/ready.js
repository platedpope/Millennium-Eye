const heapdump = require('heapdump')

const config = require('config')
const { logger, logError } = require ('lib/utils/logging')
const { MillenniumEyeBot } = require('lib/models/MillenniumEyeBot')
const Event = require('lib/models/Event')
const { clearSearchCache } = require('handlers/QueryHandler')
const { addTcgplayerDataToDb } = require('handlers/BotDBHandler')
const { cacheNameToIdIndex, cacheManifestRevision, cachePropertyMetadata } = require('handlers/YGOrgDBHandler')
const { updateKonamiDb } = require('handlers/KonamiDBHandler')
const { cacheSetProductData } = require('handlers/TCGPlayerHandler')
const { ActivityType, PresenceUpdateStatus, Events } = require('discord.js')
const { setupQueryRegex } = require('lib/utils/regex')

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
			logError(err, 'Failed to refresh application commands.')
		}

		// Set up all our caches and periodics updates.
		
		// Add the default regex to every server, if it doesn't already have a language with the default syntax.
		const defRegex = setupQueryRegex(config.defaultOpen, config.defaultClose)
		bot.guilds.cache.forEach(g => {
			let needsDefault = true
			const guildQuerySyntax = bot.guildSettings.get([g.id, 'queries'])
			if (guildQuerySyntax) {
				for (const [locale, symbols] of Object.entries(guildQuerySyntax))
					if (symbols.open === config.defaultOpen && symbols.close === config.defaultClose) {
						needsDefault = false
						break
					}
			}

			if (needsDefault) 
				bot.guildQueries.put([g.id, 'default'], defRegex)
		})
		
		// Search term cache clear: once every hour.
		// (This doesn't actually clear the cache, it just checks for stale entries and evicts those).
		setInterval(clearSearchCache, 60 * 60 * 1000)
		if (!config.testMode) {
			// Konami database update: once per day.
			// await updateKonamiDb()
			// setInterval(updateKonamiDb, 24 * 60 * 60 * 1000)
			// TCGPlayer set product data update: once per day.
			await cacheSetProductData(addTcgplayerDataToDb)
			setInterval(cacheSetProductData, 24 * 60 * 60 * 1000, addTcgplayerDataToDb)
		}
		// YGOrg manifest.
		cacheManifestRevision()
		// YGOrg name->ID search index. Set this up on launch, but doesn't need a periodic, 
		// will be refreshed as necessary during runtime.
		await cacheNameToIdIndex()
		// YGOrg locale property metadata. Set this up on launch, but it's static, don't need to update periodically.
		await cachePropertyMetadata()

		// Set bot presence every 5 minutes because sometimes it falls off for some reason.
		setInterval(() => {
			bot.user.setPresence({ 
				activities: [{ name: 'for /help!', type: ActivityType.Watching }],
				status: PresenceUpdateStatus.Online
			})
		}, 5 * 60 * 1000)

		logger.info('Bot has finished initialization!')
		bot.isReady = true
	}
})