const Database = require('better-sqlite3')
const fs = require('fs')

const { KONAMI_DB_PATH, MASTER_DUEL_API, API_TIMEOUT, MASTER_DUEL_API_RESPONSE_PATH } = require('lib/models/Defines')
const Card = require('lib/models/Card')
const { PythonShell } = require('python-shell')
const { logger, logError } = require('lib/utils/logging')

const _konamiDb = new Database(KONAMI_DB_PATH)

/**
 * Gathers the banlist status of a card.
 * @param {Card} card The card to find the banlist status of. Must have a database ID. 
 */
function getBanlistStatus(card) {
	const getBanlistStatusQuery = 'SELECT cg, copies FROM banlist WHERE cardId = ? OR cardName = ?'
	const banlistRows = _konamiDb.prepare(getBanlistStatusQuery).all(card.dbId, card.name.get('en'))
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
	let cardData = []

	// First, check if we have cached card data from MasterDuelMeta.
	if (fs.existsSync(MASTER_DUEL_API_RESPONSE_PATH)) {
		const cacheStats = fs.statSync(MASTER_DUEL_API_RESPONSE_PATH)

		// Get its last modified time, and stop here if it's newer than ~a day (23 hrs to give some wiggle room for the periodic that updates every 24 hrs). 
		// Assume we don't need to perform any banlist updates if we have a new enough cached result.
		const modTime = new Date(cacheStats.mtime)
		if ((Date.now() - modTime) < 23 * 60 * 60 * 1000) {
			logger.info('Found cached card data from MasterDuelMeta already, using that instead of sending new API request.')
			return

			/* This is test code I wrote for sanity checking the API response. Any card without a DB ID but with a banlist entry would ruin my day.
			const cacheData = fs.readFileSync(MASTER_DUEL_API_RESPONSE_PATH, 'utf-8')
			cardData = JSON.parse(cacheData)

			for (const data of cardData) {
				const cardName = data['name']
				const dbId = data['gameId']

				if (!dbId) {
					if (('release' in data && data['release']) || ('nameRelease' in data && data['nameRelease'])) {
						console.log(`Found card with no DB ID but MD release: ${cardName} (${data['release'] ?? data['nameRelease']})`)
					}
					if ('banStatus' in data) {
						console.log(`Found card with no DB ID but banStatus: ${cardName} (${data['banStatus']})`)
					} 
				}
			}
			*/
		}
	}
	
	// If not, need to send a new API request. Start by geting the number of cards so we know how many paged requests to send.
	try {
		var req = await fetch(`${MASTER_DUEL_API}/cards?collectionCount=true`, { signal: AbortSignal.timeout(API_TIMEOUT) })
	} 
	catch(err) {
		await logError(err, `Master Duel Meta API query for collection count returned error.`)
		return
	}

	const totalCards = await req.json()
	if (!totalCards) return
	
	const PAGE_LIMIT = 3000
	const numPages = Math.ceil(totalCards / PAGE_LIMIT)

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

	const foundCards = cardData.length
	if (foundCards !== totalCards) {
		logError(null, `Master Duel Meta API query parsing returned ${foundCards}/${totalCards} cards. Exiting early because that result does not match expectations.`)
		return
	}
	
	const mdListToNumberMap = {
		'Forbidden': 0,
		'Limited 1': 1,
		'Limited 2': 2,
	}

	// The Master Duel Meta API is not always guaranteed to be up-to-date on OCG-only cards,
	// meaning they won't have a database ID and therefore won't be caught as "unreleased" if we only look for DB ID.
	// So we're going to be forced to track names too as an identifier for cards that may not yet have a MD release.
	// This will end up mapping name -> { id, banlist status }.
	const cardListData = {}

	for (const data of cardData) {
		const cardName = data['name']
		// Sometimes dbId is unset, sometimes it's a blank string. I prefer to store NULL in the database, so I'm making the conversion here.
		const dbId = data['gameId'] || null

		// Just obey the banStatus field if it exists, unless it's set to 3 or null in which case we don't care (no need to track unlimited cards).
		if ('banStatus' in data && data['banStatus'] !== 3 && data['banStatus'] !== null) {
			cardListData[cardName] = { 'dbId': dbId, 'status': mdListToNumberMap[data['banStatus']] }
		}
		// The nameRelease and release fields in Master Duel API are both absent or null for cards that aren't released in Master Duel.
		else if (!(data['nameRelease']) && !(data['release'])) {
			// Ignore cards we've seen before (unless we've previously seen it without a DB ID), 
			// some API data is incomplete and this entry with no releases is probably not better than what we saw before.
			if (!(cardName in cardListData) || (cardName in cardListData && cardListData[cardName]['dbId'] === null)) {
				// Track unreleased MD cards as -1 in our banlist data.
				cardListData[cardName] = { 'dbId': dbId, 'status': -1 }
			}
		}
		// An "else" block here would cover the case that the card has a MD release date but no banStatus set.
		// We just assume such cards are unlimited, and don't need to track them.
	}

	const removeMdBanStatus = _konamiDb.prepare('DELETE FROM banlist WHERE cg = ?')
	const insertMdBanStatus = _konamiDb.prepare(`
		INSERT OR REPLACE INTO banlist(cg, cardId, cardName, copies)
		VALUES(?, ?, ?, ?)
	`)
	let updateMdBanStatus = _konamiDb.transaction(updateData => {
		// Clear all MD data before inserting new.
		removeMdBanStatus.run('md')

		for (const [cardName, data] of Object.entries(updateData)) {
			insertMdBanStatus.run('md', data['dbId'], cardName, data['status'])
		}
	})
	updateMdBanStatus(cardListData)

	// Write the card data we used to make these updates to a cache file.
	fs.writeFileSync(MASTER_DUEL_API_RESPONSE_PATH, JSON.stringify(cardData, null, 2))

	logger.info(`Done setting Master Duel banlist data for ${Object.keys(cardListData).length} cards.`)
}

module.exports = {
	getBanlistStatus, updateKonamiDb
}