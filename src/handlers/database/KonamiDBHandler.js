const Database = require('better-sqlite3')
const Card = require('lib/models/Card')

const { KONAMI_DB_PATH } = require('lib/models/Defines')
const { Search, Query } = require('lib/models/Query')
// const { addToTermCache } = require('./BotDBHandler')
const { searchNameToIdIndex } = require('./YGOrgDBHandler')

/**
 * Search the Konami (i.e., official) database to resolve our card data.
 * @param {Array<Search>} searches The array of relevant searches to evaluate.
 * @param {Query} qry The query that contains all the relevant searches.
 * @param {Database} db Connection to the database that is being used, if any.
 */
function searchKonamiDb(searches, qry, db) {
	if (db === undefined)
		db = new Database(KONAMI_DB_PATH, { readonly: true })

	// Function to fill out card info using the columns returned from the database.
	const formCard = dbRows => {
		const card = new Card()

		// Just use the first row as a representative for all the stats that aren't language-sensitive.
		const repRow = dbRows[0]
		
		// Map language-sensitive rows.
		for (const r of dbRows) {
			card.name.set(r.locale, r.name)
			card.effect.set(r.locale, r.effect_text)
			if (r.pendulum_text)
				card.pendEffect.set(r.locale, r.pendulum_text)
		}
		card.dbId = repRow.id
		card.cardType = repRow.card_type
		card.property = repRow.en_property
		card.attribute = repRow.en_attribute
		card.levelRank = repRow.level ?? repRow.rank
		card.attack = repRow.atk 
		card.defense = repRow.def 
		card.pendScale = repRow.pendulum_scale
		// Link markers are stored as a string, each character is a number
		// indicating the position of the marker (starting at bottom left).
		if (repRow.link_arrows)
			for (let i = 0; i < repRow.link_arrows.length; i++)
				card.linkMarkers.push(parseInt(repRow.link_arrows.charAt(i), 10))
		// Grab monster types from the junction table if necessary.
		if (card.cardType === 'monster') {
			const getCardTypes = `SELECT property FROM card_properties
								  WHERE cardId = ? AND locale = 'en'
								  ORDER BY position`
			const typeRows = db.prepare(getCardTypes).all(card.dbId)
			for (const r of typeRows) card.types.push(r.property)
		}

		// Gather print data.
		const getPrintData = `SELECT printCode, printDate, locale 
							  FROM card_prints WHERE cardId = ?
							  ORDER BY printDate`
		const printRows = db.prepare(getPrintData).all(card.dbId)
		for (const r of printRows) {
			const printsInLocale = card.printData.get(r.locale)

			if (printsInLocale) printsInLocale.set(r.printCode, r.printDate)
			else {
				card.printData.set(r.locale, new Map())
				card.printData.get(r.locale).set(r.printCode, r.printDate)
			}
		}

		// Gather banlist data.
		const getBanlistData = 'SELECT cg, copies FROM banlist WHERE cardId = ?'
		const banlistRows = db.prepare(getBanlistData).all(card.dbId)
		for (const r of banlistRows) {
			if (r.cg === 'tcg') card.tcgList = r.copies
			else if (r.cg === 'ocg') card.ocgList = r.copies
		}

		// TODO: Gather image data.

		// TODO: Gather pricing data.

		return card
	}

	const getDbId = db.prepare('SELECT * FROM card_data WHERE id = ?')
	// Iterate through the array backwards because we might modify it as we go.
	for (let i = searches.length - 1; i >= 0; i--) {
		const currSearch = searches[i]
		// If the search term is a number, then it's a database ID.
		if (Number.isInteger(currSearch.term)) {
			const dataRows = getDbId.all(currSearch.term)
			if (dataRows.length) currSearch.data = formCard(dataRows)
		}
		else {
			// Otherwise, try to match based on the name index.
			// Always search the EN index. If this search has any other languages, use them too.
			const lansToSearch = ['en']
			currSearch.lanToTypesMap.forEach((types, lan) => {
				if (!lansToSearch.includes(lan)) lansToSearch.push(lan)
			})

			const termsToUpdate = []

			const bestMatch = searchNameToIdIndex(currSearch.term, lansToSearch)
			for (const id in bestMatch) {
				const dataRows = getDbId.all(id)
				if (dataRows.length) {
					currSearch.data = formCard(dataRows)
					// We should have a better search term now.
					if (currSearch.data.dbId) {
						const mergedSearch = qry.updateSearchTerm(currSearch.term, currSearch.data.dbId)
						if (!mergedSearch)
							termsToUpdate.push(currSearch)
					}
				}
			}

			if (termsToUpdate.length) {
				// Down here to avoid circular dependency. Not very pretty...
				const { addToTermCache } = require('./BotDBHandler')
				addToTermCache(termsToUpdate, 'konami')
			}
		}
	}
}

module.exports = {
	searchKonamiDb
}