
const Command = require('lib/models/Command')
const { CommandTypes } = require('lib/models/Defines')
const { processQuery } = require('user/QueryHandler')
const { Query } = require('lib/models/Query')

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
			// Let the user know they're timed out.
			if (updateUserTimeout(interaction.user.id, qry.searches.length)) {
				await interaction.reply({
					content: 'Sorry, you\'ve requested too many searches recently. Please slow down and try again in a minute.',
					allowedMentions: { repliedUser: false },
					ephemeral: true
				})
				return
			}

			await interaction.channel.sendTyping()

			await processQuery(qry)
			const embedData = qry.getDataEmbeds()
			if (embedData) {
				await interaction.reply({
					embeds: embedData.embeds,
					files: embedData.attachments
				})
			}
		}
	}
})