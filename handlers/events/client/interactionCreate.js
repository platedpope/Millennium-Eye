/* eslint-disable no-unused-vars */

const Discord = require('discord.js')
const MillenniumEyeBot = require('../../../utils/structures/MillenniumEyeBot')
const Event = require('../../../utils/structures/Event')
const { logger, logError, prepareDiscordLogJsMessage } = require ('../../../utils/modules/logging')

module.exports = new Event({
	event: 'interactionCreate',
	once: false,
	/**
	 * @param {MillenniumEyeBot} bot 
	 * @param {Discord.Interaction} interaction 
	 */
	execute: async (bot, interaction) => {
		if (interaction.isCommand()) {
			const command = bot.commands.get(interaction.commandName)
			if (!command) return await interaction.followUp({ content: 'This command no longer exists.' }) && bot.commands.delete(interaction.commandName)

			try { await command.execute(interaction, bot) }
			catch (err) {
				if (Object.prototype.hasOwnProperty.call(err, 'logMessage')) {
					if (err.logMessage) logError(err, err.logMessage, bot, interaction)
				}
				else logError(err, `Failed to execute command ${command.name}!`, bot, interaction)

				if (Object.prototype.hasOwnProperty.call(err, 'channelResponse')) {
					if (err.channelResponse) interaction.reply(`${err.channelResponse}`)
				}
				else interaction.reply('The bot encountered an unexpected error when running that command.')
			}
		}
	}
})