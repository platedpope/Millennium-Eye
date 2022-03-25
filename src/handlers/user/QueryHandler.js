const { Message, CommandInteraction } = require('discord.js')

const MillenniumEyeBot = require('lib/models/MillenniumEyeBot')
const { Query } = require('lib/models/Query')
const { searchTermCache } = require('database/BotDBHandler')
const { searchKonamiDb } = require('database/KonamiDBHandler')
const { logger } = require('lib/utils/logging')

/**
 * Takes an incoming Query and performs all necessary processing to evaluate its searches.
 * Overall, this wraps the logic and program flow of message processing, from message -> query -> searches and their data.
 * This function doesn't do any of the actual processing, but it defines the default path
 * that queries take through the multiple databases and APIs available to the bot.
 * Note that any given search can branch off into other areas during any of these steps, as necessary.
 * @param {Query} qry The query to process.
 */
async function processQuery(qry) {
	const processSteps = [
		searchTermCache,
		searchKonamiDb
	]
	

	for (const step of processSteps) {
		// Update for any searches that remain.
		let searchesToEval = qry.findUnresolvedSearches()
		if (!searchesToEval.length)
			// Nothing left to evaluate.
			break

		step(searchesToEval, qry)

		// Log out our new successes.
		for (const s of searchesToEval)
			if (s.isDataFullyResolved())
				logger.info(`Step ${step.name} successfully mapped original search(es) [${[...s.originals].join(', ')}] to ${s.data}.`)
	}

	return qry
}

/**
 * Helper function that wraps replying to a message with caching it for any future reference.
 * @param {MillenniumEyeBot} bot The bot.
 * @param {Message} origMessage The message that prompted this reply.
 * @param {String} replyContent Any raw message content to use in the reply.
 * @param {Query} qry Any query associated with the reply, for caching purposes.
 * @param replyOptions Any options to use when sending the message (e.g., embeds).
 */
async function sendReply(bot, origMessage, replyContent, qry, replyOptions) {
	// Build the message and its options.
	const fullReply = {}
	if (replyContent)
		fullReply.content = replyContent
	if (replyOptions !== undefined)
		for (const o in replyOptions)
			fullReply[o] = replyOptions[o]

	await origMessage.reply(fullReply)
		.then(reply => {
			const cacheData = bot.replyCache.get(origMessage.id)
			if (cacheData !== undefined) 
				cacheData.replies.push(reply)
			else
				bot.replyCache.put(origMessage.id, {
					'author': origMessage.author,
					'replies': [reply],
					'qry': qry
				})
		})
}

module.exports = {
	processQuery, sendReply
}