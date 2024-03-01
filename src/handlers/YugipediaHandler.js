const { YUGIPEDIA_API, YUGIPEDIA_API_PARAMS, API_TIMEOUT, Locales, LinkMarkersIndexMap } = require('lib/models/Defines')
const { logError, logger } = require('lib/utils/logging')
const { findYugipediaProperty } = require('lib/utils/regex')
const Search = require('lib/models/Search')
const Query = require('lib/models/Query')

/**
 * Search using MediaWiki API on Yugipedia to resolve the given searches.
 * If any match is found, we use its data to first backcheck in the bot and Konami databases
 * to make sure it's not in there and was missed due to a new search term.
 * @param {Array<Search>} searches The array of searches to evaluate.
 * @param {Query} qry The query that contains all searches to evaluate.
 * @param {Function} dataHandlerCallback The callback for handling the data produced by this search.
 */
async function searchYugipedia(searches, qry, dataHandlerCallback) {
	// Nothing to check beforehand, if we got this far just send requests right away.
	let apiReqs = []
	for (const s of searches) {
		YUGIPEDIA_API_PARAMS.gsrsearch = s.term
		const req = fetch(`${YUGIPEDIA_API}?` + new URLSearchParams(YUGIPEDIA_API_PARAMS), { signal: AbortSignal.timeout(API_TIMEOUT) })
			.then(async r => await r.json())
			.catch(err => {
				throw new Error(err.message, `Yugipedia API query for term ${s.term} failed.`)
			})

		apiReqs.push(req)
	}
	// Reset the search in the API parameters.
	delete YUGIPEDIA_API_PARAMS.gsrsearch

	if (apiReqs.length) 
		apiReqs = await Promise.allSettled(apiReqs)

	for (let i = 0; i < apiReqs.length; i++) {
		const apiResponse = apiReqs[i]
		if (apiResponse.status === 'rejected') {
			continue
		}
		// These promises return in the same order we sent the requests.
		// Map this response to its corresponding search that way.
		const apiSearch = searches[i]

		const responseData = apiResponse.value
		if (responseData && Object.keys(responseData).length) 
			if ('query' in responseData) {
				const qryData = responseData.query
				apiSearch.rawData = qryData
			}
		if (apiSearch.rawData === undefined)
			logger.info(`Yugipedia API query for term ${apiSearch.term} found nothing.`)
	}

	dataHandlerCallback(searches, qry)
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
				if (lookup !== null) card.levelRank = lookup
				else {
					lookup = findYugipediaProperty('rank', revData, true)
					if (lookup !== null) card.levelRank = lookup
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
		card.addImageData(100, imageData.source, true)
	}
}

module.exports = {
	searchYugipedia, populateCardFromYugipediaApi
}