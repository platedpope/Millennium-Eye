const { Message, CommandInteraction, DiscordjsErrorCodes } = require('discord.js')
const Cache = require('timed-cache')

const Query = require('lib/models/Query')
const { MillenniumEyeBot } = require('lib/models/MillenniumEyeBot')
const { SEARCH_TIMEOUT_TRIGGER, CACHE_TIMEOUT } = require('lib/models/Defines')
const { logger, logError } = require('lib/utils/logging')
const { searchKonamiDb } = require('./KonamiDBHandler')
const { searchYgorgDb } = require('./YGOrgDBHandler')
const { searchYugipedia } = require('./YugipediaHandler')
const { convertKonamiDataToSearchData, convertYgorgDataToSearchData, convertYugipediaDataToSearchData, cacheTcgplayerPriceData } = require('./DataHandler')
const { searchTcgplayer } = require('./TCGPlayerHandler')

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

// Cached search data. This is an object with keys mapping a search term to the associated data it resulted in.
// Multiple keys (i.e., search terms) can match to the same Search object.
// The contents are cleared automatically at certain time intervals.
let searchCache = {}

// This defines the default path searches take through the multiple databases and APIs available to the bot.
/**
 * @type {Array<searchStep>}
 */
const processSteps = [
	// TCGPlayer search step is first because otherwise set price searches end up getting interpreted as card searches.
	// e.g., searching SESL will think you're looking for Time Seal instead of the prices of cards in Secret Slayers.
	{
		'searchFunction': searchTcgplayer,
		'dataHandler': cacheTcgplayerPriceData,
		'useForOfficial': true,
		'evaluatesTypes': new Set(['$'])
	},
	{
		'searchFunction': searchKonamiDb,
		'dataHandler': convertKonamiDataToSearchData,
		'useForOfficial': true,
		'evaluatesTypes': new Set(['i', 'r', 'a', 'd', '$', 'f']),
	},
	// And another TCGPlayer search step because otherwise card price searches before a card's data is cached result in empty data.
	// Going TCGPlayer -> Konami -> TCGPlayer allows the search logic to first find set price searches, then card data, then price data for that card.
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
	// Before we try any of the steps, go through the cache to resolve anything we can.
	for (const s of qry.searches) {
		const cachedData = searchCache[s.term]
		// We've seen this before, grab it from the cache.
		if (cachedData) {
			s.data = cachedData.data
			logger.debug(`Search term ${s.term} mapped to cached result ${s.data}.`)
			cachedData.lastAccess = Date.now()
		}
	}

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

		// Double check the cache again, since performing this search step might have resulted in us
		// finding something that was actually in our cache but we didn't know due to this being a new search term.
		for (const s of searchesToEval) {
			const cachedData = searchCache[s.term]
			// Yep, we've seen this before and this is just a new way to refer to it we didn't know about yet.
			if (cachedData) {
				// Update our search data to point to what was cached rather than what we just found.
				// The cached data may be more "complete," and it also probably has other terms pointing to it already.
				s.data = cachedData.data
				logger.debug(`Search step ${stepSearch.name} mapped to cached result ${s.data} after original search(es) [${[...s.originals].join(', ')}] produced search term ${s.term}.`)
				cachedData.lastAccess = Date.now()
			}
		}

		// Cache the successes and log them out.
		for (const s of searchesToEval)
			// Don't cache Q&A searches, they already go into the YGOrg database which is effectively a Q&A-specific cache.
			if (s.isDataFullyResolved() && !s.hasType('q')) {
				logger.info(`Search step ${stepSearch.name} finished resolving original search(es) [${[...s.originals].join(', ')}] to ${s.data}. Updating cache.`)

				const cacheData = {
					data: s.data,
					lastAccess: Date.now()
				}
				for (const ot of s.originals)
					if (!(ot in searchCache))
						searchCache[ot] = cacheData
				if (!(s.term in searchCache))
					searchCache[s.term] = cacheData
			}
	}
}

/**
 * Resets the search cache, deleting all previously cached data.
 * It basically just declares a new, empty object. It's a deceptively simple function,
 * only necessary since other modules need the ability to reset the cache and can't do so with a simple import.
 */
function clearSearchCache() {
	let clearedItems = 0

	const searchTerms = Object.keys(searchCache)
	for (let i = 0; i < searchTerms.length; i++) {
		const termLastAccess = searchCache[searchTerms[i]].lastAccess
		if ((Date.now() - termLastAccess) > CACHE_TIMEOUT) {
			searchTerms[i] = undefined
			delete searchCache[searchTerms[i]]
			clearedItems++
		}
	}

	logger.info(`Search term cache clear periodic evicted ${clearedItems} stale items from the cache.`)
	cacheCheck()
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
 * @async
 * Helper function that wraps replying to a message with caching it for any future reference.
 * @param {MillenniumEyeBot} bot The bot.
 * @param {Message | CommandInteraction} origMessage The message that prompted this reply.
 * @param {String} replyContent Any raw message content to use in the reply.
 * @param {Query} qry Any query associated with the reply, for caching purposes.
 * @param replyOptions Any options to use when sending the message (e.g., embeds).
 * @returns {Promise<Message>} The reply.
 */
async function queryRespond(bot, origMessage, replyContent, qry, replyOptions) {
	// Build the message and its options.
	const fullReply = {}
	if (replyContent)
		fullReply.content = replyContent
	if (replyOptions !== undefined)
		for (const o in replyOptions)
			fullReply[o] = replyOptions[o]

	let reply = undefined

	// Empty reply, why are we here?
	if ( (!('content' in fullReply) || ('content' in fullReply && !fullReply.content)) && 
		 (!('embeds' in fullReply) || ('embeds' in fullReply && !fullReply.embeds.length)) &&
		 (!('components' in fullReply || ('components' in fullReply && !fullReply.components.length)) ) )
		return reply
	
	let edited = false
	try {
		// Interactions might be deferred, in which case we need to edit rather than reply.
		if (origMessage instanceof CommandInteraction && (origMessage.deferred || origMessage.replied)) {
			reply = await origMessage.editReply(fullReply)
			edited = true
		}
		// If the "original message" was sent by us, then this is actually a reply we should edit.
		else if (origMessage.author === bot.user) {
			reply = await origMessage.edit(fullReply)
			edited = true
		}
		// Otherwise just a normal reply.
		else {
			reply = await origMessage.reply(fullReply)
		}
	}
	catch (err) {
		logError(err)
	}

	// Cache the reply if one was sent.
	if (reply) {
		const cacheData = bot.replyCache.get(origMessage.id)
		if (cacheData !== undefined && !edited) 
			cacheData.replies.push(reply)
		else
			bot.replyCache.put(origMessage.id, {
				'author': origMessage.author,
				'replies': [reply]
			})
	}

	return reply
}

/**
 * This is simply a helper function to move through the cache and check its contents.
 * Primarily this is used as a means of making sure it's caching data properly (i.e., no repeats),
 * to avoid memory leaks or just unnecessary re-allocation.
 */
function cacheCheck() {
	const consolidatedCache = {}

	for (const [term, cacheEntry] of Object.entries(searchCache)) {
		const cacheData = cacheEntry.data
		// Rulings don't have names. They shouldn't be getting cached anyway, but skip them just in case.
		let dataName = cacheData.name
		if (dataName) dataName = dataName.get('en')

		const consolEntry = consolidatedCache[dataName]
		if (consolEntry) {
			if (cacheData === consolEntry.data) {
				consolEntry.terms.push(term)
			}
			else {
				logger.warn(`Cache check found data name ${dataName} that points to two different underlying data objects. Possible caching problem?`)
			}
		}
		else if (dataName) {
			consolidatedCache[dataName] = {
				data: cacheData,
				terms: [term]
			}
		}
	}

	logger.debug('Final cache check details:')
	logger.debug('=================================')
	logger.debug(`Distinct entries: ${Object.keys(consolidatedCache).length}`)
	for (const [name, cacheEntry] of Object.entries(consolidatedCache)) {
		logger.debug(`- ${name}: ${cacheEntry.terms.length} associated search terms (${cacheEntry.terms.join(', ')})`)
	}
	logger.debug('=================================')
}

module.exports = {
	processQuery, queryRespond, clearSearchCache, updateUserTimeout
}