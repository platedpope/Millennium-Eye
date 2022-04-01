const Command = require('lib/models/Command')

module.exports = new Command({
	name: 'help',
	description: 'Responds with a summary of how to use the bot.',
	options: {
		name: 'help',
		description: 'Responds with a summary of how to use the bot.',
		options: []
	},
	execute: async (interaction, bot) => {
		// Nothing... yet.
	}
})