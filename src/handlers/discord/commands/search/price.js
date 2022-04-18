const Command = require('lib/models/Command')
const { CommandTypes } = require('lib/models/Defines')
const Query = require('lib/models/Query')
const Search = require('lib/models/Search')
const { processQuery, queryRespond } = require('handlers/QueryHandler')
const { generateError } = require('lib/utils/logging')

module.exports = new Command({
	name: 'price',
	description: 'Searches price data for a card or set.',
	options: {
		name: 'price',
		description: 'Searches price data for a card or set.',
		options: [
			{
				name: 'search',
				description: 'The set or card name to search for.',
				type: CommandTypes.STRING,
				required: true,
			},
			{
				name: 'rarity',
				description: 'Filter price data to prints of the given rarity.',
				type: CommandTypes.STRING,
				choices: [
					// These are unfortunately hardcoded instead of ripped from the TCGPlayer API
					// since TCGPlayer rarities are a mess and there are a lot I don't want to offer as options.
					{ name: 'Common', value: 'Common' },
					{ name: 'Rare', value: 'Rare' },
					{ name: 'Super Rare', value: 'Super' },
					{ name: 'Ultra Rare', value: 'Ultra' },
					{ name: 'Secret Rare', value: 'Secret' },
					{ name: 'Prismatic Secret Rare', value: 'Prismatic Secret' },
					{ name: 'Ultimate Rare', value: 'Ultimate' },
					{ name: 'Ghost Rare', value: 'Ghost' },
					{ name: 'Gold Rare', value: 'Gold' },
					{ name: 'Collector\'s Rare', value: 'Collector\'s' },
					{ name: 'Starlight Rare', value: 'Starlight' }
				]
			},
			{
				name: 'sort',
				description: 'Change how prices are ordered.',
				type: CommandTypes.STRING,
				choices: [
					{ name: 'Ascending (least expensive first)', value: 'asc' },
					{ name: 'Descending (most expensive first)', value: 'desc' }
				]
			}
		]
	},
	execute: async (interaction, bot) => {
		let search = interaction.options.getString('search', true)
		const rarity = interaction.options.getString('rarity', false)
		const sort = interaction.options.getString('sort', false)
		// Check for whether this is a database ID, in which case it should be made into an integer.
		const cid = parseInt(search, 10)
		if (!isNaN(cid))
			search = cid
		const locale = bot.getCurrentChannelSetting(interaction.channel, 'locale')
		// Bootstrap a query from this information.
		const qry = new Query([new Search(search, '$', locale)])
		qry.official = bot.getCurrentChannelSetting(interaction.channel, 'official')
		qry.locale = locale

		// Defer reply in case this query takes a bit.
		await interaction.deferReply()
		await processQuery(qry)

		const report = Query.generateSearchResolutionReport(qry.searches)
		if (report) {
			throw generateError(
				`Price command could not find any data for search ${search}. This probably isn't an actual error.`,
				'That search didn\'t find any card to display the price for.'
			)
		}

		const priceSearch = qry.searches[0]
		const priceFilters = {}
		if (rarity)
			priceFilters.rarity = rarity
		if (sort)
			priceFilters.sort = sort
		
		const embedData = priceSearch.data.generatePriceEmbed(locale, qry.official, priceFilters)

		const msgOptions = {}
		if ('embed' in embedData)
			msgOptions.embeds = [embedData.embed]
		else {
			await interaction.reply( { content: 'Could not find any price data with the given search and filter(s).', ephemeral: true } )
			return
		}
		
		await queryRespond(bot, interaction, '', qry, msgOptions)
	}
})