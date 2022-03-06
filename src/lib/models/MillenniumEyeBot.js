const Discord = require('discord.js')

const config = require('config')
const { generateError } = require('lib/utils/logging')
const { setupQueryRegex } = require('lib/utils/regex')
const Command = require('./Command')
const ConfigCache = require('./ConfigCache')

const intents = new Discord.Intents(32767)

class MillenniumEyeBot extends Discord.Client {
	constructor() {
		super({ intents })

		/**
		 * @type {Discord.Collection<string, Command>}
		 */
		this.commands = new Discord.Collection()

		this.guildSettings = new ConfigCache('guildSettings', true)
		this.channelSettings = new ConfigCache('channelSettings', true)
		// track regexes separately, no need to dump them to JSON files since we want to re-init them every time
		this.guildQueries = new ConfigCache('guildQueries', false)
	}

	start(token) {
		const defRegex = setupQueryRegex(config.defaultOpen, config.defaultClose)
		// track default regex for use outside of guilds or in newly joined guilds
		this.guildQueries.put(['default', config.defaultLanguage], defRegex)
		// repopulate server regexes based on language + open/close symbols saved in JSON
		for (const [sid, settings] of this.guildSettings.entries()) {
			if ('queries' in settings && settings.queries) {
				for (const [lan, symbols] of Object.entries(settings.queries))
					this.guildQueries.put([sid, lan], setupQueryRegex(symbols.open, symbols.close))
			}
			
			const defaultSyntaxRemoved = this.guildSettings.get([sid, 'defaultSyntaxRemoved']) ?? false
			// add default regex if necessary (not removed, and no custom syntax to conflict with)
			if (!defaultSyntaxRemoved && 
				(!('queries' in settings) || 
				('queries' in settings && !(config.defaultLanguage in settings.queries))))
			{
				this.guildQueries.put([sid, config.defaultLanguage], defRegex)
			}
		}

		this.login(token)
	}

	/**
	 * Helper function to set a configuration item for a guild.
	 * If the new setting is equal to the default, then it will remove the setting
	 * from the cache entirely.
	 * @param {Discord.Guild} guild The guild associated with this setting.
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
	 * @param {Discord.TextChannel} channel The channel associated with this setting.
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
	 * @param {Discord.Guild} guild The guild associated with this setting.
	 * @param {String} open The opening symbol of the query syntax.
	 * @param {String} close The close symbol of the query syntax.
	 * @param {String} language The language associated with the query syntax.
	 */
	setGuildQuery(guild, open, close, language) {
		const defaultSyntaxRemoved = this.guildSettings.get([guild.id, 'defaultSyntaxRemoved']) ?? false
		const fullLanguage = config.languages[language]
		// check to make sure no other different-language syntax is using those symbols
		// (overwriting the same language with a different syntax is fine)
		// check default syntax overlap first if this server hasn't opted out of using it
		if (!defaultSyntaxRemoved && language !== config.defaultLanguage && 
			open === config.defaultOpen && close === config.defaultClose) 
		{
			throw generateError(
				null,
				`This syntax is already being used for **${fullLanguage}** queries.`
			)
		}
		// now check all other languages this server might have set (if applicable)
		const currQueries = this.guildSettings.get([guild.id, 'queries'])
		if (currQueries) {
			for (const qLan in currQueries) {
				if (currQueries[qLan]['open'] === open && 
					currQueries[qLan]['close'] === close)
				{
					const conflictedLanguage = config.languages[qLan]
					if (qLan !== language)  
						throw generateError(
							null,
							`This syntax is already being used for **${conflictedLanguage}** queries. To use this syntax for ${fullLanguage} queries, you must either remove or change the ones used for ${conflictedLanguage} queries.`
						)
					else
						throw generateError(
							null,
							`This syntax is already being used for **${conflictedLanguage}** queries. No changes were made.`
						)
				}
			}
		}

		const queryRegex = setupQueryRegex(open, close)
		this.guildQueries.put([guild.id, language], queryRegex)
		// incidentally, if this is the default query syntax + language again and they've previously removed it,
		// then just reflect they no longer want it removed and stop at quietly adding it back
		if (defaultSyntaxRemoved && language === config.defaultLanguage &&
			open === config.defaultOpen && close == config.defaultClose)
		{
			this.guildSettings.remove([guild.id, 'defaultSyntaxRemoved'])
		}
		else {
			// otherwise save to config as well
			this.guildSettings.put([guild.id, 'queries', language], { 'open': open, 'close': close })
		}
	}

	/**
	 * Helper function to remove a query regex for a guild.
	 * @param {Discord.Guild} guild The guild for which the query syntax will be removed.
	 * @param {String} language The language associated with the query syntax to be removed.
	 * @returns The removed query syntax, or undefined if none existed.
	 */
	removeGuildQuery(guild, language) {
		const defaultSyntaxRemoved = this.guildSettings.get([guild.id, 'defaultSyntaxRemoved']) ?? false

		let removed = this.guildSettings.remove([guild.id, 'queries', language])
		this.guildQueries.remove([guild.id, language])
		// if nothing was removed at first blush, check whether this is the default,
		// and if so, track that they no longer want it
		if (!removed && !defaultSyntaxRemoved &&
			language === config.defaultLanguage) 
		{
			this.guildSettings.put([guild.id, 'defaultSyntaxRemoved'], true)
			removed = { 'open': config.defaultOpen, 'close': config.defaultClose }
		}

		return removed
	}

	/**
	 * Helper function get the query regexes associated with a guild.
	 * @param {Discord.Guild} guild The guild to check the query syntaxes for, if one exists.
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
	 * @param {Discord.Guild} guild The guild to check the settings for. 
	 * @param {String} setting The key of the setting to be checked.
	 * @returns {String | Boolean} The string or boolean value associated with the setting.
	 */
	getCurrentGuildSetting(guild, setting) {
		// make sure the guild exists (might not in DM cases)
		if (guild) 
			return this.guildSettings.get([guild.id, setting]) ?? this.getDefaultGuildSetting(setting)
		else return this.getDefaultGuildSetting(setting)
	}

	/**
	 * Helper function to evaluate the default setting for a channel (NOT necessarily its current),
	 * taking into account server overrides.
	 * This function really is just a more specific form of getCurrentGuildSetting,
	 * but I keep it around for code clarity's sake.
	 * @param {Discord.TextChannel} channel The channel to check the settings for.
	 * @param {String} setting The key of the setting to be checked.
	 * @returns {String | Boolean} The string or boolean value associated with the setting.
	 */
	getDefaultChannelSetting(channel, setting) {
		return this.getCurrentGuildSetting(channel.guild, setting)
	}

	/**
	 * Helper function to evaluate the current setting for a channel,
	 * taking into account server overrides.
	 * @param {Discord.TextChannel} channel The channel to check the settings for.
	 * @param {String} setting The key of the setting to be checked.
	 * @returns {String | Boolean} The string or boolean value with the setting.
	 */
	getCurrentChannelSetting(channel, setting) {
		return this.channelSettings.get([channel.id, setting]) ?? this.getDefaultChannelSetting(channel, setting)
	}
}

module.exports = MillenniumEyeBot