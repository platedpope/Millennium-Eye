const Command = require('lib/models/Command')
const { CommandTypes } = require('lib/models/Defines')
const Query = require('lib/models/Query')
const { processQuery, updateUserTimeout, queryRespond } = require('handlers/QueryHandler')
const config = require('config')
const { searchNameToIdIndex } = require('handlers/YGOrgDBHandler')

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

		// If this resulted in no searches, then wrap some default query syntax around the message content to treat it as one big search.
		if (!qry.searches.length) {
			let syntax = bot.guildSettings.get([interaction.guildId, 'queries', qry.locale]) ?? 
						// Just use default if no syntax exists for this locale.
						 { open: config.defaultOpen, close: config.defaultClose }

			const adjContent = `${syntax.open}${interaction.options.getString('content')}${syntax.close}`
			qry.evaluateMessage(adjContent) 
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

			// Build message data.
			const replyOptions = {}
			if ('embeds' in embedData)
				replyOptions.embeds = embedData.embeds
			if ('attachments' in embedData)
				replyOptions.files = embedData.attachments
			const report = Query.generateSearchResolutionReport(qry.searches)

			await queryRespond(bot, interaction, report, qry, replyOptions)
		}
	},
	autocomplete: async (interaction, bot) => {
		const focus = interaction.options.getFocused(true)
		const search = focus.value.toLowerCase()
		const locale = bot.getCurrentChannelSetting(interaction.channel, 'locale')

		const matches = searchNameToIdIndex(search, [locale], 25, true)

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