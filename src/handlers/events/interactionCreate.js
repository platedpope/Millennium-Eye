const Discord = require('discord.js')

const { logError } = require ('lib/utils/logging')
const { MillenniumEyeBot } = require('lib/models/MillenniumEyeBot')
const Event = require('lib/models/Event')

module.exports = new Event({
	event: Discord.Events.InteractionCreate,
	once: false,
	/**
	 * @param {MillenniumEyeBot} bot 
	 * @param {Discord.Interaction} interaction 
	 */
	execute: async (bot, interaction) => {
		// Early bail conditions, regardless of interaction type.
		if (!bot.isReady) {
			if (interaction.isCommand()) {
				await interaction.reply( { content: 'The bot was recently booted and is not ready yet. Try again in a bit...', ephemeral: true } )
			}
			return
		}
		// If the channel is null, that means the bot doesn't have permissions to view it.
		else if (interaction.channel === null) {
			if (interaction.isCommand()) {
				await interaction.reply('The bot does not have permissions to view this channel and cannot respond properly.')
			}
			return
		}

		if (interaction.isCommand()) {
			const command = bot.commands.get(interaction.commandName)
			if (!command) return await interaction.followUp({ content: 'This command no longer exists.' }) && bot.commands.delete(interaction.commandName)

			try { await command.execute(interaction, bot) }
			catch (err) {
				if (err.logMessage) {
					await logError(err, err.logMessage, interaction)
				}
				else if (!err.channelResponse) {
					// Only log this error if the error has no channel response.
					// If it does have a channel response, then it's probably not a "real" error,
					// and is just reporting something to the user that invoked the command.
					await logError(err, `Failed to execute command ${command.name}!`, interaction)
				}

				const iResponse = 'channelResponse' in err && err.channelResponse ? err.channelResponse : 'The bot encountered an unexpected error when running that command.'
				try {
					if (!interaction.replied && !interaction.deferred)
						await interaction.reply(iResponse)
					else
						await interaction.editReply(iResponse)
				}
				catch (err) {
					// Sometimes this produces an "unknown interaction" error. No idea why.
				}
			}
		}
		else if (interaction.isAutocomplete()) {
			const command = bot.commands.get(interaction.commandName)
			if (!command) return
			
			try { await command.autocomplete(interaction, bot) }
			catch (err) {
				// This log is incredibly spammy since autocomplete events fire every few hundred ms.
				// logError(err, 'Autocomplete interaction failed.', interaction)
			}
		}
	}
})