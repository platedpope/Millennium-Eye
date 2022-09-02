const { ActionRowBuilder, SelectMenuBuilder } = require('discord.js')

const Command = require('lib/models/Command')
const { CommandTypes } = require('lib/models/Defines')
const Query = require('lib/models/Query')
const Search = require('lib/models/Search')
const { queryRespond, processQuery } = require('handlers/QueryHandler')
const { generateError } = require('lib/utils/logging')

/**
 * Helper function to generate the select menu for which art to display.
 * @param {Number} selectedId The selected art ID.
 * @param {Number} availableArtIds The number of available art IDs.
 * @returns {Array} The array of message rows.
 */
function generateArtSelect(selectedId, availableArtIds, disable = false) {
	const messageRows = []

	const artRow = new ActionRowBuilder()
	const artSelect = new SelectMenuBuilder()
		.setCustomId(`art_id_select`)
		.setPlaceholder('Select Art ID')
		.setDisabled(disable)
	const selectOptions = []
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
		await interaction.deferReply()
		await processQuery(qry)

		const report = Query.generateSearchResolutionReport(qry.searches)
		if (report) {
			// Couldn't resolve this, bail.
			throw generateError(
				`Art command could not find any data for search ${card}. This probably isn't an actual error.`,
				'That search didn\'t find any card to display the art for.'
			)
		}
		
		// Set up all the information beforehand.
		const artSearch = qry.searches[0]
		let viewedArt = 1
		let availableArts = artSearch.data.imageData.size
		const msgOptions = {}
		const embedData = artSearch.data.generateArtEmbed(locale, qry.official, viewedArt)
		if ('embed' in embedData)
			msgOptions.embeds = [embedData.embed]
		if ('attachment' in embedData)
			msgOptions.files = [embedData.attachment]
		
		// Only give + handle an art selection menu if we've got more than one to choose from.
		if (availableArts > 1) {
			msgOptions.components = generateArtSelect(viewedArt, availableArts)

			const resp = await queryRespond(bot, interaction, '', qry, msgOptions)

			const collector = resp.createMessageComponentCollector({ time: 15000 })

			collector.on('collect', async i => {
				if (i.user.id !== interaction.user.id) {
					i.reply({ content: 'Only the user that originally sent the command can interact with these options.', ephemeral: true })
					return
				}

				viewedArt = parseInt(i.values[0], 10)
				const embedData = artSearch.data.generateArtEmbed(locale, qry.official, viewedArt)
				if ('embed' in embedData)
					msgOptions.embeds = [embedData.embed]
				if ('attachment' in embedData)
					msgOptions.files = [embedData.attachment]
				msgOptions.components = generateArtSelect(viewedArt, availableArts)

				await i.message.removeAttachments()
				await i.update(msgOptions)
				collector.resetTimer()
			})

			collector.on('end', async () => {
				msgOptions.components = generateArtSelect(viewedArt, availableArts, true)
				await resp.edit(msgOptions)
			})
		}
		else {
			await queryRespond(bot, interaction, '', qry, msgOptions)
		}
	}
})