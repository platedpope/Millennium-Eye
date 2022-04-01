const Command = require('lib/models/Command')
const { CommandTypes } = require('lib/models/Defines')

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
					{
						name: 'card name',
						value: 'name'
					},
					{
						name: 'card text',
						value: 'text'
					}
				]
			}
		]
	},
	execute: async (interaction, bot) => {
		// Nothing... yet.
	}
})