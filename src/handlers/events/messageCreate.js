const Discord = require('discord.js')

const { MillenniumEyeBot } = require('lib/models/MillenniumEyeBot')
const Event = require('lib/models/Event')
const Query = require('lib/models/Query')
const { processQuery, updateUserTimeout, queryRespond } = require('handlers/QueryHandler')
const { logError } = require('lib/utils/logging')

module.exports = new Event({
	event: Discord.Events.MessageCreate,
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
		if (qry.matchedDbLinks)
			try { await message.suppressEmbeds() }
			catch (err) {
				// Probably didn't have permissions. Just ignore this.
			}

		if (qry.searches.length)  {
			// Let the user know if they're timed out.
			if (updateUserTimeout(message.author.id, qry.searches.length)) {
				try {
					await message.reply({
						content: 'Sorry, you\'ve requested too many searches recently. Please slow down and try again in a minute.',
						allowedMentions: { repliedUser: false }
					})
				}
				catch (err) {
					await logError(err, 'Failed to send rate limiter warning to user.')
				}
				return
			}
			
			try { await message.channel.sendTyping() }
			catch (err) {
				// Probably didn't have permissions. Just ignore this.
			}
		
			await processQuery(qry)
			
			const embedData = await qry.getDataEmbeds()
			let omitResults = false
			// Build message data.
			const replyOptions = { 
				allowedMentions: { repliedUser: false }
			}
			if ('embeds' in embedData) {
				replyOptions.embeds = embedData.embeds.slice(0, 5)
				if (embedData.embeds.length > 5)
					omitResults = true
			}
			if ('attachments' in embedData)
				replyOptions.files = embedData.attachments.slice(0, 5)
			let report = Query.generateSearchResolutionReport(qry.searches)
			if (omitResults)
				report += '\n**Note:** Some results were omitted because the bot will only send 5 card data embeds at a time.'
	
			await queryRespond(bot, message, report, qry, replyOptions)
		}
	}
})