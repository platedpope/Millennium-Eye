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
		// if the message is too old (sent >10sec ago by default), ignore this edit
		const timeout = new Date(oldMessage.createdAt.getTime() + (1000 * EDIT_TIMEOUT))
		if (newMessage.editedAt > timeout) return

		const newQry = new Query(newMessage, bot)
		let toEval = newQry.eval

		// if both messages have content, find anything new in the new message	
		if (oldMessage.content) {
			toEval = []
			const oldQry = new Query(oldMessage, bot)
			
			// for each type of query in the new message, check whether it exists in the old message
			// if not, then that's something new, add that to eval
			// if it does exist, then descend and check each query of that type in the new message vs. old
			// if a new query of that type (different qry/language) is in the new message, add it in the eval
			const sameQry = (a, b) => a.type === b.type && a.content === b.content && a.lan === b.lan
			const onlyInLeft = (left, right) =>
				left.filter(lv =>
					!right.some(rv =>
						sameQry(lv, rv)))
				
			const newToEval = onlyInLeft(newQry.eval, oldQry.eval)
			if (newToEval.length)
				toEval = newToEval
		}
		// if the old message didn't have content, then just evaluate this as something brand new
		// it was probably edited to include a bot mention it didn't have before

		if (toEval.length) {
			for (const m of prepareDiscordLogJsMessage(toEval)) {
				newMessage.channel.send(m)
			}
		}
	}
})