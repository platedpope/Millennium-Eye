const Discord = require('discord.js')

const { MillenniumEyeBot } = require('lib/models/MillenniumEyeBot')
const Event = require('lib/models/Event')
const Query = require('lib/models/Query')
const { MESSAGE_TIMEOUT } = require('lib/models/Defines')
const { processQuery, sendReply, updateUserTimeout } = require('handlers/QueryHandler')

module.exports = new Event({
	event: 'messageUpdate',
	once: false,
	/**
	 * @param {MillenniumEyeBot} bot 
	 * @param {Discord.Message} oldMessage
	 * @param {Discord.Message} newMessage 
	 */
	execute: async (bot, oldMessage, newMessage) => {
		if (!bot.isReady) return
		if (newMessage.author.bot) return
		if (!newMessage.content) return
		// If the message is too old (sent >15sec ago by default), ignore this edit.
		const timeout = new Date(oldMessage.createdAt.getTime() + (1000 * MESSAGE_TIMEOUT))
		if (newMessage.editedAt > timeout) return

		// If the message edited is in our cache, grab the query we found back then for a baseline.
		const cachedReply = bot.replyCache.get(oldMessage.id)
		if (cachedReply) 
			var oldQry = cachedReply.qry

		if (oldQry) {
			var newQry = new Query(oldQry)
			newQry.updateSearchData(newMessage)
		}
		else 
			newQry = new Query(newMessage, bot)

		if (newQry.searches.length) {
			// Let the user know they're timed out.
			// For edits this is a bit imperfect because it will count searches that have already happened...
			// but honestly, people shouldn't be tripping this limit with normal use regardless.
			if (updateUserTimeout(newMessage.author.id, newQry.searches.length)) {
				await newMessage.reply({
					content: 'Sorry, you\'ve requested too many searches recently. Please slow down and try again in a minute.',
					allowedMentions: { repliedUser: false }
				})
				return
			}

			const editReply = cachedReply && cachedReply.replies.length === 1
			// If we won't be editing a reply, turn on "typing".
			if (!editReply)
				await newMessage.channel.sendTyping()
		
			await processQuery(newQry)

			const embedData = newQry.getDataEmbeds()
			// Build message data.
			const replyOptions = { 
				allowedMentions: { repliedUser: false }
			}
			if ('embeds' in embedData)
				replyOptions.embeds = embedData.embeds
			else
				// Need to do this so embeds for searches that can no longer resolve after an edit get removed.
				replyOptions.embeds = []
			if ('attachments' in embedData)
				replyOptions.files = embedData.attachments
			const report = Query.generateSearchResolutionReport(newQry.searches)

			if (!report && !('embeds' in replyOptions)) {
				// There were searches but we didn't find anything for them. If we had a response, delete it.
				if (cachedReply) {
					for (const cr of cachedReply.replies)
						await cr.delete()
					bot.replyCache.remove(oldMessage.id)
				}
			}
			else {
				// If we have a single reply to edit, do that.
				if (editReply) {
					const replyToEdit = cachedReply.replies[0]
					await replyToEdit.removeAttachments()

					if (report) replyOptions.content = report
					const editedReply = await replyToEdit.edit(replyOptions)
					bot.replyCache.put(newMessage.id, {
						'author': newMessage.author,
						'replies': [editedReply],
						'qry': newQry
					})
				}
				else 
					// Otherwise, just send new replies.
					await sendReply(bot, newMessage, report, newQry, replyOptions)
			}
		}
		else
			// If the new query has nothing and we had any cached replies, just delete 'em.
			if (cachedReply) {
				for (const cr of cachedReply.replies)
					await cr.delete()
				bot.replyCache.remove(oldMessage.id)
			}
		
	}
})