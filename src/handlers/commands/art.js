const { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder } = require('discord.js')

const Command = require('lib/models/Command')
const { CommandTypes } = require('lib/models/Defines')
const Query = require('lib/models/Query')
const Search = require('lib/models/Search')
const { queryRespond, processQuery } = require('handlers/QueryHandler')
const { generateError } = require('lib/utils/logging')
const { searchNameToIdIndex } = require('handlers/YGOrgDBHandler')

/**
 * Helper function to generate the select menu for which art to display.
 * @param {Number} selectedId The selected art ID.
 * @param {Number} availableArtIds The number of available art IDs.
 * @returns {Array} The array of message rows.
 */
function generateArtSelect(selectedId, availableArtIds, hasMasterDuelArt, disable = false) {
	const messageRows = []

	const artRow = new ActionRowBuilder()
	const artSelect = new StringSelectMenuBuilder()
		.setCustomId(`art_id_select`)
		.setPlaceholder('Select Art ID')
		.setDisabled(disable)
	const selectOptions = []
	if (hasMasterDuelArt)
		selectOptions.push(
			{
				label: 'Master Duel (High Res)',
				value: 'md',
				default: selectedId === 'md'
			}
		)
	for (let i = 1; i <= availableArtIds; i++)
		selectOptions.push(
			{
				label: `Art ${i}`,
				value: `${i}`,
				default: i === selectedId
			}
		)
	artSelect.addOptions(selectOptions)
	artRow.addComponents(artSelect)
	messageRows.push(artRow)

	const confirmRow = new ActionRowBuilder()
	const confirmButton = new ButtonBuilder()
		.setCustomId('confirm_art_button')
		.setLabel('Post to Chat')
		.setStyle('Success')
		.setDisabled(disable)
	confirmRow.addComponents(confirmButton)
	messageRows.push(confirmRow)

	return messageRows
}

module.exports = new Command({
	name: 'art',
	description: 'Queries all art available for the given card.',
	options: {
		name: 'art',
		description: 'Queries all art available for the given card.',
		options: [
			{
				name: 'card',
				description: 'The card to search for (name or database ID).',
				type: CommandTypes.STRING,
				autocomplete: true,
				required: true
			}
		]
	},
	execute: async (interaction, bot) => {
		let card = interaction.options.getString('card', true)
		// Check for whether this is a database ID, in which case it should be made into an integer.
		const cid = parseInt(card, 10)
		if (!isNaN(cid))
			card = cid
		const locale = bot.getCurrentChannelSetting(interaction.channel, 'locale')
		// Bootstrap a query from this information.
		const qry = new Query([new Search(card, 'a', locale)])
		qry.official = bot.getCurrentChannelSetting(interaction.channel, 'official')
		qry.locale = locale

		// Defer reply in case this query takes a bit.
		// await interaction.deferReply()
		await processQuery(qry)
		
		const artSearch = qry.searches[0]
		if (!artSearch || !artSearch.data) {
			await queryRespond(bot, interaction, 'Could not find any art data with the given search.', qry, { ephemeral: true })
			return
		}

		// Set up all the information beforehand.
		let viewedArt = 1
		const hasMasterDuelArt = artSearch.data.imageData.has('md')
		let availableArts = artSearch.data.imageData.size
		if (hasMasterDuelArt) {
			viewedArt = 'md'
			// Other arts are indexed by ID, so if we have any,
			// subtract the MD art from the available count because it has no ID.
			if (availableArts > 1) 
				availableArts -= 1 
		}
		
		const msgOptions = {}
		const embedData = artSearch.data.generateArtEmbed(locale, qry.official, viewedArt)
		if ('embed' in embedData)
			msgOptions.embeds = [embedData.embed]
		if ('attachment' in embedData)
			msgOptions.files = [embedData.attachment]
		
		// Only give + handle an art selection menu if we've got more than one to choose from.
		if (availableArts > 1) {
			msgOptions.components = generateArtSelect(viewedArt, availableArts, hasMasterDuelArt)
			msgOptions.ephemeral = true

			const resp = await queryRespond(bot, interaction, '', qry, msgOptions)

			let postToChat = false
			const collector = resp.createMessageComponentCollector({ time: 15000 })

			collector.on('collect', async i => {
				if (i.user.id !== interaction.user.id) {
					i.reply({ content: 'Only the user that originally sent the command can interact with these options.', ephemeral: true })
					return
				}

				if (/^art_id_select/.test(i.customId)) {
					viewedArt = parseInt(i.values[0], 10)
					if (isNaN(viewedArt))
						viewedArt = i.values[0]
					const embedData = artSearch.data.generateArtEmbed(locale, qry.official, viewedArt)
					if ('embed' in embedData)
						msgOptions.embeds = [embedData.embed]
					if ('attachment' in embedData)
						msgOptions.files = [embedData.attachment]
					msgOptions.components = generateArtSelect(viewedArt, availableArts, hasMasterDuelArt)

					await i.update(msgOptions)
					collector.resetTimer()
				}
				else if (/^confirm_art_button/.test(i.customId)) {
					msgOptions.components = generateArtSelect(viewedArt, availableArts, hasMasterDuelArt, true)
					i.update(msgOptions)
					postToChat = true
					collector.stop()
				}
			})

			collector.on('end', async () => {
				if (postToChat) {
					delete msgOptions.components
					delete msgOptions.ephemeral
					// The followUp responds to the ephemeral message, making the initial command invocation is "invisible".
					// Add a footer identifying who invoked the command to prevent abuse.
					msgOptions.embeds[0].setFooter({ text: `Requested by: ${interaction.user.username}#${interaction.user.discriminator}`})
					interaction.followUp(msgOptions)
				}
				else {
					msgOptions.components = generateArtSelect(viewedArt, availableArts, hasMasterDuelArt, true)
					interaction.editReply(msgOptions)
				}
			})
		}
		else if (availableArts === 1) {
			await queryRespond(bot, interaction, '', qry, msgOptions)
		}
		else {
			await queryRespond(bot, interaction, 'Could not find any art data with the given search.', qry, { ephemeral: true })
		}
	},
	autocomplete: async (interaction, bot) => {
		const focus = interaction.options.getFocused(true)
		const search = focus.value.toLowerCase()
		const locale = bot.getCurrentChannelSetting(interaction.channel, 'locale')

		const matches = await searchNameToIdIndex(search, [locale], 25, true)

		const options = []
		matches.forEach((score, m) => {
			// Matches return in the form "Name|ID". We need both, name is what we display while ID is what the choice maps to.
			const parseMatch = m.split('|')
			const name = parseMatch[0]
			const id = parseMatch[1]

			options.push({ name: name, value: id })
		})

		await interaction.respond(options)
	}
})