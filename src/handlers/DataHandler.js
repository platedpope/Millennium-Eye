const Card = require('lib/models/Card')
const Query = require('lib/models/Query')
const Ruling = require('lib/models/Ruling')
const Search = require('lib/models/Search')
const { addTcgplayerDataToDb, searchTcgplayerData } = require('./BotDBHandler')
const { searchKonamiDb, populateCardFromKonamiData } = require('./KonamiDBHandler')
const { searchTcgplayer } = require('./TCGPlayerHandler')
const { addToYgorgDb, searchArtworkRepo, populateCardFromYgorgApi, populateRulingFromYgorgDb, populatedRulingFromYgorgApi } = require('./YGOrgDBHandler')
const { populateCardFromYugipediaApi } = require('./YugipediaHandler')


/**
 * This is the callback data handler for turning data from the konami database into
 * usable Search data (in this case, a Card object).
 * @param {Array<Search>} resolvedSearches Searches that were resolved during this run of the bot database. 
 */
function convertKonamiDataToSearchData(resolvedSearches) {
	for (const s of resolvedSearches) {
		if (!(s.data instanceof Card)) s.data = new Card()
		populateCardFromKonamiData(s.rawData, s.data)
		s.rawData = undefined
	}
}

/**
 * This is the callback data handler for turning data from the YGOrg database
 * into usable Search data (in this case, either a Card object or a Ruling object).
 * @param {Query} qry The query containing these searches.
 * @param {Object} qaSearches A map containing QA searches that were resolved through either the DB or API.
 * @param {Array<Search>} cardSearches A map containing card searches that were resolved through the API.
 */
async function convertYgorgDataToSearchData(qry, qaSearches, cardSearches = []) {
	// Process the QAs.
	for (const s of qaSearches.db) {
		s.data = new Ruling()
		populateRulingFromYgorgDb(s.rawData, s.data)
		s.rawData = undefined
	}
	for (const s of qaSearches.api) {
		s.data = new Ruling()
		populatedRulingFromYgorgApi(s.rawData, s.data)
		s.rawData = undefined
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

	// Add anything from the API to the YGOrg DB as necessary.
	addToYgorgDb(qaSearches.api, cardSearches)
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
				const termString = String(s.term)
				if (page.title.includes('(anime)') && !termString.includes('anime'))
					continue
				
				bestPage = page
				break
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
}

function cacheTcgplayerPriceData(searches) {
	// Any searches that have price data in them are ones to put into the bot database.
	const searchesWithPriceData = searches.filter(s => {
		return s.data && s.data.products.length !== s.data.getProductsWithoutPriceData().length
	})

	addTcgplayerDataToDb(searchesWithPriceData)
}

module.exports = {
	convertKonamiDataToSearchData, convertYgorgDataToSearchData, 
	convertYugipediaDataToSearchData, cacheTcgplayerPriceData
}