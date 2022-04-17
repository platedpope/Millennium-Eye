const { MessageActionRow, MessageSelectMenu } = require('discord.js')

const Command = require('lib/models/Command')
const { CommandTypes } = require('lib/models/Defines')
const Query = require('lib/models/Query')
const Search = require('lib/models/Search')
const { sendReply, processQuery } = require('handlers/QueryHandler')

/**
 * Helper function to generate the select menu for which art to display.
 * @param {Number} selectedId The selected art ID.
 * @param {Number} availableArtIds The number of available art IDs.
 * @param {Number} interactionSeed Seed value for the interaction's custom ID, to deconflict with other interactions.
 * @returns {Array} The array of message rows.
 */
function generateArtSelect(selectedId, availableArtIds, interactionSeed) {
	const messageRows = []

	const artRow = new MessageActionRow()
	const artSelect = new MessageSelectMenu()
		.setCustomId(`art_id_select_${interactionSeed}`)
		.setPlaceholder('Select Art ID')
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

		await interaction.channel.sendTyping()

		await processQuery(qry)

		const report = Query.generateSearchResolutionReport(qry.searches)
		if (report) {
			// Couldn't resolve this, bail.
			await sendReply(bot, interaction, report, null, {})
			return
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
			const seed = Math.random() * 1000
			msgOptions.components = generateArtSelect(viewedArt, availableArts, seed)

			await interaction.reply(msgOptions)

			const filter = i => {
				return i.isSelectMenu() && 
					   i.user.id === interaction.user.id &&
					   new RegExp(`art_id_select_${seed}`).test(i.customId)
			}
			const collector = interaction.channel.createMessageComponentCollector({ 'filter': filter, time: 15000 })

			collector.on('collect', async i => {
				viewedArt = parseInt(i.values[0], 10)
				const embedData = artSearch.data.generateArtEmbed(locale, qry.official, viewedArt)
				if ('embed' in embedData)
					msgOptions.embeds = [embedData.embed]
				if ('attachment' in embedData)
					msgOptions.files = [embedData.attachment]
				msgOptions.components = generateArtSelect(viewedArt, availableArts, seed)

				await i.message.removeAttachments()
				reply = await i.update(msgOptions)
				collector.resetTimer()
			})
		}
		else {
			await interaction.reply(msgOptions)
		}
	}
})