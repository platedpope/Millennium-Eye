const Discord = require('discord.js')

const { prepareDiscordLogJsMessage } = require ('lib/utils/logging')
const MillenniumEyeBot = require('lib/models/MillenniumEyeBot')
const Event = require('lib/models/Event')
const { Query } = require('lib/models/Query')
const { MESSAGE_TIMEOUT } = require('lib/models/Defines')
const { sendReply } = require('user/QueryHandler')

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
		const cachedReply = bot.replyCache.get(newMessage.id)
		if (cachedReply) 
			var oldQry = cachedReply.query

		if (oldQry) {
			var newQry = new Query(oldQry)
			newQry.evaluateMessage(newMessage)
		}
		else 
			newQry = new Query(newMessage, bot)

		const m = prepareDiscordLogJsMessage(newQry.searches)
		// If we have a single reply to edit, do that.
		if (cachedReply && cachedReply.replies.length == 1 && m.length === 1) {
			const replyToEdit = cachedReply.replies[0]
			replyToEdit.edit({
				content: m[0],
				allowedMentions: { repliedUser: false }
			})
		}
		else {
			// Otherwise, just send new replies.
			for (const m of prepareDiscordLogJsMessage(newQry.searches)) {
				sendReply(bot, newMessage, m, newQry, {
					allowedMentions: { repliedUser: false }
				})
			}
		}
	}
})