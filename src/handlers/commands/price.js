const { SlashCommandBuilder } = require('discord.js')

const Query = require('lib/models/Query')
const Search = require('lib/models/Search')
const { processQuery, queryRespond } = require('handlers/QueryHandler')
const { searchNameToIdIndex } = require('handlers/YGOResourcesHandler')

module.exports = {
	data: new SlashCommandBuilder()
		.setName('price')
		.setDescription('Searches price data for a card or set.')
		.addStringOption(op => 
			op.setName('search')
				.setDescription('The set or card name to search for.')
				.setRequired(true)
				.setAutocomplete(true)
		)
		.addStringOption(op =>
			op.setName('rarity')
				.setDescription('Filter price data to prints of the given rarity.')
				.setChoices([
					// These are unfortunately hardcoded instead of ripped from the TCGPlayer API
					// since TCGPlayer rarities are a mess and there are a lot I don't want to offer as options.
					{ name: 'Common', value: 'Common' },
					{ name: 'Rare', value: 'Rare' },
					{ name: 'Super Rare', value: 'Super Rare' },
					{ name: 'Ultra Rare', value: 'Ultra Rare' },
					{ name: 'Secret Rare', value: 'Secret Rare' },
					{ name: 'Ultimate Rare', value: 'Ultimate Rare' },
					{ name: 'Ghost', value: 'Ghost Rare' },
					{ name: 'Starlight Rare', value: 'Starlight Rare' },
					{ name: 'Quarter Century Secret Rare', value: 'Quarter Century Secret Rare' },
					{ name: 'Prismatic', value: 'Prismatic' },
					{ name: 'Gold', value: 'Gold' },
					{ name: 'Collector\'s', value: 'Collector\'s' }
				])
		)
		.addStringOption(op =>
			op.setName('sort')
				.setDescription('Change how prices are ordered.')
				.setChoices([
					{ name: 'Ascending (least expensive first)', value: 'asc' },
					{ name: 'Descending (most expensive first)', value: 'desc' }
				])
		),
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
		const priceSearch = qry.searches[0]
		if (!priceSearch.data) {
			await queryRespond(bot, interaction, 'Could not find any price data with the given search and filter(s).', qry)
			return
		}

		const priceFilters = {}
		if (rarity)
			priceFilters.rarity = rarity
		if (sort)
			priceFilters.sort = sort
		
		const embedData = priceSearch.data.generatePriceEmbed(locale, qry.official, priceFilters)

		const msgOptions = {}
		if ('embed' in embedData) {
			msgOptions.embeds = [embedData.embed]
		}
		else {
			await queryRespond(bot, interaction, 'Could not find any price data with the given search and filter(s).', qry)
			return
		}
		
		await queryRespond(bot, interaction, '', qry, msgOptions)
	},
	autocomplete: async (interaction, bot) => {
		const focus = interaction.options.getFocused(true)

		if (focus.name === 'search') {
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
	}
}