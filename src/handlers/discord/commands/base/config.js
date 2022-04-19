const { MessageActionRow, MessageButton, MessageSelectMenu, CommandInteraction, TextChannel } = require('discord.js')

const config = require('config')
const { generateError } = require('lib/utils/logging')
const Command = require('lib/models/Command')
const { MillenniumEyeBot } = require('lib/models/MillenniumEyeBot')
const { CommandTypes, Locales, LocaleEmojis } = require('lib/models/Defines')

// convert available locales to an array of choices that can be parsed by slash commands
const localeChoices = []
for (const code in Locales) {
	localeChoices.push({
		'name': Locales[code],
		'value': code
	})
}

/**
 * Helper function to generate all the message components (buttons/menus) for controlling
 * server-specific configuration in response to the /set server command.
 * @param {CommandInteraction} interaction The interaction associated with the command.
 * @param {Number} interactionSeed Seed value for the interaction's custom ID, to deconflict with other interactions.
 * @param {Boolean} disable Whether to disable the buttons and menus.
 */
function generateServerComponents(interaction, interactionSeed, disable = false) {
	const messageRows = []
	const bot = interaction.client
	const guildOfficial = bot.getCurrentGuildSetting(interaction.guild, 'official')
	const guildRulings = bot.getCurrentGuildSetting(interaction.guild, 'rulings')
	const guildLocale = bot.getCurrentGuildSetting(interaction.guild, 'locale')

	const officialRow = new MessageActionRow()
		.addComponents(
			new MessageButton()
				.setCustomId(`official_header`)
				.setLabel('Official Mode')
				.setStyle('SECONDARY')
				.setDisabled(true),
			new MessageButton()
				.setCustomId(`guild_official_mode_${interactionSeed}`)
				.setLabel(guildOfficial ? 'Enabled' : 'Disabled')
				.setStyle(guildOfficial ? 'SUCCESS' : 'DANGER')
				.setDisabled(disable)
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
				.setCustomId(`guild_rulings_mode_${interactionSeed}`)
				.setLabel(guildRulings ? 'Enabled' : 'Disabled')
				.setStyle(guildRulings ? 'SUCCESS' : 'DANGER')
				.setDisabled(disable)
		)
	messageRows.push(rulingsRow)

	const localeRow = new MessageActionRow()
	const localeSelect = new MessageSelectMenu()
		.setCustomId(`guild_locale_select_${interactionSeed}`)
		.setPlaceholder('Select Locale')
		.setDisabled(disable)
	const localeOptions = []
	for (const code in Locales) {
		localeOptions.push(
			{
				label: `Default Query Locale: ${Locales[code]}`,
				value: code,
				emoji: LocaleEmojis[code],
				default: code === guildLocale
			}
		)
	}
	localeSelect.addOptions(localeOptions)
	localeRow.addComponents(localeSelect)
	messageRows.push(localeRow)

	return messageRows
}

/**
 * Helper function to generate all the message components (buttons/menus) for controlling
 * channel-specific configuration in response to the /set channel command.
 * @param {TextChannel} target The target channel, either currently selected or given explicitly.
 * @param {Boolean} useMenu Whether to generate a channel selection menu. 
 * @param {Number} interactionSeed Seed value for the interaction's custom ID, to deconflict with other interactions.
 * @param {Boolean} disable Whether to disable buttons and menus.
 */
function generateChannelComponents(interaction, target, useMenu, interactionSeed, disable = false) {
	const messageRows = []
	const bot = interaction.client
	const channelOfficial = bot.getCurrentChannelSetting(target, 'official')
	const channelRulings = bot.getCurrentChannelSetting(target, 'rulings')
	const channelLocale = bot.getCurrentChannelSetting(target, 'locale')

	if (useMenu) {
		const channelRow = new MessageActionRow()
		const channelSelect = new MessageSelectMenu()
			.setCustomId(`channel_select_${interactionSeed}`)
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
				.setCustomId(`channel_official_mode_${interactionSeed}`)
				.setLabel(channelOfficial ? 'Enabled' : 'Disabled')
				.setStyle(channelOfficial ? 'SUCCESS' : 'DANGER')
				.setDisabled(disable)
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
				.setCustomId(`channel_rulings_mode_${interactionSeed}`)
				.setLabel(channelRulings ? 'Enabled' : 'Disabled')
				.setStyle(channelRulings ? 'SUCCESS' : 'DANGER')
				.setDisabled(disable)
		)
	messageRows.push(rulingsRow)

	const localeRow = new MessageActionRow()
	const localeSelect = new MessageSelectMenu()
		.setCustomId(`channel_locale_select_${interactionSeed}`)
		.setPlaceholder('Select Locale')
		.setDisabled(disable)
	const localeOptions = []
	for (const code in Locales) {
		const isCurrentLocale = code === channelLocale
		localeOptions.push(
			{
				label: `Default Query Locale: ${Locales[code]}`,
				value: code,
				emoji: LocaleEmojis[code],
				default: isCurrentLocale
			}
		)
	}
	localeSelect.addOptions(localeOptions)
	localeRow.addComponents(localeSelect)
	messageRows.push(localeRow)

	return messageRows
}

/**
 * Helper function to generate the interactive buttons for the "print" command.
 * @param {String} selection The currently selected configuration to print (channel or server).
 * @param {Number} interactionSeed Seed value for the interaction's custom ID, to deconflict with other interactions.
 */
function generateConfigSelectComponents(interactionSeed, selection = undefined) {
	const messageRows = []

	const selectRow = new MessageActionRow()
		.addComponents(
			new MessageButton()
				.setCustomId(`guild_print_${interactionSeed}`)
				.setLabel('Server Configuration')
				.setStyle(selection === 'guild' ? 'SUCCESS' : 'SECONDARY'),
			new MessageButton()
				.setCustomId(`channel_print_${interactionSeed}`)
				.setLabel('Channel Configuration')
				.setStyle(selection === 'channel' ? 'SUCCESS' : 'SECONDARY')
		)
	
	messageRows.push(selectRow)
	
	return messageRows
}

module.exports = new Command({
	name: 'config',
	description: 'Set configuration items to determine how the bot treats a particular server or channel.',
	permissions: 'MANAGE_GUILD',
	options: {
		name: 'config',
		description: 'Set configuration items to determine how the bot treats a particular server or channel.',
		options: [
			{
				name: 'settings',
				description: 'Print, toggle, and change server or channel configuration items.',
				type: CommandTypes.SUB_COMMAND
			},
			{
				name: 'query',
				description: 'Sets a card query type the bot will respond to in this server.',
				type: CommandTypes.SUB_COMMAND_GROUP,
				options: [
					{
						name: 'add',
						description: 'Add new symbols and an associated locale to recognize as a card query.',
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
								name: 'locale',
								description: 'The locale code indicating which locale card queries using this syntax will be treated as.',
								type: CommandTypes.STRING,
								required: true,
								choices: localeChoices
							}
						]
					},
					{
						name: 'remove',
						description: 'Remove the symbols associated with a given locale.',
						type: CommandTypes.SUB_COMMAND,
						options: [
							{
								name: 'locale',
								description: 'The locale associated with the query syntax you want to remove.',
								type: CommandTypes.STRING,
								required: true,
								choices: localeChoices
							}
						]
					}
				]
			}
		]
	},
	execute: async (interaction, bot) => {
		const scg = interaction.options.getSubcommandGroup(false)
		const sc = interaction.options.getSubcommand()
		
		if (scg === 'query') {
			if (!interaction.guild)
				throw generateError(null, 'This command can only be used within a server.')

			if (sc === 'add') {
				const qOpen = interaction.options.getString('open', true)
				const qClose = interaction.options.getString('close', true)
				const qLocale = interaction.options.getString('locale', true)
				const fullLocale = Locales[qLocale]
				
				bot.setGuildQuery(interaction.guild, qOpen, qClose, qLocale)

				await interaction.reply({ content: `I will now recognize parts of messages between **${qOpen}** and **${qClose}** as **${fullLocale}** queries!`, ephemeral: true })
			}
			else if (sc === 'remove') {
				const rLocale = interaction.options.getString('locale', true)
				const fullLocale = Locales[rLocale]

				const removed = bot.removeGuildQuery(interaction.guild, rLocale)
				if (removed) 
					await interaction.reply({ content: `I will no longer recognize parts of messages between **${removed.open}** and **${removed.close}** as ${fullLocale} queries.`, ephemeral: true })
				else
					await interaction.reply({ content: `Could not find any existing query syntax associated with ${fullLocale} queries, no changes were made.`, ephemeral: true })
			}
		}
		else if (sc === 'settings') {
			const seed = Math.floor(Math.random() * 1000)

			let configSelection = undefined
			let channelTarget = interaction.channel
			let msgContent = 'Select which configuration to print.'
			const useChannelMenu = interaction.guild.channels.cache.filter(c => c.isText()).size <= 25
			let msgComps = generateConfigSelectComponents(seed)

			await interaction.reply({ content: msgContent, components: msgComps })

			const filter = i => {
				return (i.isButton() || i.isSelectMenu()) &&
						i.user.id === interaction.user.id &&
						(new RegExp(`^channel_\\D+?_${seed}`).test(i.customId) ||
						 new RegExp(`^guild_\\D+?_${seed}`).test(i.customId))
			}
			const collector = interaction.channel.createMessageComponentCollector({ 'filter': filter, time: 15000 })

			collector.on('collect', async i => {
				// Changing which settings are being shown to be interacted with.
				if (/^guild_print/.test(i.customId)) {
					configSelection = 'guild'
				}
				else if (/^channel_print/.test(i.customId)) {
					configSelection = 'channel'
					msgContent = `**Channel Configuration for <#${channelTarget.id}>:**`
				}
				else if (/^channel_select/.test(i.customId)) {
					channelTarget = interaction.guild.channels.cache.get(i.values[0])
					msgContent = `**Channel Configuration for <#${channelTarget.id}>:**`
				}
				// Setting server-related configuration.
				else if (/^guild_official_mode/.test(i.customId)) {
					const currOfficial = bot.getCurrentGuildSetting(interaction.guild, 'official')
					bot.setGuildSetting(interaction.guild, 'official', !currOfficial)
				}
				else if (/^guild_rulings_mode/.test(i.customId)) {
					const currRulings = bot.getCurrentGuildSetting(interaction.guild, 'rulings')
					bot.setGuildSetting(interaction.guild, 'rulings', !currRulings)
				}
				else if (/^guild_locale_select/.test(i.customId)) {
					const newLocale = i.values[0]
					bot.setGuildSetting(interaction.guild, 'locale', newLocale)
				}
				// Setting channel-related configuration.
				else if (/^channel_official_mode/.test(i.customId)) {
					const currOfficial = bot.getCurrentChannelSetting(channelTarget, 'official')
					bot.setChannelSetting(channelTarget, 'official', !currOfficial)
				}
				else if (/^channel_rulings_mode/.test(i.customId)) {
					const currRulings = bot.getCurrentChannelSetting(channelTarget, 'rulings')
					bot.setChannelSetting(channelTarget, 'rulings', !currRulings)
				}
				else if (/^channel_locale_select/.test(i.customId)) {
					const newLocale = i.values[0]
					bot.setChannelSetting(channelTarget, 'locale', newLocale)
				}

				if (configSelection === 'guild') {
					// gather query syntaxes
					let queryString = ''
					const defaultSyntax = { open: config.defaultOpen, close: config.defaultClose }
					if (interaction.guild)
						for (const locale in bot.getGuildQueries(interaction.guild)) {
							let syntax = bot.guildSettings.get([interaction.guild.id, 'queries', locale])
							// if this locale is in guildQueries but not in guildSettings, it was the default addition
							if (!syntax)
								syntax = defaultSyntax

							queryString += `${LocaleEmojis[locale]} ${Locales[locale]}: \`${syntax.open}query contents${syntax.close}\`\n`
						}
					// just print out the default outside of servers
					else queryString += `${LocaleEmojis[config.defaultLocale]} ${Locales[config.defaultLocale]}: \`${defaultSyntax.open}query contents${defaultSyntax.close}\`\n`

					if (queryString === '') 
						queryString = '__Query Syntaxes__: none\n'
					else
						queryString = `__Query Syntaxes__\n${queryString}`
					
					msgContent = `**Current Server Configuration:**\n${queryString}`
					msgComps = [...generateServerComponents(interaction, seed), ...generateConfigSelectComponents(seed, configSelection)]
				}
				else
					msgComps = [...generateChannelComponents(interaction, channelTarget, useChannelMenu, seed), ...generateConfigSelectComponents(seed, configSelection)]

				await i.update({ content: msgContent, components: msgComps })
				collector.resetTimer()
			})

			collector.on('end', async () => {
				return
			})
		}
		else
			throw generateError(
				`Received a non-existent subcommand/option for command ${interaction.commandName}.`,
				`Received a non-existent subcommand/option for command ${interaction.commandName}.`
			)
	}
})