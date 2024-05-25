const Command = require('lib/models/Command')
const { CommandTypes } = require('lib/models/Defines')
const Query = require('lib/models/Query')
const { processQuery, updateUserTimeout, queryRespond } = require('handlers/QueryHandler')
const { searchNameToIdIndex } = require('handlers/YGOResourcesHandler')

module.exports = new Command({
	name: 'query',
	description: 'Query details of a card or ruling.',
	options: {
		name: 'query',
		description: 'Query details of a card or ruling.',
		options: [
			{
				name: 'content',
				description: 'The content of the query, same as an ordinary message.',
				type: CommandTypes.STRING,
				autocomplete: true,
				required: true
			}
		]
	},
	execute: async (interaction, bot) => {
		const qry = new Query(interaction, bot)

		// If this resulted in no searches, bootstrap a search with the text as a whole term.
		if (!qry.searches.length) {
			// Make sure we convert database IDs (e.g., that we get from an autocomplete) to integers.
			let qContent = interaction.options.getString('content')
			let intQContent = Number(qContent)
			// Special case: there is a card named "7"...
			if (!isNaN(intQContent) && !(qContent === '7')) {
				qContent = intQContent
			}
			qry.addSearch(qContent, qry.rulings ? 'r' : 'i', qry.locale)
		}

		if (qry.searches.length !== 0) {
			// Let the user know they're timed out.
			if (updateUserTimeout(interaction.user.id, qry.searches.length)) {
				await interaction.reply({
					content: 'Sorry, you\'ve requested too many searches recently. Please slow down and try again in a minute.',
					allowedMentions: { repliedUser: false },
					ephemeral: true
				})
				return
			}

			// Defer reply in case this takes a bit.
			await interaction.deferReply()
			await processQuery(qry)
			
			const embedData = await qry.getDataEmbeds()
			let omitResults = false
			// Build message data.
			const replyOptions = {}
			if ('embeds' in embedData) {
				replyOptions.embeds = embedData.embeds.slice(0, 5)
				if (embedData.embeds.length > 5)
					omitResults = true
			}
			if ('attachments' in embedData)
				replyOptions.files = embedData.attachments.slice(0 , 5)
			let report = Query.generateSearchResolutionReport(qry.searches)
			if (omitResults)
				report += '\n**Note:** Some results were omitted because the bot can only send 10 card data embeds at a time.'

			await queryRespond(bot, interaction, report, qry, replyOptions)
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