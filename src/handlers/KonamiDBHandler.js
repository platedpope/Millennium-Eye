const Database = require('better-sqlite3')

const { KONAMI_DB_PATH } = require('lib/models/Defines')
const Card = require('lib/models/Card')
const { PythonShell } = require('python-shell')
const { logger, logError } = require('lib/utils/logging')

const konamiDb = new Database(KONAMI_DB_PATH)

/**
 * Gathers the banlist status of a card.
 * @param {Card} card The card to find the banlist status of. Must have a database ID. 
 */
function getBanlistStatus(card) {
	// If we don't have a database ID, nothing to look up.
	if (card.dbId === null) return

	const getBanlistStatusQuery = 'SELECT cg, copies FROM banlist WHERE cardId = ?'
	const banlistRows = konamiDb.prepare(getBanlistStatusQuery).all(card.dbId)
	for (const r of banlistRows) {
		if (r.cg === 'tcg') card.tcgList = r.copies
		else if (r.cg === 'ocg') card.ocgList = r.copies
		else if (r.cg === 'md') card.mdList = r.copies
	}
}

/**
 * Runs underlying Python scripts to scrape the Konami database for data.
 * Those scripts used to scrape all card data since the bot's primary data source was the official DB,
 * but now that its primary source is YGOrg DB, all the scripts do is update the banlist information, which is the last dependency on the Konami DB.
 */
async function updateKonamiDb() {
	const updateKonami = new PythonShell(`${process.cwd()}/data/carddata.py`, { pythonOptions: '-u', args: KONAMI_DB_PATH })
	updateKonami.on('message', msg => console.log(msg))

	await new Promise((resolve, reject) => {
		updateKonami.end(err => {
			if (err) reject(err)

			logger.info('Updated Konami database.')

			resolve()
		})
	}).catch(err => logError(err, 'Failed to update Konami database.'))
}

module.exports = {
	getBanlistStatus, updateKonamiDb
}