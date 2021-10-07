const Command = require('../../utils/structures/Command')
const { CommandTypes } = require('../../utils/structures/Validation')
const { logger, generateError, prepareDiscordLogJsMessage } = require('../../utils/modules/logging')

module.exports = new Command({
	name: 'query',
	description: 'Query details of a card or ruling.',
	options: {
		name: 'query',
		description: 'Query details of a card or ruling.',
		options: [	
			{
				name: 'card',
				description: 'Query details of a card.',
				type: CommandTypes.SUB_COMMAND,
				options: [
					{
						name: 'identifier',
						description: 'The value to identify the card by (name or database ID).',
						type: CommandTypes.STRING,
						required: true
					},
					{
						name: 'type',
						description: 'The type of query to perform.',
						type: CommandTypes.STRING,
						required: true,
						choices: [
							{
								'name': 'info',
								'value': 'i'
							},
							{
								'name': 'art',
								'value': 'a'
							},
							{
								'name': 'date',
								'value': 'd',
							},
							{
								'name': 'yugipedia',
								'value': 'p'
							},
							{
								'name': 'faq',
								'value': 'f'
							},
							{
								'name': 'price',
								'value': '$'
							}
						]
					}
				]
			},
			{
				name: 'ruling',
				description: 'Query details of a database Q&A.',
				type: CommandTypes.SUB_COMMAND,
				options: [
					{
						name: 'id',
						description: 'The database ID of the ruling.',
						type: CommandTypes.INTEGER,
						required: true
					}
				]
			}
		]
	},
	execute: async (interaction, bot) => {
		await interaction.reply('Received arguments:')
		for (const m of prepareDiscordLogJsMessage(interaction.options))
			await interaction.channel.send(m)
	}
})