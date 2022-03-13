const { Message, CommandInteraction } = require('discord.js')
const MillenniumEyeBot = require('lib/models/MillenniumEyeBot')
const Query = require('lib/models/Query')

/**
 * Takes an incoming Discord message and performs all necessary processing
 * to evaluate and build a response to the message.
 * @param {MillenniumEyeBot} bot The bot.
 * @param {Message | CommandInteraction} msg The incoming Discord message to evaluate.
 * @returns {Query} The evaluated query.
 */
function processQuery(bot, msg) {
	const qry = new Query(msg, bot)

	return qry
}

module.exports = {
	processQuery
}