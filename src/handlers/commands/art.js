const { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder } = require('discord.js')

const Command = require('lib/models/Command')
const { CommandTypes } = require('lib/models/Defines')
const Query = require('lib/models/Query')
const Search = require('lib/models/Search')
const { queryRespond, processQuery } = require('handlers/QueryHandler')
const { generateError } = require('lib/utils/logging')
const { searchNameToIdIndex } = require('handlers/YGOrgDBHandler')
const Card = require('lib/models/Card')

/**
 * Helper function to generate the select menu for which art to display.
 * @param {string} selectedSource The selected source.
 * @param {Number} selectedId The selected art ID.
 * @param {Map<string, Map<string, string>>} cardImageData All available card images.
 * @returns {Array} The array of message rows.
 */
function generateArtSelect(selectedSource, selectedId, cardImageData, disable = false) {
	const messageRows = []
	
	let selectOptions = []
	const sourceRow = new ActionRowBuilder()
	const sourceSelect = new StringSelectMenuBuilder()
		.setCustomId(`source_select`)
		.setPlaceholder('Select Source')
		.setDisabled(disable)
	for (const s of cardImageData.keys()) {
		let optionName = s === 'md' ? 'Master Duel (High Res)' : s.toUpperCase()  
		selectOptions.push({
			label: optionName,
			value: s,
			default: s === selectedSource
		})
	}
	sourceSelect.addOptions(selectOptions)
	sourceRow.addComponents(sourceSelect)
	messageRows.push(sourceRow)

	selectOptions = []
	const artRow = new ActionRowBuilder()
	const artSelect = new StringSelectMenuBuilder()
		.setCustomId(`art_id_select`)
		.setPlaceholder('Select Art ID')
		.setDisabled(disable)
	const arts = cardImageData.get(selectedSource)
	for (const id of arts.keys())
		selectOptions.push(
			{
				label: `Art ${id}`,
				value: `${id}`,
				default: id === `${selectedId}`
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

		/** @type {Card} */
		const cardData = artSearch.data

		// Set up all the information beforehand.
		let viewedArt = 1
		// Pick a default source in rder of priority: md -> tcg -> ocg
		let srcIdx = 0
		const testSources = ['md', 'tcg', 'ocg']
		do {
			var viewedSource = testSources[srcIdx]
			srcArts = cardData.imageData.get(viewedSource)
			srcIdx++
		} while (!srcArts && srcIdx < testSources.length)
		
		// If we got here and still don't have any source arts, then we've got nothing.
		if (!srcArts) {
			await queryRespond(bot, interaction, 'Could not find any art data with the given search.', qry, { ephemeral: true })
			return
		}
		
		const msgOptions = {}
		const embedData = cardData.generateArtEmbed(locale, qry.official, viewedSource, viewedArt)
		if ('embed' in embedData)
			msgOptions.embeds = [embedData.embed]
		if ('attachment' in embedData)
			msgOptions.files = [embedData.attachment]

		msgOptions.components = generateArtSelect(viewedSource, viewedArt, cardData.imageData)
		msgOptions.ephemeral = true

		const resp = await queryRespond(bot, interaction, '', qry, msgOptions)

		let postToChat = false
		const collector = resp.createMessageComponentCollector({ time: 15000 })

		collector.on('collect', async i => {
			if (i.user.id !== interaction.user.id) {
				i.reply({ content: 'Only the user that originally sent the command can interact with these options.', ephemeral: true })
				return
			}

			if (/^source_select/.test(i.customId)) {
				viewedSource = i.values[0]
				// Reset selected ID if source was changed so it's not an invalid number for the new source.
				if (Number(viewedArt) > cardData.imageData.get(viewedSource).size) viewedArt = 1

				const embedData = cardData.generateArtEmbed(locale, qry.official, viewedSource, viewedArt)
				if ('embed' in embedData)
					msgOptions.embeds = [embedData.embed]
				if ('attachment' in embedData)
					msgOptions.files = [embedData.attachment]
				msgOptions.components = generateArtSelect(viewedSource, viewedArt, cardData.imageData)

				await i.update(msgOptions)
				collector.resetTimer()
			}
			else if (/^art_id_select/.test(i.customId)) {
				viewedArt = parseInt(i.values[0], 10)
				if (isNaN(viewedArt))
					viewedArt = i.values[0]
				const embedData = cardData.generateArtEmbed(locale, qry.official, viewedSource, viewedArt)
				if ('embed' in embedData)
					msgOptions.embeds = [embedData.embed]
				if ('attachment' in embedData)
					msgOptions.files = [embedData.attachment]
				msgOptions.components = generateArtSelect(viewedSource, viewedArt, cardData.imageData)

				await i.update(msgOptions)
				collector.resetTimer()
			}
			else if (/^confirm_art_button/.test(i.customId)) {
				msgOptions.components = generateArtSelect(viewedSource, viewedArt, cardData.imageData, true)
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
				msgOptions.embeds[0].setFooter({ text: `Requested by: ${interaction.user.username}`})
				interaction.followUp(msgOptions)
			}
			else {
				msgOptions.components = generateArtSelect(viewedSource, viewedArt, cardData.imageData, true)
				interaction.editReply(msgOptions)
			}
		})
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