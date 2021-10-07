const Discord = require('discord.js')
// eslint-disable-next-line no-unused-vars
const Command = require('./Command')
const ConfigCache = require('./ConfigCache')
const { setupQueryRegex } = require('../modules/regex')
const config = require('../../data/config.json')

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
		// repopulate server regexes based on language + open/close symbols saved in JSON
		for (const [sid, settings] of this.guildSettings.entries()) {
			if (!Object.prototype.hasOwnProperty.call(settings, 'queries')) continue
		
			for (const [lan, symbols] of Object.entries(settings.queries)) {
				const regex = setupQueryRegex(symbols.open, symbols.close)
				this.guildQueries.put([sid, lan], regex)
			}
		}
		// also reload default regex
		const defRegex = setupQueryRegex(config.defaultOpen, config.defaultClose)
		this.guildQueries.put(['default', config.defaultLanguage], defRegex)

		this.login(token)
	}

	/**
	 * Helper function to set a configuration item for a guild.
	 * If the new setting is equal to the default, then it will remove the setting
	 * from the cache entirely.
	 * BEWARE: Do NOT use this function to set values that are nested objects.
	 * @param {Discord.Guild} guild The guild.
	 * @param {String} setting The key of the setting.
	 * @param {String | Boolean} value The value of the setting.
	 */
	setGuildSetting(guild, setting, value) {
		const defaultKey = `default${setting.charAt(0).toUpperCase() + setting.slice(1)}`

		if (value === config[defaultKey]) this.guildSettings.remove([guild.id, setting])
		else this.guildSettings.put([guild.id, setting], value)
	}

	/**
	 * Helper function to set a configuration item for a channel.
	 * If the new setting is equal to the default, thenn it will remove the setting
	 * from the cache entirely.
	 * @param {Discord.Channel} channel The channel.
	 * @param {String} setting The key of the setting.
	 */
	setChannelSetting(channel, setting, value) {
		if (value === this.getDefaultChannelSetting(channel, setting))
			this.channelSettings([channel.id, setting])
		else this.channelSettings.put([channel.id, setting], value)
	}

	/**
	 * Helper function to evaluate the default setting for a guild.
	 * @param {Discord.Guild} guild The guild to check the settings for. 
	 * @param {String} setting The key of the setting to be checked.
	 * @returns {Boolean | String} The value of the setting.
	 */
	getCurrentGuildSetting(guild, setting) {
		const guildSetting = this.guildSettings.get([guild.id, setting])
		return guildSetting !== undefined ?
			guildSetting : config[`default${setting.charAt(0).toUpperCase() + setting.slice(1)}`]
	}

	/**
	 * Helper function to evaluate the default setting for a channel,
	 * taking into account server overrides.
	 * @param {Discord.TextChannel} channel The channel to check the settings for.
	 * @param {String} setting The key of the setting to be checked.
	 * @returns {Boolean | String} The value of the setting.
	 */
	getDefaultChannelSetting(channel, setting) {
		// reference server override for default if available
		const guildSetting = this.guildSettings.get([channel.guild.id, setting])
		return guildSetting !== undefined ?
			guildSetting : config[`default${setting.charAt(0).toUpperCase() + setting.slice(1)}`]
	}

	/**
	 * Helper function to evaluate the current setting for a channel,
	 * taking into account server overrides.
	 * @param {Discord.TextChannel} channel The channel to check the settings for.
	 * @param {String} setting The key of the setting to be checked.
	 * @returns {Boolean | String} The value of the setting.
	 */
	getCurrentChannelSetting(channel, setting) {
		let currSetting = this.channelSettings.get([channel.id, setting])
		// need to check for undefined, since some settings are boolean values
		// and might mistakenly be evaluated as false-y
		if (currSetting === undefined) 
			currSetting = this.getDefaultChannelSetting(channel, setting)

		return currSetting
	}
}

module.exports = MillenniumEyeBot