const { ActionRowBuilder, ButtonBuilder, SelectMenuBuilder, CommandInteraction, TextChannel, PermissionFlagsBits } = require('discord.js')

const config = require('config')
const { generateError } = require('lib/utils/logging')
const Command = require('lib/models/Command')
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
 * @param {Boolean} disable Whether to disable the buttons and menus.
 */
function generateServerComponents(interaction, disable = false) {
	const messageRows = []
	const bot = interaction.client
	const guildOfficial = bot.getCurrentGuildSetting(interaction.guild, 'official')
	const guildRulings = bot.getCurrentGuildSetting(interaction.guild, 'rulings')
	const guildLocale = bot.getCurrentGuildSetting(interaction.guild, 'locale')

	const officialRow = new ActionRowBuilder()
		.addComponents(
			new ButtonBuilder()
				.setCustomId(`official_header`)
				.setLabel('Official Mode')
				.setStyle('Secondary')
				.setDisabled(true),
			new ButtonBuilder()
				.setCustomId(`guild_official_mode`)
				.setLabel(guildOfficial ? 'Enabled' : 'Disabled')
				.setStyle(guildOfficial ? 'Success' : 'Danger')
				.setDisabled(disable)
		)
	messageRows.push(officialRow)

	const rulingsRow = new ActionRowBuilder()
		.addComponents(
			new ButtonBuilder()
				.setCustomId('rulings_header')
				.setLabel('Rulings Mode')
				.setStyle('Secondary')
				.setDisabled(true),
			new ButtonBuilder()
				.setCustomId(`guild_rulings_mode`)
				.setLabel(guildRulings ? 'Enabled' : 'Disabled')
				.setStyle(guildRulings ? 'Success' : 'Danger')
				.setDisabled(disable)
		)
	messageRows.push(rulingsRow)

	const localeRow = new ActionRowBuilder()
	const localeSelect = new SelectMenuBuilder()
		.setCustomId(`guild_locale_select`)
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
 * @param {Boolean} disable Whether to disable buttons and menus.
 */
function generateChannelComponents(interaction, target, useMenu, disable = false) {
	const messageRows = []
	const bot = interaction.client
	const channelOfficial = bot.getCurrentChannelSetting(target, 'official')
	const channelRulings = bot.getCurrentChannelSetting(target, 'rulings')
	const channelLocale = bot.getCurrentChannelSetting(target, 'locale')

	if (useMenu) {
		const channelRow = new ActionRowBuilder()
		const channelSelect = new SelectMenuBuilder()
			.setCustomId(`channel_select`)
			.setPlaceholder('Select Channel')
		const channelOptions = []
		interaction.guild.channels.cache.filter(c => c.isTextBased())
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
	
	const officialRow = new ActionRowBuilder()
		.addComponents(
			new ButtonBuilder()
				.setCustomId('official_header')
				.setLabel('Official Mode')
				.setStyle('Secondary')
				.setDisabled(true),
			new ButtonBuilder()
				.setCustomId(`channel_official_mode`)
				.setLabel(channelOfficial ? 'Enabled' : 'Disabled')
				.setStyle(channelOfficial ? 'Success' : 'Danger')
				.setDisabled(disable)
		)
	messageRows.push(officialRow)

	const rulingsRow = new ActionRowBuilder()
		.addComponents(
			new ButtonBuilder()
				.setCustomId('rulings_header')
				.setLabel('Rulings Mode')
				.setStyle('Secondary')
				.setDisabled(true),
			new ButtonBuilder()
				.setCustomId(`channel_rulings_mode`)
				.setLabel(channelRulings ? 'Enabled' : 'Disabled')
				.setStyle(channelRulings ? 'Success' : 'Danger')
				.setDisabled(disable)
		)
	messageRows.push(rulingsRow)

	const localeRow = new ActionRowBuilder()
	const localeSelect = new SelectMenuBuilder()
		.setCustomId(`channel_locale_select`)
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
 */
function generateConfigSelectComponents(selection = undefined) {
	const messageRows = []

	const selectRow = new ActionRowBuilder()
		.addComponents(
			new ButtonBuilder()
				.setCustomId(`guild_print`)
				.setLabel('Server Configuration')
				.setStyle(selection === 'guild' ? 'Success' : 'Secondary'),
			new ButtonBuilder()
				.setCustomId(`channel_print`)
				.setLabel('Channel Configuration')
				.setStyle(selection === 'channel' ? 'Success' : 'Secondary')
		)
	
	messageRows.push(selectRow)
	
	return messageRows
}

module.exports = new Command({
	name: 'config',
	description: 'Set configuration items to determine how the bot treats a particular server or channel.',
	options: {
		name: 'config',
		description: 'Set configuration items to determine how the bot treats a particular server or channel.',
		default_member_permissions: PermissionFlagsBits.ManageGuild,
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
				let resp = `I will now recognize parts of messages between **${qOpen}** and **${qClose}** as **${fullLocale}** queries!`
				// If this overwrote the default query syntax, let them know.
				if (qOpen === config.defaultOpen && qClose === config.defaultClose)
					resp += '\n\n**Note**: This syntax is the same as the one the bot defaults to when it has nothing else to go on. ' +
							`With this change, the bot will only ever treat this syntax as evaluating ${fullLocale} queries. ` +
							'To make use of the default again, you will have to change this locale\'s syntax to something else.'

				await interaction.reply({ content: resp, ephemeral: true })
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
			let configSelection = undefined
			let channelTarget = interaction.channel
			let msgContent = 'Select which configuration to print.'
			const useChannelMenu = interaction.guild.channels.cache.filter(c => c.isTextBased()).size <= 25
			let msgComps = generateConfigSelectComponents()

			const resp = await interaction.reply({ content: msgContent, components: msgComps })
			
			const collector = resp.createMessageComponentCollector({ time: 15000 })

			collector.on('collect', async i => {
				if (i.user.id !== interaction.user.id) {
					i.reply({ content: 'Only the user that originally sent the command can interact with these options.', ephemeral: true })
					return
				}

				// Changing which settings are being shown to be interacted with.
				if (/^guild_print/.test(i.customId)) {
					configSelection = 'guild'
				}
				else if (/^channel_print/.test(i.customId)) {
					configSelection = 'channel'
					msgContent = `**Channel Configuration for <#${channelTarget.id}>:**`
				}
				else if (/^channel_select/.test(i.customId)) {
					channelTarget = await interaction.guild.channels.fetch(i.values[0])
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
					// Gather query syntaxes.
					let queryString = ''
					const defaultSyntax = { open: config.defaultOpen, close: config.defaultClose }
					if (interaction.guild) {
						const guildQueries = bot.getGuildQueries(interaction.guild)
						// Display the default, if available, first.
						if ('default' in guildQueries)
							queryString += `Default (obeys channel/server locale): \`${config.defaultOpen}query contents${config.defaultClose}\`\n` 
						for (const locale in bot.getGuildQueries(interaction.guild)) {
							if (locale === 'default') continue
							let syntax = bot.guildSettings.get([interaction.guild.id, 'queries', locale])
							queryString += `${LocaleEmojis[locale]} ${Locales[locale]}: \`${syntax.open}query contents${syntax.close}\`\n`
						}
					}
					// Just print out the default outside of servers.
					else queryString += `Default (obeys channel/server locale): \`${config.defaultOpen}query contents${config.defaultClose}\`\n`

					if (queryString === '') 
						queryString = '__Query Syntaxes__: none\n'
					else
						queryString = `__Query Syntaxes__\n${queryString}`
					
					msgContent = `**Current Server Configuration:**\n${queryString}`
					msgComps = [...generateServerComponents(interaction), ...generateConfigSelectComponents(configSelection)]
				}
				else {
					msgComps = [...generateChannelComponents(interaction, channelTarget, useChannelMenu), ...generateConfigSelectComponents(configSelection)]
				}
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