const { Client, Collection, Partials, GatewayIntentBits, Guild, TextChannel, Options } = require('discord.js')
const Cache = require('timed-cache')

const config = require('config')
const { generateError } = require('lib/utils/logging')
const { setupQueryRegex } = require('lib/utils/regex')
const ConfigCache = require('./ConfigCache')
const { Locales, MESSAGE_TIMEOUT } = require('./Defines')

class MillenniumEyeBot extends Client {
	constructor() {
		super({ 
			intents: [
				GatewayIntentBits.MessageContent,
				GatewayIntentBits.Guilds,
				GatewayIntentBits.GuildMessages,
				GatewayIntentBits.GuildMessageTyping,
				GatewayIntentBits.GuildMessageReactions,
				GatewayIntentBits.DirectMessages,
				GatewayIntentBits.DirectMessageTyping,
				GatewayIntentBits.DirectMessageReactions
			], 
			partials: [
				// Need the channel partial to be able to receive DM events.
				Partials.Channel
			],
			makeCache: Options.cacheWithLimits({
				ReactionManager: 0,			// The bot doesn't care about reactions, don't cache any of them.
				MessageManager: 200, 		// Cache 200 messages per channel.
				GuildMemberManager: {
					maxSize: 1000,				// Cache 1000 members per server, always keeping the client.
					keepOverLimit: member => member.id === member.client.user.id
				}
			}),
			sweepers: {
				...Options.DefaultSweeperSettings,
				// Every 30 min, remove cached messages older than 15 minutes.
				messages: {
					interval: 1800,
					lifetime: 900
				}
			}
		})

		/**
		 * @type {Collection<string, Command>}
		 */
		this.commands = new Collection()

		this.logChannel = config.logChannel

		this.guildSettings = new ConfigCache('guildSettings', true)
		this.channelSettings = new ConfigCache('channelSettings', true)
		// Track regexes separately, no need to dump them to JSON files since we want to re-init them every time.
		this.guildQueries = new ConfigCache('guildQueries', false)

		/* Keep a cache of messages we've replied to so we can easily delete replies if necessary.
		 * Each entry in the cache is a map:
		 * - key: the ID of the original message that we replied to
		 * - value: an object with properties:
		 * 	- user: the ID of the user who sent the original message
		 * 	- replies: array of message IDs that the bot sent as a reply
		 * Data is deleted from this cache 15 seconds after being inserted, since it's only used for
		 * time-sensitive checks on edits and message deletions.
		 */
		this.replyCache = new Cache({ defaultTtl: MESSAGE_TIMEOUT * 1000 })

		// Flag to turn off responses to commands and messages until the bot is ready.
		this.isReady = false
	}

	start(token) {
		const defRegex = setupQueryRegex(config.defaultOpen, config.defaultClose)
		// Add a "default" server to reference for DMs.
		this.guildQueries.put(['default', 'default'], defRegex)
		// Repopulate server regexes based on locale + open/close symbols saved in JSON config.
		for (const [sid, settings] of this.guildSettings.entries()) {
			if ('queries' in settings && settings.queries) {
				for (const [locale, symbols] of Object.entries(settings.queries))
					this.guildQueries.put([sid, locale], setupQueryRegex(symbols.open, symbols.close))
			}
		}

		this.login(token)
	}

	/**
	 * Helper function to set a configuration item for a guild.
	 * If the new setting is equal to the default, then it will remove the setting
	 * from the cache entirely.
	 * @param {Guild} guild The guild associated with this setting.
	 * @param {String} setting The key of the setting.
	 * @param {String | Boolean} value The value of the setting.
	 */
	setGuildSetting(guild, setting, value) {
		if (value === this.getDefaultGuildSetting(setting)) 
			this.guildSettings.remove([guild.id, setting])
		else this.guildSettings.put([guild.id, setting], value)
	}

	/**
	 * Helper function to set a configuration item for a channel.
	 * If the new setting is equal to the default, thenn it will remove the setting
	 * from the cache entirely.
	 * @param {TextChannel} channel The channel associated with this setting.
	 * @param {String} setting The key of the setting.
	 * @param {String | Boolean} value The value of the setting.
	 */
	setChannelSetting(channel, setting, value) {
		if (value === this.getDefaultChannelSetting(channel, setting))
			this.channelSettings.remove([channel.id, setting])
		else this.channelSettings.put([channel.id, setting], value)
	}

	/**
	 * Helper function to set a new query regex for a guild.
	 * If the new setting is equal to the default, then it will remove the query
	 * from the cache entirely.
	 * @param {Guild} guild The guild associated with this setting.
	 * @param {String} open The opening symbol of the query syntax.
	 * @param {String} close The close symbol of the query syntax.
	 * @param {String} locale The locale associated with the query syntax.
	 */
	setGuildQuery(guild, open, close, locale) {
		const fullLocale = Locales[locale] ?? 'default'
		// Check to make sure no other different-locale syntax is using those symbols.
		// Overwriting the same locale with a different syntax is fine.
		const currQueries = this.guildSettings.get([guild.id, 'queries'])
		if (currQueries) {
			for (const qLocale in currQueries) {
				if (currQueries[qLocale]['open'] === open && 
					currQueries[qLocale]['close'] === close)
				{
					const conflictedLocale = Locales[qLocale]
					if (qLocale !== locale)  
						throw generateError(
							null,
							`This syntax is already being used for **${conflictedLocale}** queries. To use this syntax for ${fullLocale} queries, you must either remove or change the ones used for ${conflictedLocale} queries.`
						)
					else
						throw generateError(
							null,
							`This syntax is already being used for **${conflictedLocale}** queries. No changes were made.`
						)
				}
			}
		}

		const queryRegex = setupQueryRegex(open, close)
		this.guildSettings.put([guild.id, 'queries', locale], { 'open': open, 'close': close })
		this.guildQueries.put([guild.id, locale], queryRegex)
	}

	/**
	 * Helper function to remove a query regex for a guild.
	 * @param {Guild} guild The guild for which the query syntax will be removed.
	 * @param {String} locale The locale associated with the query syntax to be removed.
	 * @returns The removed query syntax, or undefined if none existed.
	 */
	removeGuildQuery(guild, locale) {
		let removed = this.guildSettings.remove([guild.id, 'queries', locale])
		this.guildQueries.remove([guild.id, locale])

		return removed
	}

	/**
	 * Helper function get the query regexes associated with a guild.
	 * @param {Guild} guild The guild to check the query syntaxes for, if one exists.
	 * @returns {Object} The set of query syntaxes associated with the guild.
	 */
	getGuildQueries(guild) {
		return guild ? this.guildQueries.get([guild.id]) : this.guildQueries.get(['default'])
	}

	/**
	 * Helper function to evaluate the default setting for a server (NOT necessarily its current).
	 * @param {String} setting The key of the setting to be checked.
	 * @returns {String | Boolean} The value associated with the setting.
	 */
	getDefaultGuildSetting(setting) {
		const defaultKey = `default${setting.charAt(0).toUpperCase() + setting.slice(1)}`

		return config[defaultKey]
	}

	/**
	 * Helper function to evaluate the default setting for a guild.
	 * @param {Guild} guild The guild to check the settings for. 
	 * @param {String} setting The key of the setting to be checked.
	 * @returns {String | Boolean} The string or boolean value associated with the setting.
	 */
	getCurrentGuildSetting(guild, setting) {
		// Make sure the guild exists (might not in DM cases)
		if (guild) 
			return this.guildSettings.get([guild.id, setting]) ?? this.getDefaultGuildSetting(setting)
		else return this.getDefaultGuildSetting(setting)
	}

	/**
	 * Helper function to evaluate the default setting for a channel (NOT necessarily its current),
	 * taking into account server overrides.
	 * This function really is just a more specific form of getCurrentGuildSetting,
	 * but I keep it around for code clarity's sake.
	 * @param {TextChannel} channel The channel to check the settings for.
	 * @param {String} setting The key of the setting to be checked.
	 * @returns {String | Boolean} The string or boolean value associated with the setting.
	 */
	getDefaultChannelSetting(channel, setting) {
		return this.getCurrentGuildSetting(channel.guild, setting)
	}

	/**
	 * Helper function to evaluate the current setting for a channel,
	 * taking into account server overrides.
	 * @param {TextChannel} channel The channel to check the settings for.
	 * @param {String} setting The key of the setting to be checked.
	 * @returns {String | Boolean} The string or boolean value with the setting.
	 */
	getCurrentChannelSetting(channel, setting) {
		return this.channelSettings.get([channel.id, setting]) ?? this.getDefaultChannelSetting(channel, setting)
	}
}

const meInstance = new MillenniumEyeBot()

module.exports =  { 
	MillenniumEyeBot, meInstance
}