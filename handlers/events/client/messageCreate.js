/* eslint-disable no-unused-vars */

const Discord = require('discord.js')
const MillenniumEyeBot = require('../../../utils/structures/MillenniumEyeBot')
const Event = require('../../../utils/structures/Event')
const Query = require('../../../utils/structures/Query')
const { logger, generateError, formatDiscordJson } = require ('../../../utils/modules/logging')

module.exports = new Event({
	event: 'messageCreate',
	once: false,
	/**
	 * @param {MillenniumEyeBot} bot 
	 * @param {Discord.Message} message 
	 */
	execute: async (bot, message) => {
		if (message.author.bot) return

		// construct list of properties that are important to evaluating this query
		const qry = new Query(message, bot)

		// message.reply(`Parsed message result looks like: ${formatDiscordJson(qry.results)}`)
	}
})