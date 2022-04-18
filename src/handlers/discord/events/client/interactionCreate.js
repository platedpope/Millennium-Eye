const Discord = require('discord.js')

const { logError } = require ('lib/utils/logging')
const { MillenniumEyeBot } = require('lib/models/MillenniumEyeBot')
const Event = require('lib/models/Event')

module.exports = new Event({
	event: 'interactionCreate',
	once: false,
	/**
	 * @param {MillenniumEyeBot} bot 
	 * @param {Discord.Interaction} interaction 
	 */
	execute: async (bot, interaction) => {
		if (!bot.isReady) {
			await interaction.followUp( { content: 'The bot was recently booted and is not ready yet. Try again in a bit...', ephemeral: true } )
			return
		}

		if (interaction.isCommand()) {
			const command = bot.commands.get(interaction.commandName)
			if (!command) return await interaction.followUp({ content: 'This command no longer exists.' }) && bot.commands.delete(interaction.commandName)

			try { await command.execute(interaction, bot) }
			catch (err) {
				if ('logMessage' in err && err.logMessage)
					logError(err, err.logMessage, interaction)
				else logError(err, `Failed to execute command ${command.name}!`, interaction)

				const iResponse = 'channelResponse' in err && err.channelResponse ? err.channelResponse : 'The bot encountered an unexpected error when running that command.'
				if (!interaction.replied && !interaction.deferred)
					await interaction.reply(iResponse)
				else
					await interaction.editReply(iResponse)
			}
		}
	}
})