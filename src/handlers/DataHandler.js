const fs = require('fs')

const Card = require('lib/models/Card')
const Query = require('lib/models/Query')
const Ruling = require('lib/models/Ruling')
const Search = require('lib/models/Search')
const { addTcgplayerDataToDb } = require('./BotDBHandler')
const { addToLocalYgoresourcesDb, searchArtworkRepo, populateCardFromYgoresourcesApi, populateRulingFromYgoresourcesApi, getAllNeuronArts } = require('./YGOResourcesHandler')
const { populateCardFromYugipediaApi } = require('./YugipediaHandler')
const { getBanlistStatus } = require('./KonamiDBHandler')

/**
 * This is the callback data handler for turning data from the YGOResources database
 * into usable Search data (in this case, either a Card object or a Ruling object).
 * @param {Query} qry The query containing these searches.
 * @param {Array<Search>} qaSearches A map containing QA searches that were resolved through either the DB or API.
 * @param {Array<Search>} cardSearches A map containing card searches that were resolved through the API.
 */
async function convertYgoresourcesDataToSearchData(qry, qaSearches, cardSearches = []) {
	// Process any QAs.
	for (const s of qaSearches) {
		s.data = new Ruling()
		populateRulingFromYgoresourcesApi(s.rawData, s.data)
	}

	// Process any card data.
	const baseArtPath = `${process.cwd()}/data/card_images`
	for (const s of cardSearches) {
		if (!(s.data instanceof Card)) s.data = new Card()
		populateCardFromYgoresourcesApi(s.rawData, s.data)

		// Update banlist status, which isn't provided by YGOResources DB.
		getBanlistStatus(s.data)		

		if (s.data.dbId) {
			// Find all the art data, both from Neuron and Master Duel.
			// Neuron art first, which includes all alternate artworks.
			await getAllNeuronArts(s.data)

			// Now Master Duel high-res artwork if possible.
			// Master Duel has "common" and "tcg" art, where "tcg" is art that's censored in the TCG.
			const commonArtPath = baseArtPath + `/common/${s.data.dbId}.png`
			const tcgArtPath = baseArtPath + `/tcg/${s.data.dbId}.png`
			if (fs.existsSync(commonArtPath)) {
				s.data.addImageData('md', '1', commonArtPath)
			}
			else if (fs.existsSync(tcgArtPath)) {
				s.data.addImageData('md', '1', tcgArtPath)
			}
		}
	}
	// Resolve any that still don't have art.
	await searchArtworkRepo(cardSearches.filter(c => !c.data.imageData.size))

	// Add anything from the API to the YGOResources DB as necessary.
	addToLocalYgoresourcesDb(qaSearches, cardSearches)
	// Null out all the raw data now that we've put it in the DB.
	for (const qas of qaSearches) {
		qas.rawData = undefined
	}
	for (const cs of cardSearches) {
		cs.rawData = undefined
	}
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
				if ((page.title.includes('(anime)') && !termString.includes('anime')) ||
					(page.title.includes('(manga)') && !termString.includes('manga')))
					continue
				
				bestPage = page
				break
			}

			if (!(s.data instanceof Card)) s.data = new Card()
			populateCardFromYugipediaApi(bestPage, s.data)
			s.rawData = undefined

			getBanlistStatus(s.data)

			// Did we get a better search term out of this?
			if (s.data.dbId)
				var betterTerm = s.data.dbId
			else if (s.data.passcode)
				betterTerm = s.data.passcode
			else
				betterTerm = s.data.name.get('en')

			if (betterTerm) {
				const mergedSearch = qry.updateSearchTerm(s.term, betterTerm)
				if (!mergedSearch)
					resolvedSearches.push(s)
			}
		}
	}

	/* If these have a DB ID, fill in some data like prints and banlist from the Konami DB.
	const konamiSearches = resolvedSearches.filter(s => s.data.dbId)
	getBanlistStatus(konamiSearches, qry, convertKonamiDataToSearchData)
	*/
}

function cacheTcgplayerPriceData(searches) {
	// Any searches that have price data in them are ones to put into the bot database.
	const searchesWithPriceData = searches.filter(s => {
		return s.data && s.data.products.length !== s.data.getProductsWithoutPriceData().length
	})

	addTcgplayerDataToDb(searchesWithPriceData)
}

module.exports = {
	convertYgoresourcesDataToSearchData, 
	convertYugipediaDataToSearchData, cacheTcgplayerPriceData
}