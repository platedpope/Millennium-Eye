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

		processQuery(newQry)

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

			const embedData = newQry.getDataEmbeds()
			if (Object.keys(embedData).length) {
				// If we have a single reply to edit, do that.
				if (cachedReply && cachedReply.replies.length == 1) {
					const replyToEdit = cachedReply.replies[0]
					await replyToEdit.removeAttachments()
					await replyToEdit.edit({
						embeds: embedData.embeds,
						files: embedData.attachments,
						allowedMentions: { repliedUser: false }
					})
					bot.replyCache.put(newMessage.id, {
						'author': newMessage.author,
						'replies': [replyToEdit],
						'qry': newQry
					})
				}
				else {
					// Otherwise, just send new replies.
					await sendReply(bot, newMessage, '', newQry, {
						embeds: embedData.embeds,
						files: embedData.attachments,
						allowedMentions: { repliedUser: false },
					})
				}
			}
			else 
				// There were still searches but we didn't find anything for them. If we had a response, delete it.
				if (cachedReply) {
					for (const cr of cachedReply.replies)
						await cr.delete()
					bot.replyCache.remove(oldMessage.id)
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