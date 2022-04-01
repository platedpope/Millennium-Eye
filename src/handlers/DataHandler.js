const Card = require('lib/models/Card')
const Query = require('lib/models/Query')
const Ruling = require('lib/models/Ruling')
const Search = require('lib/models/Search')
const { Locales, LinkMarkersIndexMap } = require('lib/models/Defines')
const { logError } = require('lib/utils/logging')
const { findYugipediaProperty } = require('lib/utils/regex')
const { botDb, addToTermCache, addToBotDb } = require('./BotDBHandler')
const { konamiDb, searchKonamiDb } = require('./KonamiDBHandler')
const { ygorgDb, addToYgorgDb, searchArtworkRepo, searchPropertyArray } = require('./YGOrgDBHandler')

/**
 * Define the rows associated with the Bot DB dataCache table.
 * @typedef {Object} botDataCacheRow
 * @property {String} dataName
 * @property {String} locale
 * @property {Number} dbId
 * @property {Number} passcode
 * @property {String} cardType
 * @property {String} attribute
 * @property {Number} levelRank
 * @property {Number} attack
 * @property {Number} defense
 * @property {String} effect
 * @property {String} pendEffect
 * @property {Number} pendScale
 * @property {Boolean} notInCg
 */

/** 
 * Define the rows associated with the Konami DB card_data table.
 * @typedef {Object} konamiCardDataRow
 * @property {Number} id
 * @property {String} locale
 * @property {String} name
 * @property {String} card_type
 * @property {String} en_attribute
 * @property {String} effect_text
 * @property {Number} level
 * @property {Number} atk
 * @property {Number} def
 * @property {String} en_property
 * @property {String} pendulum_text
 * @property {Number} rank
 * @property {String} link_arrows 
 */

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
 * Populates a Card's data with data from the bot database.
 * This function will not overwrite any data that already exists in the Card that is passed.
 * @param {Array<botDataCacheRow>} dbRows Rows of data returned from the dataCache bot DB table.
 * @param {Card} card The card with data to populate.
 */
 function populateCardFromBotData(dbRows, card) {
	// Just use the first row as a representative for all the stats that aren't locale-sensitive.
	const repRow = dbRows[0]
	
	// Map locale-sensitive rows.
	for (const r of dbRows) {
		if (!card.name.get(r.locale)) card.name.set(r.locale, r.dataName)
		if (!card.name.get(r.locale)) card.effect.set(r.locale, r.effect)
		if (r.pendEffect && !card.pendEffect.get(r.locale))
			card.pendEffect.set(r.locale, r.pendEffect)
	}
	if (!card.dbId) card.dbId = repRow.dbId
	if (!card.passcode) card.passcode = repRow.passcode
	if (!card.cardType) card.cardType = repRow.cardType
	if (!card.property) card.property = repRow.property
	if (!card.attribute) card.attribute = repRow.attribute
	if (!card.levelRank) card.levelRank = repRow.levelRank
	if (!card.attack) card.attack = repRow.attack
	if (!card.defense) card.defense = repRow.defense
	if (!card.pendScale) card.pendScale = repRow.pendScale
	if (!card.notInCg) card.notInCg = repRow.notInCg	

	// Grab junction table values too. We can search in those based on DB ID, passcode, or name.
	// Change what we're searching for based on what values we have:
	// - if we have DB ID, use that,
	// - if no DB ID but we have passcode, use that,
	// - use name as a last resort.
	if (card.dbId) {
		var where = 'WHERE dbId = ?'
		var searchParam = card.dbId
	}
	else if (card.passcode) {
		where = 'WHERE passcode = ?'
		searchParam = card.passcode
	}
	else {
		where = 'WHERE name = ?'
		searchParam = card.name
	}

	const getCardTypes = `SELECT type FROM cardDataTypes ${where}`
	const getLinkMarkers = `SELECT marker FROM cardDataLinkMarkers ${where}`

	// If this is a monster, get its types.
	if (card.cardType === 'monster') {
		let isLink = false
		const typeRows = botDb.prepare(getCardTypes).all(searchParam)
		for (const r of typeRows) {
			card.types.push(r.type)
			if (!isLink && r.type === 'Link') isLink = true
		}

		// If this is a Link Monster, get its markers.
		if (isLink) {
			const markerRows = botDb.prepare(getLinkMarkers).all(searchParam)
			for (const r of markerRows) card.linkMarkers.push(r.marker)
		}
	}

	// Gather art data.
	const getImages = `SELECT artId, artPath FROM cardDataImages ${where}`
	const imageRows = botDb.prepare(getImages).all(searchParam)
	for (const r of imageRows) {
		const localPath = r.artPath.includes('data/card_images')
		card.addImageData(r.artId, r.artPath, localPath, !localPath)
	}
	
	// Gather print data.
	const getPrints = `SELECT printCode, locale, printDate FROM cardDataPrints ${where}`
	const printRows = botDb.prepare(getPrints).all(searchParam)
	for (const r of printRows) {
		const printsInLocale = card.printData.get(r.locale)

		if (printsInLocale) printsInLocale.set(r.printCode, r.printDate)
		else {
			card.printData.set(r.locale, new Map())
			card.printData.get(r.locale).set(r.printCode, r.printDate)
		}
	}

	// TODO: Gather pricing information as well.
}

/**
 * This is the callback data handler for turning data from the konami database into
 * usable Search data (in this case, a Card object).
 * @param {Array<Search>} resolvedSearches Searches that were resolved during this run of the bot database. 
 * @param {Array<Search>} termUpdates Searches for which we found better search terms that should be updated.
 */
function convertKonamiDataToSearchData(resolvedSearches, termUpdates) {
	for (const s of resolvedSearches) {
		if (!(s.data instanceof Card)) s.data = new Card()
		populateCardFromKonamiData(s.rawData, s.data)
		s.rawData = undefined
	}

	if (termUpdates.length)
		addToTermCache(termUpdates, 'konami')
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
		card.addImageData(r.artId, r.artwork, true)

	// TODO: Gather pricing data.
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
		await populateRulingAssociatedCardsData(convertedRuling, [...s.localeToTypesMap.keys()])
	}
	for (const s of qaSearches.api) {
		s.data = new Ruling()
		populatedRulingFromYgorgApi(s.rawData, s.data)
		s.rawData = undefined
		await populateRulingAssociatedCardsData(convertedRuling, [...s.localeToTypesMap.keys()])
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
 * Populates a Ruling's data with data from the local YGOrg DB.
 * @param {Array} dbRows Rows of data returned from the qaData YGOrg DB table.
 * @param {Ruling} ruling The ruling to populate with data.
 */
function populateRulingFromYgorgDb(dbRows, ruling) {
	// Just use the first row as a representative for all the data that isn't locale-sensitive.
	const repRow = dbRows[0]

	// Map locale-sensitive data.
	for (const r of dbRows) {
		ruling.title.set(r.locale, r.title)
		ruling.question.set(r.locale, r.question)
		ruling.answer.set(r.locale, r.answer)
		ruling.date.set(r.locale, r.date)
	}
	ruling.id = repRow.qaId

	// Grab any associated cards from the junction table.
	const dbCards = ygorgDb.prepare('SELECT * FROM qaCards WHERE qaId = ?').all(ruling.id)
	if (dbCards.length)
		for (const c of dbCards)
			ruling.cards.push(c.cardId)
}

/**
 * Populates a Ruling's data with data from the YGOrg DB API.
 * @param {Object} apiData The API data returned from the YGOrg API for this ruling ID.
 * @param {Ruling} ruling The ruling to populate with data.
 */
function populatedRulingFromYgorgApi(apiData, ruling) {
	const qaData = apiData.qaData
	for (const locale in qaData) {
		// For some reason QA IDs are buried in each locale. Just use the first one we come across,
		// the rest are always the same.
		if (!ruling.id) ruling.id = qaData[locale].id

		ruling.title.set(locale, qaData[locale].title)
		ruling.question.set(locale, qaData[locale].question)
		ruling.answer.set(locale, qaData[locale].answer)
		ruling.date.set(locale, qaData[locale].thisSrc.date)
	}

	ruling.cards = apiData.cards
	ruling.tags = apiData.tags
}

/**
 * Populates a Ruling's associated cards (stored as database IDs) with actual Card data.
 * @param {Ruling} ruling The ruling with cards to convert.
 * @param {Array<String>} locales The locales that the ruling was queried in, so we can attempt to match these for the cards as well.
 */
async function populateRulingAssociatedCardsData(ruling, locales) {
	// This is in here to avoid a circular dependency. Not ideal, but easy.
	const { processSearches } = require('handlers/QueryHandler')
	
	const cardSearches = []
	for (const cid of ruling.cards) {
		const newSearch = new Search(cid)
		for (const l of locales)
			// Type doesn't matter, but we need to track the important locales for this search.
			newSearch.addTypeToLocale('i', l)
		cardSearches.push(newSearch)
	}

	await processSearches(cardSearches)

	const convertedCardData = []
	for (const s of cardSearches) 
		convertedCardData.push(s.data)
	
	ruling.cards = convertedCardData
}

/**
 * Populates a Card's data with data from the YGOrg DB API.
 * This function will not overwrite any data that is already present in the Card that is passed.
 * @param apiData The response from a card data API query on the YGOrg DB. 
 * @param {Card} card The card to set data for. 
 */
 function populateCardFromYgorgApi(apiData, card) {
	// Database ID is at the uppermost level.
	card.dbId = apiData.cardId
	// Descend into card data to populate all the fields we can.
	const apiCardData = apiData.cardData
	if (apiCardData) {
		for (const locale in apiCardData) {
			const localeCardData = apiCardData[locale]
			// Map the locale-specific values.
			if (!card.name.has(locale)) card.name.set(locale, localeCardData.name)
			if (!card.effect.has(locale)) card.effect.set(locale, localeCardData.effectText)
			if ('pendulumEffectText' in localeCardData)
				if (!card.pendEffect.has(locale)) card.pendEffect.set(locale, localeCardData.pendulumEffectText)
			// Parse print dates too.
			if ('prints' in localeCardData) {
				const apiPrints = localeCardData.prints
				if (!card.printData.has(locale)) card.printData.set(locale, new Map())
				for (const p of apiPrints)
					card.printData.get(locale).set(p.code, p.date)
			}
			// Some non-locale-specific values are repeated per locale. Just use them the first time we see them.
			if (!card.cardType) card.cardType = localeCardData.cardType
			// Parse monster-specific stats.
			if (card.cardType === 'monster') {
				if (!card.attribute && 'attribute' in localeCardData) card.property = localeCardData.attribute
				if (!card.levelRank && !card.linkMarkers.length) {
					if ('level' in localeCardData) card.levelRank = localeCardData.level
					else if ('rank' in localeCardData) card.levelRank = localeCardData.rank
					else if ('linkArrows' in localeCardData) {
						const arrows = localeCardData.linkArrows
						for (let i = 0; i < arrows.length; i++)
							card.linkMarkers.push(parseInt(arrows.charAt(i), 10))	
					}
				}
				if (!card.types.length && 'properties' in localeCardData)
					for (const prop of localeCardData.properties)
						card.types.push(searchPropertyArray(prop, 'en'))
				if (!card.attack && 'atk' in localeCardData) card.attack = localeCardData.atk
				if (!card.defense && 'def' in localeCardData) card.defense = localeCardData.def
				if (!card.pendScale && 'pendulumScale' in localeCardData) card.pendScale = localeCardData.pendulumScale
			}
			// Parse Spell/Trap specific stats.
			else {
				if (!card.property && 'property' in localeCardData) card.property = localeCardData.property
			}
			
		}
	}
	// YGOrg API also returns FAQ data for card queries, may as well populate that while we're here too.
	const apiFaqData = apiData.faqData
	if (apiFaqData) {
		for (const entry of apiFaqData.entries)
			for (const locale in entry) {
				if (!card.faqData.has(locale)) card.faqData.set(locale, [])
				card.faqData.get(locale).push(entry[locale])
			}
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

/**
 * Populates a Card's data with data from the Yugipedia API.
 * This function will not overwrite any data that is already present in the Card that is passed.
 * @param apiData The data of the page that was chosen from the Yugipedia API. 
 * @param {Card} card The card to set data for. 
 */
 function populateCardFromYugipediaApi(apiData, card) {
	if ('categories' in apiData) {
		const categories = apiData.categories
		// Categories can tell us a lot about where this card has been released.
		let hasOcgCategory = false
		let hasTcgCategory = false
		for (const c of categories) {
			if (c.title === 'Category:Anime cards' ||
				c.title === 'Category:Manga cards' ||
				c.title === 'Category.Video game cards with no OCG/TCG counterpart')
			{
				// Any of these categories automatically mean a card isn't in any CG.
				card.notInCg = true
				// Reset these in case we found something wrong beforehand.
				hasOcgCategory = false
				hasTcgCategory = false
				break
			}
			else if (c.title === 'Category:OCG cards') {
				hasOcgCategory = true
			}
			else if (c.title === 'Category:TCG cards') {
				hasTcgCategory = true
			}
			/* Not monitoring Rush Duel data yet.
			else if (c.title === 'Category:Rush Duel cards') {
				card.rushDuel = true
			}
			*/
		}

		if (!hasOcgCategory)
			card.ocgList = -1
		if (!hasTcgCategory)
			card.tcgList = -1
	}
	if ('revisions' in apiData) {
		// This is the wikitext (i.e., data) associated with the page. 
		let revData = apiData.revisions[0]['content']
		// Welcome to parsing hell. First, strip out all the useless garbage wikitext formatting.
		revData = revData.replace(/(\[\[[^\]\]]*\|)|(\]\])|(\[)/gs, '')	// Forgive me father, I have sinned.
			.replace(/<br\s*\/?>/gs, '\n')
			.replace(/{{PAGENAME}}/gs, apiData.title)
			.replace(/<.*?>/gs, '')

		// Name(s)
		// EN name is always the title of the page.
		if (!card.name.get('en'))
			card.name.set('en', apiData.title)
		// Go through the other locales.
		for (const loc in Locales) {
			if (card.name.get(loc)) continue
			if (loc === 'en') continue
			
			let locName = findYugipediaProperty(`${loc}_name`, revData)
			if (locName) {
				// Japanese name needs additional parsing, special case it.
				// It's a goddamn mess due to furigana, which Yugipedia represents with
				// "{{Ruby|<base>|<furigana>}}".
				if (loc === 'ja') {
					const jaRegex = /(?:{{Ruby\|(.+?)\|.*?}}|([^{}]+))/gm
					const matches = [...locName.matchAll(jaRegex)]
					// Taking the capture groups in order will give us the base characters we need, in order.
					let jaName = ''
					for (const m of matches) {
						const goodMatch = m[1] ?? m[2]
						jaName += goodMatch
					}
					locName = jaName
				}

				card.name.set(loc, locName)
			}
		}
		// Database ID
		if (!card.notInCg && !card.dbId) {
			card.dbId = findYugipediaProperty('database_id', revData, true)
		}
		// Passcode
		if (!card.passcode) {
			card.passcode = findYugipediaProperty('password', revData, true)
		}
		// Effect(s)
		// EN effect is "lore", while the others are "<locale>_lore".
		if (!card.effect.get('en')) {
			let enEffect = findYugipediaProperty('lore', revData)
			if (enEffect)
				card.effect.set('en', enEffect)
		}
		// Go through the other locales.
		for (const loc in Locales) {
			if (card.effect.get(loc)) continue
			if (loc === 'en') continue

			let locEffect = findYugipediaProperty(`${loc}_lore`, revData)
			if (locEffect)
				card.effect.set(loc, locEffect)
		}
		// Card Type (only appears for Spells/Traps)
		if (!card.cardType) {
			let cardType = findYugipediaProperty('card_type', revData)
			if (cardType) {
				card.cardType = cardType.toLowerCase()
				// Property (also only appears for Spells/Traps)
				let property = findYugipediaProperty('property', revData)
				if (property) {
					property = property.toLowerCase()
					// Yugipedia stores Quick-Play spell property as "Quick-Play", but the bot uses "quickplay".
					if (property === 'quick-play')
						property = 'quickplay'
					card.property = property
				}
			}
			// Assuming everything else with an effect is a monster.
			else if (card.effect.size)
				card.cardType = 'monster'
		}
		// Now that we know whether something is a monster, check monster-specific fields.
		if (card.cardType === 'monster') {
			// Monster Types
			if (!card.types.size) {
				let types = findYugipediaProperty('types', revData)
				if (types)
					// Yugipedia formats Monster Types as a single line, separated with slashes, but the bot uses an array.
					card.types = types.split(' / ')
			}
			// Attribute
			if (!card.attribute) {
				let attribute = findYugipediaProperty('attribute', revData)
				if (attribute)
					// Yugipedia formats Attribute in all caps, but the bot uses all lowercase.
					card.attribute = attribute.toLowerCase()
			}
			// Level, Rank, Link Markers
			if (!card.levelRank || !card.linkMarkers.length) {
				let lookup = findYugipediaProperty('level', revData, true)
				if (lookup) card.levelRank = lookup
				else {
					lookup = findYugipediaProperty('rank', revData, true)
					if (lookup) card.levelRank = lookup
					else {
						lookup = findYugipediaProperty('link_arrows', revData)
						if (lookup) {
							// Yugipedia formats Link Markers as a single line, by named location (e.g. Bottom-Left), separated by commas,
							// but the bot expects an array of numbers (starting at 1 in bottom left).
							for (const marker of lookup.split(', '))
								card.linkMarkers.push(LinkMarkersIndexMap[marker])
						}
					}
				}
			}
			// ATK
			if (!card.attack) {
				card.attack = findYugipediaProperty('atk', revData, true)
			}
			// DEF
			if (!card.defense) {
				card.defense = findYugipediaProperty('def', revData, true)
			}
			// Pendulum Effect(s)
			// EN effect is "pendulum_effect", while the others are "<locale>_pendulum_effect".
			if (!card.pendEffect.get('en')) {
				let enEffect = findYugipediaProperty('pendulum_effect', revData)
				if (enEffect)
					card.pendEffect.set('en', enEffect)
			}
			// Go through the other locales.
			for (const loc in Locales) {
				if (card.pendEffect.get(loc)) continue
				if (loc === 'en') continue

				let locEffect = findYugipediaProperty(`${loc}_pendulum_effect`, revData)
				if (locEffect)
					card.pendEffect.set(loc, locEffect)
			}
			// Pendulum Scale
			if (!card.pendScale) {
				card.pendScale = findYugipediaProperty('pendulum_scale', revData, true)
			}
		}
		// Fill out Rush Duel fields if necessary.
		/* Not doing this yet. I can't be bothered.
		if (card.rushDuel) {
			// Requirement
			// EN effect is "requirement", while the others are "<locale>_requirement".
			if (!card.requirement.get('en')) {
				let enRequirement = findYugipediaProperty('requirement', revData)
				if (enRequirement)
					card.requirement.set('en', enRequirement)
			}
			// Go through the other locales.
			for (const loc in Locales) {
				if (card.requirement.get(loc)) continue
				if (loc === 'en') continue

				let locRequirement = findYugipediaProperty(`${loc}_requirement`, revData)
				if (locRequirement)
					card.requirement.set(loc, locRequirement)
			}
			// Summoning Condition
			// EN is "summonong_condition", while the others are "<locale>_summoning_condition".
			if (!card.summCond.get('en')) {
				let enSummCond = findYugipediaProperty('summoning_condition', revData)
				if (enSummCond)
					card.summCond.set('en', enSummCond)
			}
			// Go through the other locales.
			for (const loc in Locales) {
				if (card.summCond.get(loc)) continue
				if (loc === 'en') continue

				let locSummCond = findYugipediaProperty(`${loc}_summoning_condition`, revData)
				if (locSummCond)
					card.summCond.set(loc, locSummCond)
			}
			// TODO: Effect Type
			// Maximum ATK
			if (!card.maximumAttack) {
				card.maximumAttack = findYugipediaProperty(`maximum_atk`, revData, true)
			}
		}
		*/
		
		// We could find print dates while we're here, but I really, REALLY don't want to implement that right now.
		// That's a problem for Future Me.
	}
	// Card Art
	if ('original' in apiData) {
		const imageData = apiData.original
		// Use a placeholder art ID (100) for Yugipedia images.
		card.addImageData(100, imageData.source, false, true)
	}
}

module.exports = {
	convertBotDataToSearchData, convertKonamiDataToSearchData, convertYgorgDataToSearchData, convertYugipediaDataToSearchData
}