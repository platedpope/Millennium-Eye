const Card = require('lib/models/Card')
const Query = require('lib/models/Query')
const Ruling = require('lib/models/Ruling')
const Search = require('lib/models/Search')
const { logError } = require('lib/utils/logging')
const { botDb, addToTermCache, addToBotDb, searchBotDb } = require('./BotDBHandler')
const { konamiDb, searchKonamiDb } = require('./KonamiDBHandler')
const { ygorgDb, addToYgorgDb, searchArtworkRepo } = require('./YGOrgDBHandler')

/**
 * This is the callback data handler for turning data from the bot database into
 * usable Search data (in this case, a Card object).
 * @param {Array<Search>} resolvedSearches Searches that were resolved during this run of the bot database.
 * @param {Array<Search>} termUpdates Searches for which we found better search terms that should be updated. 
 */
function convertBotDataToSearchData(resolvedBotSearches, termUpdates, konamiSearches) {
	for (const s of resolvedBotSearches) {
		const convertedCard = Card.fromBotDb(s.data, botDb)
		s.data = convertedCard
	}
	if (termUpdates.length)
		addToTermCache(termUpdates, 'bot')
	if (konamiSearches.length) 
		searchKonamiDb(konamiSearches, null, convertKonamiDataToSearchData)
}

/**
 * This is the callback data handler for turning data from the konami database into
 * usable Search data (in this case, a Card object).
 * @param {Array<Search>} resolvedSearches Searches that were resolved during this run of the bot database. 
 * @param {Array<Search>} termUpdates Searches for which we found better search terms that should be updated.
 */
function convertKonamiDataToSearchData(resolvedSearches, termUpdates) {
	for (const s of resolvedSearches) {
		if (!(s.data instanceof Card)) s.data = new Card()
		Card.fromKonamiDb(s.tempData, s.data, konamiDb)
		s.tempData = undefined
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
async function convertYgorgDataToSearchData(qaSearches, cardSearches = []) {
	// Process the QAs.
	for (const s of qaSearches.db) {
		const convertedRuling = Ruling.fromYgorgDb(s.data, ygorgDb)
		await convertRulingAssociatedCardsToCards(convertedRuling, [...s.localeToTypesMap.keys()])
		s.data = convertedRuling
	}
	for (const s of qaSearches.api) {
		const convertedRuling = Ruling.fromYgorgQaApi(s.data)
		await convertRulingAssociatedCardsToCards(convertedRuling, [...s.localeToTypesMap.keys()])
		s.data = convertedRuling
	}
	// Process the cards we got from the API.
	const cardsWithoutArt = []
	for (const s of cardSearches) {
		if (!(s.data instanceof Card)) s.data = new Card()
		Card.fromYgorgCardApi(s.tempData, s.data)
		s.tempData = undefined
		// If this card has no art yet, gonna need to use the artwork repo to resolve it.
		if (!s.data.imageData.size) 
			cardsWithoutArt.push(s)
	}
	// Resolve any that still don't have art.
	if (cardsWithoutArt.length)
		await searchArtworkRepo(cardSearches)

	// Add anything from the API to the bot and YGOrg DBs as necessary.
	addToYgorgDb(qaSearches.api, cardSearches)
	addToBotDb(cardSearches)
}

/**
 * Converts a ruling's associated cards to actual cards.
 * @param {Ruling} ruling The ruling with cards to convert.
 * @param {Array<String>} locales The locales that the ruling was queried in, so we can attempt to match these for the cards as well.
 */
async function convertRulingAssociatedCardsToCards(ruling, locales) {
	// This is in here to avoid a circular dependency. Not ideal, but easy.
	const { processSearches } = require('handlers/QueryHandler')
	
	const cardSearches = []
	for (const cid of ruling.cards) {
		const newSearch = new Search(cid)
		for (const l of locales)
			// Type doesn't matter, but we need to track the important locales for this search.
			newSearch.addTypeToLocale('i', l)
		cardSearches.push(newSearch)
	}

	await processSearches(cardSearches)

	const convertedCardData = []
	for (const s of cardSearches) 
		convertedCardData.push(s.data)
	
	ruling.cards = convertedCardData
}

/**
 * Converts a Yugipedia API query to card data and adds any new data to the bot database.
 * @param {Array<Search>} searches The searches that produced API data.
 * @param {Query} qry The query with these searches.
 */
function convertYugipediaDataToSearchData(searches, qry) {
	const resolvedSearches = []
	
	for (const s of searches) {
		if (!s.tempData) continue
		
		const qryData = s.tempData
		if ('pages' in qryData) {
			const pageData = qryData.pages
			// There can be multiple pages here. Search for the first one with a title that we can use.
			// Default to the first, but we'll find another if it exists.
			let bestPage = pageData[0]
			for (const page of pageData) {
				// Ignore ones with "(anime)" in their name unless our search term includes it.
				// Otherwise they tend to saturate the first results.
				if (page.title.includes('(anime)') && !s.term.includes('anime'))
					continue
				
				bestPage = page
			}

			if (!(s.data instanceof Card)) s.data = new Card()
			Card.fromYugipediaApi(bestPage, s.data)
			s.tempData = undefined

			// Did we get a better search term out of this?
			if (s.data.dbId)
				var betterTerm = s.data.dbId
			else if (s.data.passcode)
				betterTerm = s.data.passcode
			else
				betterTerm = s.data.name.get('en')

			const mergedSearch = qry.updateSearchTerm(s.term, betterTerm)
			if (!mergedSearch)
				resolvedSearches.push(s)
		}
	}

	// If these have a DB ID, fill in some data like prints and banlist from the Konami DB.
	const konamiSearches = resolvedSearches.filter(s => s.data.dbId)
	searchKonamiDb(konamiSearches, qry, convertKonamiDataToSearchData)
	// Otherwise, add them to the bot database.
	const newSearches = resolvedSearches.filter(s => !s.data.dbId)
	addToBotDb(newSearches)
}

module.exports = {
	convertBotDataToSearchData, convertKonamiDataToSearchData, convertYgorgDataToSearchData, convertYugipediaDataToSearchData
}