const { MessageActionRow, MessageSelectMenu } = require('discord.js')
const { processQuery, queryRespond } = require('handlers/QueryHandler')
const { searchNameToIdIndex } = require('handlers/YGOrgDBHandler')
const Command = require('lib/models/Command')
const { CommandTypes } = require('lib/models/Defines')
const Query = require('lib/models/Query')
const Search = require('lib/models/Search')
const { logger, generateError, logError } = require('lib/utils/logging')

/**
 * Helper function to generate the select menu for which card info to display.
 * @param {Number} selectedMatch The index of the currently selected match in the availableMatches array.
 * @param {Array<Search>} availableMatches The array of available matched Searches.
 * @param {String} locale The locale these were searched in.
 * @param {Number} interactionSeed Seed value for the interaction's custom ID, to deconflict with other interactions.
 * @returns {Array<MessageActionRow>} The array of message rows.
 */
function generateMatchSelect(selectedMatch, availableMatches, locale, interactionSeed) {
	const messageRows = []

	const matchRow = new MessageActionRow()
	const matchSelect = new MessageSelectMenu()
		.setCustomId(`match_id_select_${interactionSeed}`)
		.setPlaceholder('Select Card Name')
	const selectOptions = []
	for (let i = 0; i < availableMatches.length; i++) {
		const matchSearch = availableMatches[i]
		selectOptions.push(
			{
				label: `${i+1}. ${matchSearch.data.name.get(locale)}`,
				value: `${i}`,
				default: i === selectedMatch
			}
		)
	}
	matchSelect.addOptions(selectOptions)
	matchRow.addComponents(matchSelect)
	messageRows.push(matchRow)

	return messageRows
}

module.exports = new Command({
	name: 'match',
	description: 'Lists the best matches for a given search term.',
	options: {
		name: 'match',
		description: 'Lists the best matches for a given search term.',
		options: [
			{
				name: 'term',
				description: 'The term to match.',
				type: CommandTypes.STRING,
				required: true
			},
			{
				name: 'type',
				description: 'The type of data this term should match.',
				type: CommandTypes.STRING,
				required: true,
				choices: [
					{ name: 'Card Name', value: 'name' },
					{ name: 'Card Text', value: 'text' }
				]
			}
		]
	},
	execute: async (interaction, bot) => {
		let term = interaction.options.getString('term', true)
		const matchType = interaction.options.getString('type', true)
		const locale = bot.getCurrentChannelSetting(interaction.channel, 'locale')
		const rulings = bot.getCurrentChannelSetting(interaction.channel, 'rulings')
		const official = bot.getCurrentChannelSetting(interaction.channel, 'official')
		// 25 is the maximum number of matches a Discord select menu can contain.
		const maxMatches = 25

		let qry = undefined
		const resolvedMatchSearches = []

		if (matchType === 'name') {
			const matches = searchNameToIdIndex(term, [locale], maxMatches)
			const matchSearches = []
			// Bootstrap searches from these matches.
			for (const [id, score] of matches)
				if (score < 0.5) 
					// Only include matches with scores above .5, once we get less than that it's a crapshoot.	
					matches.delete(id)
				else
					matchSearches.push(new Search(parseInt(id, 10), rulings ? 'r' : 'i', locale))
			if (matchSearches.length) {
				// Defer reply for now in case this query takes a while.
				await interaction.deferReply()
				// Now bootstrap a query from these searches.
				qry = new Query(matchSearches)
				qry.rulings = rulings
				qry.official = official
				qry.locale = locale

				await processQuery(qry)

				// Don't include searches that were unresolved (for whatever reason) in our final select menu.
				const resolvedMatches = qry.searches.filter(s => s.isDataFullyResolved())
				resolvedMatchSearches.push(...resolvedMatches)
			}
		}
		else {
			// Text matching. Not implemented yet.
		}

		// Finished resolving matches, time to prompt the user.
		if (!resolvedMatchSearches.length) {
			// Somehow didn't resolve any of our matches, bail.
			throw generateError(
				`Match command could not find a ${type} match for term ${term}. This probably isn't an actual error.`,
				'That term could not be matched with anything.'
			)
		}
		
		const msgOptions = {}
		const seed = Math.floor(Math.random() * 1000)
		
		let selectedMatch = null
		msgOptions.components = generateMatchSelect(selectedMatch, resolvedMatchSearches, locale, seed)
		await queryRespond(bot, interaction, '', qry, msgOptions)

		const filter = i => {
			return i.isSelectMenu() &&
				   i.user.id === interaction.user.id &&
				   new RegExp(`match_id_select_${seed}`).test(i.customId)
		}
		const collector = interaction.channel.createMessageComponentCollector({ 'filter': filter, time: 15000 })

		collector.on('collect', async i => {
			selectedMatch = parseInt(i.values[0], 10)
			const selectedSearch = resolvedMatchSearches[selectedMatch]
			const embedData = selectedSearch.data.generateInfoEmbed(locale, rulings, official)
			if ('embed' in embedData)
				msgOptions.embeds = [embedData.embed]
			if ('attachment' in embedData)
				msgOptions.files = [embedData.attachment]
			msgOptions.components = generateMatchSelect(selectedMatch, resolvedMatchSearches, locale, seed)

			await i.message.removeAttachments()
			await i.update(msgOptions)
			collector.resetTimer()
		})
	}
})