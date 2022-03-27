const Card = require('lib/models/Card')
const Ruling = require('lib/models/Ruling')
const Search = require('lib/models/Search')
const { logError } = require('lib/utils/logging')
const { botDb, addToTermCache, addToBotDb } = require('./BotDBHandler')
const { konamiDb } = require('./KonamiDBHandler')
const { ygorgDb, addToYgorgDb } = require('./YGOrgDBHandler')

/**
 * This is the callback data handler for turning data from the bot database into
 * usable Search data (in this case, a Card object).
 * @param {Array<Search>} resolvedSearches Searches that were resolved during this run of the bot database.
 * @param {Array<Search>} termUpdates Searches for which we found better search terms that should be updated. 
 */
function convertBotDataToSearchData(resolvedSearches, termUpdates) {
	for (const s of resolvedSearches) {
		const convertedCard = Card.fromBotDb(s.data, botDb)
		s.data = convertedCard
	}

	if (termUpdates.length)
		addToTermCache(termUpdates, 'bot')
}

/**
 * This is the callback data handler for turning data from the konami database into
 * usable Search data (in this case, a Card object).
 * @param {Array<Search>} resolvedSearches Searches that were resolved during this run of the bot database. 
 * @param {Array<Search>} termUpdates Searches for which we found better search terms that should be updated.
 */
function convertKonamiDataToSearchData(resolvedSearches, termUpdates) {
	for (const s of resolvedSearches) {
		const convertedCard = Card.fromKonamiDb(s.data, konamiDb)
		s.data = convertedCard
	}

	if (termUpdates.length)
		addToTermCache(termUpdates, 'konami')
}

/**
 * This is the callback data handler for turning data from the YGOrg database
 * into usable Search data (in this case, either a Card object or a Ruling object).
 * @param {Object} qaSearches A map containing QA searches that were resolved through either the DB or API.
 * @param {Array<Search>} cardSearches A map containing card searches that were resolved through the API.
 */
function convertYgorgDataToSearchData(qaSearches, cardSearches = []) {
	for (const s of qaSearches.db) {
		const convertedRuling = Ruling.fromYgorgDb(s.data, ygorgDb)
		convertRulingAssociatedCardsToCards(convertedRuling)
		s.data = convertedRuling
	}
	for (const s of qaSearches.api) {
		const convertedRuling = Ruling.fromYgorgQaApi(s.data)
		convertRulingAssociatedCardsToCards(convertedRuling)
		s.data = convertedRuling
	}
	for (const s of cardSearches) {
		const convertedCard = Card.fromYgorgCardApi(s.data)
		s.data = convertedCard
	}

	// Add anything from the API to the bot and YGOrg DBs as necessary.
	addToYgorgDb(qaSearches.api, cardSearches)
	addToBotDb(cardSearches)
}

/**
 * Converts a ruling's associated cards to actual cards.
 * @param {Ruling} ruling The ruling with cards to convert. 
 */
function convertRulingAssociatedCardsToCards(ruling) {
	// This is in here to avoid a circular dependency. Not ideal, but easy.
	const { processSearches } = require('handlers/QueryHandler')
	
	const cardSearches = []
	for (const cid of ruling.cards)
		cardSearches.push(new Search(cid, 'i', 'en'))

	processSearches(cardSearches)

	const convertedCardData = []
	for (const s of cardSearches) 
		convertedCardData.push(s.data)
	
	ruling.cards = convertedCardData
}

module.exports = {
	convertBotDataToSearchData, convertKonamiDataToSearchData, convertYgorgDataToSearchData
}