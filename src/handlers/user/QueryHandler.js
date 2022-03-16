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

	queryCardInfo(qry)
}

/**
 * Wraps the logic and program flow of search evaluation.
 * This function doesn't do any actual query work, but it defines the path
 * that searches take through the multiple databases and APIs available to the bot.
 * @param {Query} qry The query that needs to have its card info evaluated.
 */
function queryCardInfo(qry) {
	searchSteps = [
		
	]

	
}

module.exports = {
	processQuery
}