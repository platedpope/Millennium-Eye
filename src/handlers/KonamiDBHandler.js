const Database = require('better-sqlite3')

const { KONAMI_DB_PATH, MASTER_DUEL_API, API_TIMEOUT } = require('lib/models/Defines')
const Card = require('lib/models/Card')
const { PythonShell } = require('python-shell')
const { logger, logError } = require('lib/utils/logging')

const _konamiDb = new Database(KONAMI_DB_PATH)

/**
 * Gathers the banlist status of a card.
 * @param {Card} card The card to find the banlist status of. Must have a database ID. 
 */
function getBanlistStatus(card) {
	// If we don't have a database ID, nothing to look up.
	if (card.dbId === null) return

	const getBanlistStatusQuery = 'SELECT cg, copies FROM banlist WHERE cardId = ?'
	const banlistRows = _konamiDb.prepare(getBanlistStatusQuery).all(card.dbId)
	for (const r of banlistRows) {
		if (r.cg === 'tcg') card.tcgList = r.copies
		else if (r.cg === 'ocg') card.ocgList = r.copies
		else if (r.cg === 'md') card.mdList = r.copies
	}
}

/**
 * Runs underlying Python scripts to scrape the Konami database for data.
 * Those scripts used to scrape all card data since the bot's primary data source was the official DB,
 * but now that its primary source is YGOResources DB, all the scripts do is update the banlist information, which is the last dependency on the Konami DB.
 */
async function updateKonamiDb() {
	const updateKonami = new PythonShell(`${process.cwd()}/data/carddata.py`, { pythonOptions: '-u', args: KONAMI_DB_PATH })
	updateKonami.on('message', msg => console.log(msg))

	await new Promise((resolve, reject) => {
		updateKonami.end(err => {
			if (err) reject(err)

			logger.info('Updated Konami banlist data.')

			resolve()
		})
	}).catch(err => logError(err, 'Failed to update Konami banlist data.'))

	// Update Master Duel banlist details by parsing through the whole card list.
	// First get the number of cards so we know how many paged requests to send.
	try {
		var req = await fetch(`${MASTER_DUEL_API}/cards?collectionCount=true`, { signal: AbortSignal.timeout(API_TIMEOUT) })
	} 
	catch(err) {
		await logError(err, `Master Duel Meta API query for collection count returned error.`)
		return
	}

	const totalCards = await req.json()
	if (totalCards) {
		const PAGE_LIMIT = 3000
		const numPages = Math.ceil(totalCards / PAGE_LIMIT)
		let cardData = []

		logger.info(`Gathering Master Duel banlist data from ${totalCards} cards...`)
		const cardDataRequests = []
		for (let pageNum = 1; pageNum <= numPages; pageNum++) {
			cardDataRequests.push(
				fetch(`${MASTER_DUEL_API}/cards?limit=${PAGE_LIMIT}&page=${pageNum}`, { signal: AbortSignal.timeout(API_TIMEOUT) })
					.then(async r => {
						const jsonResponse = await r.json()
						cardData.push(...Object.values(jsonResponse))
					})
					.catch(err => {
						logError(err.message, `Master Duel Meta API query encountered error on page ${pageNum}.`)
					})
				)
		}

		await Promise.allSettled(cardDataRequests)

		const foundCards = Object.keys(cardData).length
		if (foundCards !== totalCards) {
			logError(null, `Master Duel Meta API query parsing returned ${foundCards}/${totalCards} cards. Exiting early because that result does not match expectations.`)
			return
		}

		const mdListToNumberMap = {
			'Forbidden': 0,
			'Limited 1': 1,
			'Limited 2': 2,
			'null': 3
		}
		
		const cardListData = {}
		for (const data of Object.values(cardData)) {
			// Only care about cards with a database ID.
			const dbId = data['gameId']
			if (dbId) {
				if ('banStatus' in data) {
					cardListData[dbId] = mdListToNumberMap[data['banStatus']]
				}
				// The nameRelease and release fields in Master Duel API are both absent or null for cards that aren't released in Master Duel.
				else if (!(data['nameRelease']) && !(data['release'])) {
					// Ignore cards we've seen before, some API data is incomplete and this entry with no releases is probably not better than what we saw before.
					if (!(dbId in cardListData)) {
						// Track unreleased MD cards as -1 in our banlist data.
						cardListData[dbId] = -1
					}
				}
				else {
					// This card has no banStatus set, but it does have a release date. Assume it's at 3.
					cardListData[dbId] = 3
				}
			}
		}
		const affectedCards = Object.entries(cardListData).filter(data => data[1] !== 3)

		const removeMdBanStatus = _konamiDb.prepare('DELETE FROM banlist WHERE cg = ?')
		const insertMdBanStatus = _konamiDb.prepare(`
			INSERT OR REPLACE INTO banlist(cg, cardId, copies)
			VALUES(?, ?, ?)
		`)
		let updateMdBanStatus = _konamiDb.transaction(cards => {
			// Clear all MD data before inserting new.
			removeMdBanStatus.run('md')
			for (const c of cards) insertMdBanStatus.run(['md', ...c])
		})
		updateMdBanStatus(affectedCards)

		logger.info('Done gathering Master Duel banlist info.')
	}
}

module.exports = {
	getBanlistStatus, updateKonamiDb
}