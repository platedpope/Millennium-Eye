const Discord = require('discord.js')

const { MillenniumEyeBot } = require('lib/models/MillenniumEyeBot')
const Event = require('lib/models/Event')
const Query = require('lib/models/Query')
const { processQuery, updateUserTimeout, queryRespond } = require('handlers/QueryHandler')

module.exports = new Event({
	event: 'messageCreate',
	once: false,
	/**
	 * @param {MillenniumEyeBot} bot 
	 * @param {Discord.Message} message 
	 */
	execute: async (bot, message) => {
		if (!bot.isReady) return
		if (message.author.bot) return
		if (!message.content) return

		const qry = new Query(message, bot)

		if (qry.searches.length !== 0)  {
			// Let the user know if they're timed out.
			if (updateUserTimeout(message.author.id, qry.searches.length)) {
				await message.reply({
					content: 'Sorry, you\'ve requested too many searches recently. Please slow down and try again in a minute.',
					allowedMentions: { repliedUser: false }
				})
				return
			}
			
			await message.channel.sendTyping()
			
			await processQuery(qry)
			
			const embedData = qry.getDataEmbeds()
			// Build message data.
			const replyOptions = { 
				allowedMentions: { repliedUser: false }
			}
			if ('embeds' in embedData)
				replyOptions.embeds = embedData.embeds
			if ('attachments' in embedData)
				replyOptions.files = embedData.attachments
			const report = Query.generateSearchResolutionReport(qry.searches)

			await queryRespond(bot, message, report, qry, replyOptions)
		}
	}
})