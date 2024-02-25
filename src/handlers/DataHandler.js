const fs = require('fs')

const Card = require('lib/models/Card')
const Query = require('lib/models/Query')
const Ruling = require('lib/models/Ruling')
const Search = require('lib/models/Search')
const { addTcgplayerDataToDb } = require('./BotDBHandler')
const { addToYgorgDb, searchArtworkRepo, populateCardFromYgorgApi, populateRulingFromYgorgDb, populatedRulingFromYgorgApi } = require('./YGOrgDBHandler')
const { populateCardFromYugipediaApi } = require('./YugipediaHandler')


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
	let artPath = `${process.cwd()}/data/card_images`
	const cardsWithoutArt = []
	for (const s of cardSearches) {
		if (!(s.data instanceof Card)) s.data = new Card()
		populateCardFromYgorgApi(s.rawData, s.data)
		s.rawData = undefined

		// Find art data, which can be in one of two places:
		// - 1. cached (saved) on disk
		// - 2. YGOrg artwork repo
		// Neuron art first, which includes all alternate artworks.
		let numAlts = 1
		let neuronArtPath = artPath + `/alts/${s.data.dbId}_${numAlts}.png`
		while (fs.existsSync(neuronArtPath)) {
			s.data.imageData.set(numAlts, neuronArtPath)

			numAlts += 1
			neuronArtPath = artPath + `/alts/${s.data.dbId}_${numAlts}.png`
		}

		// Also add Master Duel high-res artwork if possible.
		// Master Duel has "common" and "tcg" art, where "tcg" is art that's censored in the TCG.
		const commonArtPath = artPath + `/common/${s.data.dbId}.png`
		const tcgArtPath = artPath + `/tcg/${s.data.dbId}.png`
		let hasMasterDuelArtwork = false
		if (fs.existsSync(commonArtPath)) {
			artPath = commonArtPath
			hasMasterDuelArtwork = true
		}
		else if (fs.existsSync(tcgArtPath)) {
			artPath = tcgArtPath
			hasMasterDuelArtwork = true
		}
		// No Master Duel art yet? Kick to the artwork repo for the lower res Neuron art.
		else if (!s.data.imageData.size) {
			cardsWithoutArt.push(s)
		}

		if (hasMasterDuelArtwork) {
			// If this card only has one art from Neuron (i.e., no alts), then just get rid of it.
			// The Master Duel high res version will be a dupe, but much better.
			if (s.data.imageData.size === 1) {
				s.data.imageData.clear()
			}
			s.data.imageData.set('md', artPath)
		}
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
				if ((page.title.includes('(anime)') && !termString.includes('anime')) ||
					(page.title.includes('(manga)') && !termString.includes('manga')))
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
	convertYgorgDataToSearchData, 
	convertYugipediaDataToSearchData, cacheTcgplayerPriceData
}