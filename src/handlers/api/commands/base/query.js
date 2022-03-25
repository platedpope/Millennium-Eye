
const Command = require('lib/models/Command')
const { CommandTypes, Languages } = require('lib/models/Defines')
const { processQuery } = require('user/QueryHandler')
const { Query } = require('lib/models/Query')

// convert available languages to an array of choices that can be parsed by slash commands
const languageChoices = []
for (const code in Languages) {
	languageChoices.push({
		'name': Languages[code],
		'value': code
	})
}

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
				required: true
			}
		]
	},
	execute: async (interaction, bot) => {
		const qry = new Query(interaction, bot)

		if (qry.searches.length !== 0) {
			await interaction.channel.sendTyping()

			await processQuery(qry)
			const embeds = qry.getDataEmbeds()
			if (embeds)
				await interaction.reply({
					embeds: embeds
				})
		}
	}
})