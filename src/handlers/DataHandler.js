const Card = require('lib/models/Card')
const Query = require('lib/models/Query')
const Ruling = require('lib/models/Ruling')
const Search = require('lib/models/Search')
const { addToTermCache, addToBotDb, populateCardFromBotData, addTcgplayerDataToDb, searchTcgplayerData } = require('./BotDBHandler')
const { searchKonamiDb, populateCardFromKonamiData } = require('./KonamiDBHandler')
const { addToYgorgDb, searchArtworkRepo, populateCardFromYgorgApi, populateRulingFromYgorgDb, populatedRulingFromYgorgApi, populateRulingAssociatedCardsData } = require('./YGOrgDBHandler')
const { populateCardFromYugipediaApi } = require('./YugipediaHandler')

/**
 * This is the callback data handler for turning data from the bot database into
 * usable Search data (in this case, a Card object).
 * @param {Array<Search>} resolvedSearches Searches that were resolved during this run of the bot database.
 * @param {Array<Search>} termUpdates Searches for which we found better search terms that should be updated.
 * @param {Array<Search>} konamiSearches Searches that had terms that mapped to the Konami database.
 */
function convertBotDataToSearchData(resolvedBotSearches, termUpdates, konamiSearches) {
	for (const s of resolvedBotSearches) {
		if (!(s.data instanceof Card)) s.data = new Card()
		populateCardFromBotData(s.rawData, s.data)
		s.rawData = undefined
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
	const priceSearches = []
	for (const s of resolvedSearches) {
		if (!(s.data instanceof Card)) s.data = new Card()
		populateCardFromKonamiData(s.rawData, s.data)
		s.rawData = undefined
		// Check if this search wanted price data now that we have a name/ID to search for.
		if (s.hasType('$'))
			priceSearches.push(s)
	}
	if (priceSearches.length)
		searchTcgplayerData(priceSearches)
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
		s.data = new Ruling()
		populateRulingFromYgorgDb(s.rawData, s.data)
		s.rawData = undefined
		await populateRulingAssociatedCardsData(s.data, [...s.localeToTypesMap.keys()])
	}
	for (const s of qaSearches.api) {
		s.data = new Ruling()
		populatedRulingFromYgorgApi(s.rawData, s.data)
		s.rawData = undefined
		await populateRulingAssociatedCardsData(s.data, [...s.localeToTypesMap.keys()])
	}
	// Process the cards we got from the API.
	const cardsWithoutArt = []
	for (const s of cardSearches) {
		if (!(s.data instanceof Card)) s.data = new Card()
		populateCardFromYgorgApi(s.rawData, s.data)
		s.rawData = undefined
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
 * Converts a Yugipedia API query to card data and adds any new data to the bot database.
 * @param {Array<Search>} searches The searches that produced API data.
 * @param {Query} qry The query with these searches.
 */
function convertYugipediaDataToSearchData(searches, qry) {
	const resolvedSearches = []
	
	for (const s of searches) {
		if (!s.rawData) continue
		
		const qryData = s.rawData
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
			populateCardFromYugipediaApi(bestPage, s.data)
			s.rawData = undefined

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

function cacheTcgplayerPriceData(searches) {
	// Any searches that have price data in them are ones to put into the bot database.
	const searchesWithPriceData = searches.filter(s => {
		return s.data.products.length !== s.data.getProductsWithoutPriceData().length
	})

	addTcgplayerDataToDb(searchesWithPriceData)
}

module.exports = {
	convertBotDataToSearchData, convertKonamiDataToSearchData, 
	convertYgorgDataToSearchData, convertYugipediaDataToSearchData,
	cacheTcgplayerPriceData
}