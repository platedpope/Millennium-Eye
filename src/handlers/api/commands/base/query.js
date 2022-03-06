
const config = require('config')
const { prepareDiscordLogJsMessage } = require('lib/utils/logging')
const Command = require('lib/models/Command')
const Query = require('lib/models/Query')
const { CommandTypes } = require('lib/models/Defines')

// convert available languages to an array of choices that can be parsed by slash commands
const languageChoices = []
for (const code in config.languages) {
	languageChoices.push({
		'name': config.languages[code],
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
		// construct list of properties that are important to evaluating this query
		const qry = new Query(interaction, bot)

		if (Object.keys(qry.eval).length !== 0) 
			for (const m of prepareDiscordLogJsMessage(qry.eval)) {
				await interaction.reply(m)
			}
		
	}
})