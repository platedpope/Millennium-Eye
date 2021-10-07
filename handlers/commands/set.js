/* eslint-disable no-unused-vars */
const { MessageActionRow, MessageButton, MessageSelectMenu, Interaction, TextChannel } = require('discord.js')
const config = require('../../data/config.json')
const { generateError, logger } = require('../../utils/modules/logging')
const { setupQueryRegex } = require('../../utils/modules/regex')
const Command = require('../../utils/structures/Command')
const MillenniumEyeBot = require('../../utils/structures/MillenniumEyeBot')
const { CommandTypes } = require('../../utils/structures/Validation')

// convert available languages to an array of choices that can be parsed by slash commands
const languageChoices = []
for (const code in config.languages) {
	languageChoices.push({
		'name': config.languages[code],
		'value': code
	})
}

/**
 * Helper function to generate all the message components (buttons/menus) for controlling
 * server-specific configuration in response to the /set server command.
 * @param {Interaction} interaction The interaction associated with the command.
 * @param {MillenniumEyeBot} bot The bot.
 */
function generateServerComponents(interaction, bot) {
	const messageRows = []
	const guildOfficial = bot.getCurrentGuildSetting(interaction.guild, 'official')
	const guildRulings = bot.getCurrentGuildSetting(interaction.guild, 'rulings')
	const guildLanguage = bot.getCurrentGuildSetting(interaction.guild, 'language')

	const officialRow = new MessageActionRow()
		.addComponents(
			new MessageButton()
				.setCustomId('official_header')
				.setLabel('Official Mode')
				.setStyle('SECONDARY')
				.setDisabled(true),
			new MessageButton()
				.setCustomId('guild_official_mode')
				.setLabel(guildOfficial ? 'Enabled' : 'Disabled')
				.setStyle(guildOfficial ? 'SUCCESS' : 'DANGER')
		)
	messageRows.push(officialRow)

	const rulingsRow = new MessageActionRow()
		.addComponents(
			new MessageButton()
				.setCustomId('rulings_header')
				.setLabel('Rulings Mode')
				.setStyle('SECONDARY')
				.setDisabled(true),
			new MessageButton()
				.setCustomId('guild_rulings_mode')
				.setLabel(guildRulings ? 'Enabled' : 'Disabled')
				.setStyle(guildRulings ? 'SUCCESS' : 'DANGER')
		)
	messageRows.push(rulingsRow)

	const languageRow = new MessageActionRow()
	const languageSelect = new MessageSelectMenu()
		.setCustomId('guild_language_select')
		.setPlaceholder('Select Language')
	const languageOptions = []
	for (const code in config.languages) {
		languageOptions.push(
			{
				label: `Default Query Language: ${config.languages[code]}`,
				value: code,
				emoji: config.languageEmojis[code],
				default: code === guildLanguage
			}
		)
	}
	languageSelect.addOptions(languageOptions)
	languageRow.addComponents(languageSelect)
	messageRows.push(languageRow)

	return messageRows
}

/**
 * Helper function to generate all the message components (buttons/menus) for controlling
 * channel-specific configuration in response to the /set channel command.
 * @param {MillenniumEyeBot} bot The bot.
 * @param {TextChannel} target The target channel, either currently selected or given explicitly.
 * @param {Boolean} useMenu Whether to generate a channel selection menu. 
 */
async function generateChannelComponents(bot, target, useMenu) {
	const messageRows = []
	// evaluate current channel settings, remembering to take into account server defaults over config's if necessary
	const channelOfficial = bot.getCurrentChannelSetting(target, 'official')
	const channelRulings = bot.getCurrentChannelSetting(target, 'rulings')
	const channelLanguage = bot.getCurrentChannelSetting(target, 'language')

	if (useMenu) {
		const channelRow = new MessageActionRow()
		const channelSelect = new MessageSelectMenu()
			.setCustomId('channel_select')
			.setPlaceholder('Select Channel')
		const channelOptions = []
		target.guild.channels.cache.filter(c => c.isText())
			.each(c => {
				channelOptions.push(
					{
						label: `${c.name}`,
						value: c.id,
						emoji: '<:discord_hashtag:894378007316299816>',
						default: c.id === target.id
					}
				)
			})
		channelSelect.addOptions(channelOptions)
		channelRow.addComponents(channelSelect)
		messageRows.push(channelRow)
	}
	
	const officialRow = new MessageActionRow()
		.addComponents(
			new MessageButton()
				.setCustomId('official_header')
				.setLabel('Official Mode')
				.setStyle('SECONDARY')
				.setDisabled(true),
			new MessageButton()
				.setCustomId('channel_official_mode')
				.setLabel(channelOfficial ? 'Enabled' : 'Disabled')
				.setStyle(channelOfficial ? 'SUCCESS' : 'DANGER')
		)
	messageRows.push(officialRow)

	const rulingsRow = new MessageActionRow()
		.addComponents(
			new MessageButton()
				.setCustomId('rulings_header')
				.setLabel('Rulings Mode')
				.setStyle('SECONDARY')
				.setDisabled(true),
			new MessageButton()
				.setCustomId('channel_rulings_mode')
				.setLabel(channelRulings ? 'Enabled' : 'Disabled')
				.setStyle(channelRulings ? 'SUCCESS' : 'DANGER')
		)
	messageRows.push(rulingsRow)

	const languageRow = new MessageActionRow()
	const languageSelect = new MessageSelectMenu()
		.setCustomId('channel_language_select')
		.setPlaceholder('Select Language')
	const languageOptions = []
	for (const code in config.languages) {
		const isCurrentLanguage = code === channelLanguage
		languageOptions.push(
			{
				label: `Default Query Language: ${config.languages[code]}`,
				value: code,
				emoji: config.languageEmojis[code],
				default: isCurrentLanguage
			}
		)
	}
	languageSelect.addOptions(languageOptions)
	languageRow.addComponents(languageSelect)
	messageRows.push(languageRow)

	return messageRows
}

module.exports = new Command({
	name: 'set',
	description: 'Set configuration items to determine how the bot treats a particular server or channel.',
	permissions: 'MANAGE_GUILD',
	options: {
		name: 'set',
		description: 'Set configuration items to determine how the bot treats a particular server or channel.',
		options: [
			{
				name: 'server',
				description: 'Set server-wide configuration items.',
				type: CommandTypes.SUB_COMMAND
			},
			{
				name: 'channel',
				description: 'Set channel-specific configuration items.',
				type: CommandTypes.SUB_COMMAND,
				options: [
					{
						name: 'target',
						description: 'The target channel. Omitting this option will give a list to choose from.',
						type: CommandTypes.CHANNEL
					}
				]
			},
			{
				name: 'query',
				description: 'Sets a card query type the bot will respond to in this server.',
				type: CommandTypes.SUB_COMMAND,
				options: [
					{
						name: 'open',
						description: 'The symbol(s) indicating the start of a card query, e.g. the \'[\' in \'[card name]\'.',
						type: CommandTypes.STRING,
						required: true
					},
					{
						name: 'close',
						description: 'The symbol(s) indicating the close of a card query, e.g. the \']\' in \'[card name]\'.',
						type: CommandTypes.STRING,
						required: true
					},
					{
						name: 'language',
						description: 'The language code indicating which language card queries using this syntax will be treated as.',
						type: CommandTypes.STRING,
						required: true,
						choices: languageChoices
					}
				]
			}
		]
	},
	execute: async (interaction, bot) => {
		const sc = interaction.options.getSubcommand()
		if (sc === 'server') {
			await interaction.reply({ content: 'Select your desired server configuration options.', components: generateServerComponents(interaction, bot), ephemeral: true })

			const filter = i => {
				return (i.isButton() || i.isSelectMenu()) &&
						/^guild_/.test(i.customId) &&
						i.user.id === i.user.id
			}
			const collector = interaction.channel.createMessageComponentCollector({ 'filter': filter, time: 15000 })

			collector.on('collect', async i => {
				if (i.customId === 'guild_official_mode') {
					const currOfficial = bot.getCurrentGuildSetting(interaction.guild, 'official')
					bot.setGuildSetting(interaction.guild, 'official', !currOfficial)
				}
				else if (i.customId === 'guild_rulings_mode') {
					const currRulings = bot.getCurrentGuildSetting(interaction.guild, 'rulings')
					bot.setGuildSetting(interaction.guild, 'rulings', !currRulings)
				}
				else if (i.customId === 'guild_language_select') {
					const newLanguage = i.values[0]
					bot.setGuildSetting(interaction.guild, 'language', newLanguage)
				}

				await i.update({ content: 'Select your desired server configuration options.', components: generateServerComponents(interaction, bot) })
				collector.resetTimer()
			})

			collector.on('end', async collected => {
				await interaction.editReply({ content: '**No further selections possible.** Current server configuration:', components: generateServerComponents(interaction, bot) })
			})
		}
		else if (sc === 'channel') {
			// determine what channel we're operating on, default to current
			let target = interaction.channel
			let useMenu = true
			// if a channel target was given, make sure it's a text channel
			if (interaction.options.getChannel('target')) {
				target = interaction.guild.channels.cache.get(interaction.options.getChannel('target'))
				if (!target.isText()) {
					throw generateError(
						null,
						'You must give a text channel to modify.'
					)
				}
				// don't render select menu if a channel is explicitly given
				useMenu = false
			}
			else {
				// if no channel target was given, check that the number of text channels is <= 25, 
				// since the maximum number of select menu options is 25
				const channels = interaction.guild.channels.cache.filter(c => c.isText())
				if (channels.size > 25) {
					throw generateError(
						null,
						'This server has more than 25 text channels, so you must give a target channel.'
					)
				}
			}

			await interaction.reply({ content: 'Select your desired channel configuration options.', components: await generateChannelComponents(bot, target, useMenu), ephemeral: true })

			const filter = i => {
				return (i.isButton() || i.isSelectMenu()) &&
						/^channel_/.test(i.customId) &&
						i.user.id === i.user.id
			}
			const collector = interaction.channel.createMessageComponentCollector({ 'filter': filter, time: 15000 })

			collector.on('collect', async i => {
				if (i.customId === 'channel_select') {
					target = interaction.guild.channels.cache.get(i.values[0])
				}
				else if (i.customId === 'channel_official_mode') {
					const currOfficial = bot.getCurrentChannelSetting(target, 'official')
					bot.setChannelSetting(target, 'official', !currOfficial)
				}
				else if (i.customId === 'channel_rulings_mode') {
					const currRulings = bot.getCurrentChannelSetting(target, 'rulings')
					bot.setChannelSetting(target, 'rulings', !currRulings)
				}
				else if (i.customId === 'channel_language_select') {
					const newLanguage = i.values[0]
					bot.setChannelSetting(target, 'language', newLanguage)
				}

				await i.update({ content: 'Select your desired channel configuration options.', components: await generateChannelComponents(bot, target, useMenu) })
				collector.resetTimer()
			})

			collector.on('end', async collected => {
				await interaction.editReply({ content: `**No further selections possible.** Channel configuration for <#${target.id}>:`, components: await generateChannelComponents(bot, target, false) })
			})
		}
		else if (sc === 'query') {
			const qOpen = interaction.options.getString('open', true)
			const qClose = interaction.options.getString('close', true)
			const qLan = interaction.options.getString('language', true)

			// make sure no other languages are using this syntax
			const currQueries = bot.guildSettings.get([interaction.guild.id, 'queries'])
			if (currQueries) {
				for (const lan in currQueries) {
					if (lan !== qLan &&
						currQueries[qLan].open === qOpen &&
						currQueries[qLan].close === qClose)
					{
						throw generateError(
							null,
							`These open/close symbols are already being used for ${config.languages[lan]} card queries. Please either use different symbols, or change the ones used for ${config.languages[lan]} queries.`
						)
					}
				}
			}

			if (qOpen === config.defaultOpen &&
				qClose === config.defaultClose &&
				qLan === config.defaultLanguage)
			{
				// revert to default
				bot.guildSettings.remove([interaction.guild.id, 'queries', config.defaultLanguage])
				bot.guildQueries.remove([interaction.guild.id, config.defaultLanguage])
			}
			else {
				const queryRegex = setupQueryRegex(qOpen, qClose)

				bot.guildSettings.put([interaction.guild.id, 'queries', qLan], { 'open': qOpen, 'close': qClose })
				bot.guildQueries.put([interaction.guild.id, qLan], queryRegex)
			}

			await interaction.reply({ content: `I will now recognize parts of messages between **${qOpen}** and **${qClose}** as **${config.languages[qLan]}** card queries!`, ephemeral: true })
		}
		else {
			throw generateError(
				`Received a non-existent subcommand/option for command ${interaction.commandName}.`,
				`Received a non-existent subcommand/option for command ${interaction.commandName}.`
			)
		}
	}
})