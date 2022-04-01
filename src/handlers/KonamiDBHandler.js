const Database = require('better-sqlite3')
const PythonShell = require('python-shell').PythonShell

const { searchNameToIdIndex } = require('./YGOrgDBHandler')
const { KONAMI_DB_PATH, NEURON_DB_PATH } = require('lib/models/Defines')
const { logger, logError } = require('lib/utils/logging')

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
	const termsToUpdate = []

	const getDbId = konamiDb.prepare('SELECT * FROM card_data WHERE id = ?')
	// Iterate through the array backwards because we might modify it as we go.
	for (let i = searches.length - 1; i >= 0; i--) {
		const currSearch = searches[i]
		
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
			for (const id in bestMatch) {
				const score = bestMatch[id]
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
							termsToUpdate.push(currSearch)
						}
					}
				}
			}
		}
	}

	dataHandlerCallback(resolvedSearches, termsToUpdate)
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
	konamiDb, searchKonamiDb, updateKonamiDb
}