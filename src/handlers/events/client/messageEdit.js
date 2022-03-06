/* eslint-disable no-unused-vars */
const Discord = require('discord.js')
const MillenniumEyeBot = require('../../../lib/models/MillenniumEyeBot')
const Event = require('../../../lib/models/Event')
const Query = require('../../../lib/models/Query')
const { logger, generateError, prepareDiscordLogJsMessage } = require ('../../../lib/utils/logging')

module.exports = new Event({
	event: 'messageEdit',
	once: false,
	/**
	 * @param {MillenniumEyeBot} bot 
	 * @param {Discord.Message} oldMessage
	 * @param {Discord.Message} newMessage 
	 */
	execute: async (bot, oldMessage, newMessage) => {
		if (newMessage.author.bot) return
		if (!newMessage.content) return

		// construct list of properties that are important to evaluating this query
		const qry = new Query(newMessage, bot)

		if (Object.keys(qry.eval).length !== 0) 
			for (const m of prepareDiscordLogJsMessage(qry.eval)) {
				newMessage.channel.send(m)
			}
	}
})