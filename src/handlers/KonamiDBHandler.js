const Database = require('better-sqlite3')
const PythonShell = require('python-shell').PythonShell

const { searchNameToIdIndex } = require('./YGOrgDBHandler')
const { KONAMI_DB_PATH, NEURON_DB_PATH } = require('lib/models/Defines')
const { logger, logError } = require('lib/utils/logging')
const { TCGPlayerSet } = require('lib/models/TCGPlayer')

const konamiDb = new Database(KONAMI_DB_PATH)

/**
 * Search the Konami (i.e., official) database to resolve our card data.
 * @param {Array<Search>} searches The array of relevant searches to evaluate.
 * @param {Query} qry The query that contains all the relevant searches.
 * @param {Function} dataHandlerCallback The callback for handling the data produced by this search.
 */
function searchKonamiDb(searches, qry, dataHandlerCallback) {
	// Keep track of the searches that we've resolved during this trip through the database.
	const resolvedSearches = []

	const getDbId = konamiDb.prepare('SELECT * FROM card_data WHERE id = ?')
	// Iterate through the array backwards because we might modify it as we go.
	for (let i = searches.length - 1; i >= 0; i--) {
		const currSearch = searches[i]
		// Skip TCGPlayer sets we found in the bot cache.
		if (currSearch.data && currSearch.data instanceof TCGPlayerSet) continue
		
		// If the search term is a number, then it's a database ID.
		if (Number.isInteger(currSearch.term)) {
			const dataRows = getDbId.all(currSearch.term)
			if (dataRows.length) {
				currSearch.rawData = dataRows
				resolvedSearches.push(currSearch)
			}
		}
		else {
			// Otherwise, try to match based on the name index.
			// Always search the EN index. If this search has any other locales, use them too.
			const localesToSearch = ['en']
			for (const locale of currSearch.localeToTypesMap.keys())
				if (!localesToSearch.includes(locale)) localesToSearch.push(locale)

			const bestMatch = searchNameToIdIndex(currSearch.term, localesToSearch)
			for (const id of bestMatch.keys()) {
				const score = bestMatch.get(id)
				if (score < 0.5) break	// Ignore scores this low, they mean we weren't really sure, this was just the least bad.

				const dataRows = getDbId.all(id)
				if (dataRows.length) {
					currSearch.rawData = dataRows
					// We should have a better search term now.
					const dbId = dataRows[0].id
					if (dbId) {
						const mergedSearch = qry.updateSearchTerm(currSearch.term, dbId)
						if (!mergedSearch) {
							resolvedSearches.push(currSearch)
						}
					}
				}
			}
		}
	}

	dataHandlerCallback(resolvedSearches)
}

/**
 * Populates a Card's data with data from the Konami database.
 * This function will not overwrite any data that is already present in the Card that is passed.
 * @param {Array<konamiCardDataRow>} dbRows Rows of data returned from the card_data Konami DB table.
 * @param {Card} card The card to populate with data.
 */
 function populateCardFromKonamiData(dbRows, card) {
	// Just use the first row as a representative for all the stats that aren't locale-sensitive.
	const repRow = dbRows[0]
	
	// Map locale-sensitive rows.
	for (const r of dbRows) {
		if (!card.name.has(r.locale)) card.name.set(r.locale, r.name)
		if (!card.effect.has(r.locale)) card.effect.set(r.locale, r.effect_text)
		if (r.pendulum_text)
			if (!card.pendEffect.has(r.locale)) card.pendEffect.set(r.locale, r.pendulum_text)
	}
	card.dbId = repRow.id
	if (!card.cardType) card.cardType = repRow.card_type
	if (!card.property) card.property = repRow.en_property
	if (!card.attribute) card.attribute = repRow.en_attribute
	if (!card.levelRank) card.levelRank = repRow.level ?? repRow.rank
	if (!card.attack) card.attack = repRow.atk 
	if (!card.defense) card.defense = repRow.def 
	if (!card.pendScale) card.pendScale = repRow.pendulum_scale
	// Link markers are stored as a string, each character is a number
	// indicating the position of the marker (starting at bottom left).
	if (repRow.link_arrows && !card.linkMarkers.length)
		for (let i = 0; i < repRow.link_arrows.length; i++)
			card.linkMarkers.push(parseInt(repRow.link_arrows.charAt(i), 10))
	// Grab monster types from the junction table if necessary.
	if (card.cardType === 'monster' && !card.types.length) {
		const getCardTypes = `SELECT property FROM card_properties
							  WHERE cardId = ? AND locale = 'en'
							  ORDER BY position`
		const typeRows = konamiDb.prepare(getCardTypes).all(card.dbId)
		for (const r of typeRows) card.types.push(r.property)
	}

	// Gather print data.
	const getPrintData = `SELECT printCode, printDate, locale 
						  FROM card_prints WHERE cardId = ?
						  ORDER BY printDate`
	const printRows = konamiDb.prepare(getPrintData).all(card.dbId)
	for (const r of printRows) {
		// Sometimes Konami DB messes up and puts a nbsp in something's print date...
		if (r.printDate === '&nbsp;') continue

		const printsInLocale = card.printData.get(r.locale)

		if (printsInLocale) printsInLocale.set(r.printCode, r.printDate)
		else {
			card.printData.set(r.locale, new Map())
			card.printData.get(r.locale).set(r.printCode, r.printDate)
		}
	}

	// Gather banlist data.
	const getBanlistData = 'SELECT cg, copies FROM banlist WHERE cardId = ?'
	const banlistRows = konamiDb.prepare(getBanlistData).all(card.dbId)
	for (const r of banlistRows) {
		if (r.cg === 'tcg') card.tcgList = r.copies
		else if (r.cg === 'ocg') card.ocgList = r.copies
	}

	// Gather art data if necessary.
	const getArtData = 'SELECT artId, artwork FROM card_artwork WHERE cardId = ?'
	const artRows = konamiDb.prepare(getArtData).all(card.dbId)
	for (const r of artRows) 
		card.addImageData(r.artId, r.artwork)

	// TODO: Gather pricing data.
}

/**
 * Runs the Python scripts to update our local cached Konami database.
 */
async function updateKonamiDb() {
	const updateKonami = new PythonShell(`${process.cwd()}/data/carddata.py`, { pythonOptions: '-u', args: KONAMI_DB_PATH })
	updateKonami.on('message', msg => console.log(msg))

	await new Promise((resolve, reject) => {
		updateKonami.end(err => {
			if (err) reject(err)

			logger.info('Updated Konami database.')

			logger.info('Regenerating Konami DB FTS index...')
			konamiDb.prepare('INSERT INTO cards_idx(cards_idx) VALUES (\'rebuild\')').run()
			logger.info('Done regenerating FTS index.')

			resolve()
		})
	}).catch(err => logError(err, 'Failed to update Konami database.'))

	const updateNeuron = new PythonShell(`${process.cwd()}/data/neuron_crawler.py`, { pythonOptions: '-u', args: [ NEURON_DB_PATH, KONAMI_DB_PATH ] })
	updateNeuron.on('message', msg => console.log(msg))

	await new Promise((resolve, reject) => {
		updateNeuron.end(err => {
			if (err) reject(err)

			logger.info('Updated Neuron artwork data.')
			
			resolve()
		})
	}).catch(err => logError(err, 'Failed to update Neuron data.'))
}

module.exports = {
	searchKonamiDb, populateCardFromKonamiData, updateKonamiDb
}