const { Message } = require('discord.js')
const Cache = require('timed-cache')

const Query = require('lib/models/Query')
const Search = require('lib/models/Search')
const { MillenniumEyeBot } = require('lib/models/MillenniumEyeBot')
const { SEARCH_TIMEOUT_TRIGGER } = require('lib/models/Defines')
const { logger, logError } = require('lib/utils/logging')
const { searchTermCache } = require('./BotDBHandler')
const { searchKonamiDb } = require('./KonamiDBHandler')
const { searchYgorgDb } = require('./YGOrgDBHandler')
const { searchYugipedia } = require('./YugipediaHandler')
const { convertBotDataToSearchData, convertKonamiDataToSearchData, convertYgorgDataToSearchData, convertYugipediaDataToSearchData, cacheTcgplayerPriceData } = require('./DataHandler')
const { searchTcgplayer } = require('./TCGPlayerHandler')
const Card = require('lib/models/Card')
const { TCGPlayerSet } = require('lib/models/TCGPlayer')
const Ruling = require('lib/models/Ruling')

/**
 * @typedef {Object} searchStep
 * @property {Function} searchFunction
 * @property {Function} dataHandler
 * @property {Boolean} useForOfficial
 * @property {Set<String>} evaluatesTypes
 */

// Used to monitor how many searches a user has queried the bot over a period of time (default 1 min).
// If a user passes the acceptable number over the course of that minute, no future searches within that minute are allowed.
const userSearchCounter = new Cache({ defaultTtl: 60 * 1000 })

// This defines the default path searches take through the multiple databases and APIs available to the bot.
/**
 * @type {Array<searchStep>}
 */
const processSteps = [
	{ 
		'searchFunction': searchTermCache,
		'dataHandler': convertBotDataToSearchData,
		'useForOfficial': false,
		'evaluatesTypes': new Set(['i', 'r', 'a', 'd', '$', 'f'])
	},
	{
		'searchFunction': searchKonamiDb,
		'dataHandler': convertKonamiDataToSearchData,
		'useForOfficial': true,
		'evaluatesTypes': new Set(['i', 'r', 'a', 'd', '$', 'f']),
	},
	{
		'searchFunction': searchTcgplayer,
		'dataHandler': cacheTcgplayerPriceData,
		'useForOfficial': true,
		'evaluatesTypes': new Set(['$'])
	},
	{
		'searchFunction': searchYgorgDb,
		'dataHandler': convertYgorgDataToSearchData,
		'useForOfficial': false,
		'evaluatesTypes': new Set(['i', 'r', 'a', 'd', 'f', 'q'])
	},
	{
		'searchFunction': searchYugipedia,
		'dataHandler': convertYugipediaDataToSearchData,
		'useForOfficial': false,
		'evaluatesTypes': new Set(['i', 'r', 'a', 'd', 'p'])
	}
]

/**
 * Takes an incoming Query and performs all necessary processing to evaluate its searches.
 * Overall, this wraps the logic and program flow of message processing, from message -> query -> searches and their data.
 * This function doesn't do any of the actual processing.
 * @param {Query} qry The query to process.
 */
async function processQuery(qry) {
	for (const step of processSteps) {
		// Some steps are not used when "official mode" is turned on.
		if (qry.official && !step.useForOfficial)
			continue

		// Update for any searches that remain.
		let searchesToEval = qry.findUnresolvedSearches()
		if (!searchesToEval.length)
			// Everything is resolved.
			break
		// Filter to find only searches this step will evaluate.
		searchesToEval = searchesToEval.filter(s => {
			const unresolvedTypes = new Set(...s.getUnresolvedData().values())
			for (const ut of unresolvedTypes)
				if (step.evaluatesTypes.has(ut)) return true
			return false
		})
		if (!searchesToEval.length)
			// If this filtered out everything, nothing to do on this step.
			continue

		const stepSearch = step.searchFunction
		const stepHandlerCallback = step.dataHandler
		try {
			await stepSearch(searchesToEval, qry, stepHandlerCallback)
		}
		catch (err) {
			logError(err, `Process query step ${stepSearch.name} encountered an error.`)
		}

		// Log out our new successes.
		for (const s of searchesToEval)
			if (s.isDataFullyResolved())
				logger.info(`Step ${stepSearch.name} finished resolving original search(es) [${[...s.originals].join(', ')}] to ${s.data}.`)
	}
}

/**
 * Takes a series of incoming Searches and performs all the necessary processing to evaluate them.
 * This is identical to processQuery, but doesn't use/pass around a Query object. Most often this will be used
 * by offshoot logic that makes temporary Searches to resolve a card, while processQuery is used by the main
 * logic whenever a message is sent.
 * @param {Array<Search>} searches The searches to process. 
 */
async function processSearches(searches) {
	for (const step of processSteps) {
		// Update for any searches that remain.
		let searchesToEval = searches.filter(s => !s.isDataFullyResolved())
		if (!searchesToEval.length)
			// Nothing left to evaluate.
			break
		
		const stepSearch = step.searchFunction
		const stepHandlerCallback = step.dataHandler
		try {
			await stepSearch(searchesToEval, null, stepHandlerCallback)
		}
		catch (err) {
			logError(err, `Process search step ${stepSearch.name} encountered an error.`)
		}

		// Don't log out successes along the way.
	}
}

/**
 * Updates a user's cached timeout value given their number of searches, or indicates
 * whether they have been timed out.
 * @param {Number} userId The ID of the user.
 * @param {Number} numSearches The number of searches to update and check.
 * @returns {Boolean} True if the user has reached their limit, false if not.
 */
function updateUserTimeout(userId, numSearches) {
	const userSearches = userSearchCounter.get(userId)
	if (userSearches === undefined)
		// User's first search this minute, just start tracking them.
		userSearchCounter.put(userId, numSearches)
	else {
		if (userSearches >= SEARCH_TIMEOUT_TRIGGER)
			return true
		
		// This user has searches in the past minute, update their value.
		userSearchCounter.put(userId, userSearches + numSearches)
	}

	return false
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

	// Empty reply, why are we here?
	if ( (!('content' in fullReply) || !fullReply.content) && 
		 (!('embeds' in fullReply) || !fullReply.embeds.length) )
		return

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
	processQuery, processSearches, sendReply, updateUserTimeout
}