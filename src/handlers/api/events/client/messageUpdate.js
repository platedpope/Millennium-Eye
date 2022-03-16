const Discord = require('discord.js')

const { prepareDiscordLogJsMessage } = require ('lib/utils/logging')
const MillenniumEyeBot = require('lib/models/MillenniumEyeBot')
const Event = require('lib/models/Event')
const Query = require('lib/models/Query')
const { EDIT_TIMEOUT } = require('lib/models/Defines')

module.exports = new Event({
	event: 'messageUpdate',
	once: false,
	/**
	 * @param {MillenniumEyeBot} bot 
	 * @param {Discord.Message} oldMessage
	 * @param {Discord.Message} newMessage 
	 */
	execute: async (bot, oldMessage, newMessage) => {
		if (newMessage.author.bot) return
		if (!newMessage.content) return
		// If the message is too old (sent >10sec ago by default), ignore this edit.
		const timeout = new Date(oldMessage.createdAt.getTime() + (1000 * EDIT_TIMEOUT))
		if (newMessage.editedAt > timeout) return

		const newQry = new Query(newMessage, bot)
		let toEval = newQry.searches

		// If both messages have content, find anything new in the new message.
		if (oldMessage.content) {
			const oldQry = new Query(oldMessage, bot)
			
			toEval = newQry.diffFrom(oldQry)
		}
		// If the old message didn't have content, then just evaluate this as something brand new;
		// it was probably edited to include a bot mention it didn't have before.

		if (toEval.length !== 0) {
			for (const m of prepareDiscordLogJsMessage(toEval)) {
				newMessage.channel.send(m)
			}
		}
	}
})