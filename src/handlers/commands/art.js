const { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder } = require('discord.js')

const Command = require('lib/models/Command')
const { CommandTypes } = require('lib/models/Defines')
const Query = require('lib/models/Query')
const Search = require('lib/models/Search')
const { queryRespond, processQuery } = require('handlers/QueryHandler')
const { generateError } = require('lib/utils/logging')
const { searchNameToIdIndex } = require('handlers/YGOResourcesHandler')
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

async function bootstrapQuery(contents, locale, official) {
	// Check for whether this is a database ID, in which case it should be made into an integer.
	// Unless the card search is "7", which is also a card name. God dammit.
	const cid = parseInt(contents, 10)
	if (!isNaN(cid) && contents !== '7')
		contents = cid
	// Bootstrap a query from this information.
	const qry = new Query([new Search(contents, 'a', locale)])
	qry.locale = locale
	qry.official = official

	// Defer reply in case this query takes a bit.
	// await interaction.deferReply()
	await processQuery(qry)

	return qry
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
				description: 'The card to search for, given by name or database ID.',
				type: CommandTypes.STRING,
				autocomplete: true,
				required: true
			},
			{
				name: 'source',
				description: 'Card art source. Defaults based on availability following Master Duel > TCG > OCG priority.',
				type: CommandTypes.STRING,
				autocomplete: true
			},
			{
				name: 'art',
				description: 'Art number. 1 is primary and 2+ are alternate arts in any order.',
				type: CommandTypes.STRING,
				autocomplete: true
			}
		]
	},
	execute: async (interaction, bot) => {
		const card = interaction.options.getString('card')
		let givenSource = interaction.options.getString('source')
		let givenArt = interaction.options.getString('art')
		const locale = bot.getCurrentChannelSetting(interaction.channel, 'locale')
		const official = bot.getCurrentChannelSetting(interaction.channel, 'official')

		const qry = await bootstrapQuery(card, locale, official)
		
		const artSearch = qry.searches[0]
		if (!artSearch || !artSearch.data) {
			await queryRespond(bot, interaction, 'Could not find any art data with the given search.', qry, { ephemeral: true })
			return
		}

		/** @type {Card} */
		const cardData = artSearch.data
		const msgOptions = {}
		let embedData = {}

		let viewedSource = givenSource
		let viewedArt = givenArt
		// Art can come in as (e.g.) "md|2", which can be split into both a source and art ID.
		if (viewedArt && viewedArt.includes('|')) {
			[viewedSource, viewedArt] = viewedArt.split('|')
		}
		let srcArts = new Map()

		// Sanity check that if we were given both a source and art ID, they're not nonsense. Return an error if they are.
		if (viewedSource && viewedArt) {
			if (!(cardData.imageData.get(viewedSource)) ||
					!(cardData.imageData.get(viewedSource).get(viewedArt))) 
			{
				await queryRespond(bot, interaction, 'Could not find any art data with the given search.', qry, { ephemeral: true })
				return
			}

			// If we got here, then the given source and art ID are good, and we can just generate an embed and send it.
			embedData = cardData.generateArtEmbed(locale, official, viewedSource, viewedArt)
			if ('embed' in embedData)
				msgOptions.embeds = [embedData.embed]
			if ('attachment' in embedData)
				msgOptions.files = [embedData.attachment]

			await queryRespond(bot, interaction, '', qry, msgOptions)
			return
		}

		// Set sensible defaults to start with if we weren't given the full picture.
		if (!(cardData.imageData.get(viewedSource))) {
			let srcIdx = 0
			const testSources = ['md', 'tcg', 'ocg']
			do {
				viewedSource = testSources[srcIdx]
				srcArts = cardData.imageData.get(viewedSource)
				srcIdx++
			} while (!srcArts && srcIdx < testSources.length)
		}
		// If we didn't find a single good source here, then we've got nothing.
		if (!srcArts) {
			await queryRespond(bot, interaction, 'Could not find any art data with the given search.', qry, { ephemeral: true })
			return
		}
		// Sensible default art is just ID 1, which should always exist.
		if (!(cardData.imageData.get(viewedSource).get(viewedArt))) {
			viewedArt = 1
		}
		
		embedData = cardData.generateArtEmbed(locale, qry.official, viewedSource, viewedArt)
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
				// Add a line indicating who requested the embed to prevent abuse.
				msgOptions.embeds[0].setDescription(`Requested by: <@${interaction.user.id}>`)
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

		if (focus.name === 'card') {
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
		else if (focus.name === 'source') {
			// If a card has been given in the card search field, then resolve it to data and present the options available for art source.
			const card = interaction.options.getString('card')
			if (!card) return 
			
			const locale = bot.getCurrentChannelSetting(interaction.channel, 'locale')
			const official = bot.getCurrentChannelSetting(interaction.channel, 'official')
			const qry = await bootstrapQuery(card, locale, official)
			const artSearch = qry.searches[0]
			if (!artSearch || !artSearch.data) return

			/** @type {Card} */
			const cardData = artSearch.data


			const totalSources = [
				{ name: 'TCG', value: 'tcg' },
				{ name: 'OCG', value: 'ocg' },
				{ name: 'Master Duel (High Res)', value: 'md' }
			]
			const availSources = []

			for (const s of totalSources) {
				if (cardData.imageData.get(s['value'])) {
					availSources.push(s)
				}
			}

			await interaction.respond(availSources)
		}
		else if (focus.name === 'art') {
			// If a card has been given in the card search field, then resolve it to data and present the options available for art source.
			const card = interaction.options.getString('card')
			let source = interaction.options.getString('source')
			if (!card) return

			const locale = bot.getCurrentChannelSetting(interaction.channel, 'locale')
			const official = bot.getCurrentChannelSetting(interaction.channel, 'official')
			const qry = await bootstrapQuery(card, locale, official)
			const artSearch = qry.searches[0]
			if (!artSearch || !artSearch.data) return

			/** @type {Card} */
			const cardData = artSearch.data

			const artOptions = []
			if (source && cardData.imageData.get(source)) {
				cardData.imageData.get(source).forEach((path, aid) => {
					artOptions.push({ name: `Art ${aid}`, value: aid })
				})
			}
			// If no (good) source is given, combine all the ones we can find!
			else {
				const possibleSources = ['md', 'tcg', 'ocg']
				for (const s of possibleSources) {
					const availArts = cardData.imageData.get(s)
					if (availArts) {
						availArts.forEach((path, aid) => {
							if (s === 'md') {
								artOptions.push({ name: `Master Duel Art ${aid}`, value: `md|${aid}` })
							}
							else if (s === 'tcg') {
								artOptions.push({ name: `TCG Art ${aid}`, value: `tcg|${aid}`})
							}
							else if (s === 'ocg') {
								artOptions.push({ name: `OCG Art ${aid}`, value: `ocg|${aid}` })
							}
						})
					}
				}
			}

			// Make sure this doesn't go over 25, which is the max number of options supported by Discord autocomplete.
			if (artOptions.length > 25) {
				artOptions.length = 25
			}

			await interaction.respond(artOptions)
		}
	}
})