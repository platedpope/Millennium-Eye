const fs = require('fs')
const path = require('path')
const sharp = require('sharp')
const sanitize = require('sanitize-filename') 
const { MessageEmbed } = require('discord.js')

const { EmbedIcons, EmbedColors, BanlistStatus, KONAMI_CARD_LINK, KONAMI_REQUEST_LOCALE, LocaleEmojis, KONAMI_QA_LINK, YGORG_CARD_LINK, Locales, LinkMarkersIndexMap } = require('./Defines')
const { searchPropertyArray, searchPropertyToLocaleIndex } = require('handlers/YGOrgDBHandler')
const { logError, breakUpDiscordMessage } = require('lib/utils/logging')
const { findYugipediaProperty } = require('lib/utils/regex')

class Card {
	/**
	 * The Card class has way too many possible properties, 
	 * so this constructor doesn't take any arguments and leaves them to be set manually.
	 * Note not all properties need to be set, but most of them will be for any given card.
	 */
	constructor() {
		// Main values that define a card.
		this.name = new Map()			// Card name. Each key is a locale, with value as the name in that locale.
		this.dbId = null				// Database ID. Unique.
		this.passcode = null			// Passcode. Unique.
		this.cardType = null			// Card type (Monster/Spell/Trap).
		this.property = null			// Property of Spell/Trap Cards (e.g., Quickplay, Continuous, etc.)
		this.types = []					// List of types that compose a monster's typeline (e.g., Spellcaster / Tuner / Pendulum / Effect)
		this.attribute = null			// Monster Attribute (e.g., DARK, WIND, etc.)
		this.levelRank = null			// Monster Level or Rank (only ever one or the other, ? = -1, only relevant for manga/anime cards)
		this.attack = null				// Monster ATK (? = -1)
		this.defense = null				// Monster DEF (? = -1)
		this.effect = new Map()			// Effect text. For Normal Monsters, this is their flavor text instead. Each key is a locale, with value as the effect text in that locale.
		this.pendEffect = new Map()		// Monster Pendulum Effect text. Each key is a locale, with value as the effect text in that locale.							
		this.pendScale = null			// Monster Pendulum Scale value.
		this.linkMarkers = []			// List of Link Monster arrows.

		// Ancillary data about the card.
		this.tcgList = null				// Status on the TCG F/L list (-1 = unreleased, 0 = forbidden, 1 = limited, 2 = semi-limited, anything else = unlimited)
		this.ocgList = null				// Status on the OCG F/L list (same values as above).
		this.notInCg = null				// True if the card isn't from the TCG or OCG; from anime/manga/game instead.
		this.printData = new Map()		// Data about when this card was printed and in which sets. Each key is a locale, with value a further map of print code -> print date.
		this.imageData = new Map()		// Image(s) associated with the card. Each key is an ID, with value a link to that image (either local file or on the web).
		this.priceData = new Map()		// Any price data for this card. Valid keys are 'us' or 'eu', with values being the price data in that region.
		this.faqData = new Map()		// Any FAQ data for this card. Each key is a locale, with value being the FAQ data for that locale.
	}

	/**
	 * Constructs and returns a populated Card object using data from the Bot DB.
	 * This could be a case handled in the constructor, but I didn't want to have a constructor
	 * that was 5 million lines long with multiple special cases. 
	 * @param {Array} dbRows Rows of data returned from the dataCache Bot DB table. 
	 * @param db An existing database connection to the bot DB. 
	 * @returns {Card} The evaluated Card object.
	 */
	static fromBotDb(dbRows, db) {
		const card = new Card()

		// Just use the first row as a representative for all the stats that aren't locale-sensitive.
		const repRow = dbRows[0]
		
		// Map locale-sensitive rows.
		for (const r of dbRows) {
			card.name.set(r.locale, r.dataName)
			card.effect.set(r.locale, r.effect)
			if (r.pendEffect)
				card.pendEffect.set(r.locale, r.pendEffect)
		}
		card.dbId = repRow.dbId
		card.passcode = repRow.passcode
		card.cardType = repRow.cardType
		card.property = repRow.property
		card.attribute = repRow.attribute
		card.levelRank = repRow.levelRank
		card.attack = repRow.attack
		card.defense = repRow.defense
		card.pendScale = repRow.pendScale
		card.notInCg = repRow.notInCg	

		// Need to grab junction table values too.
		// We can search in those based on DB ID, passcode, or name.
		// Change what we're searching for based on what values we have:
		// - if we have DB ID, use that,
		// - if no DB ID but we have passcode, use that,
		// - use name as a last resort.
		if (card.dbId !== null) {
			var where = 'WHERE dbId = ?'
			var searchParam = card.dbId
		}
		else if (card.passcode !== null) {
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
			const typeRows = db.prepare(getCardTypes).all(searchParam)
			for (const r of typeRows) {
				card.types.push(r.type)
				if (!isLink && r.type === 'Link') isLink = true
			}

			// If this is a Link Monster, get its markers.
			if (isLink) {
				const markerRows = db.prepare(getLinkMarkers).all(searchParam)
				for (const r of markerRows) card.linkMarkers.push(r.marker)
			}
		}

		// Gather art data.
		const getImages = `SELECT artId, artPath FROM cardDataImages ${where}`
		const imageRows = db.prepare(getImages).all(searchParam)
		for (const r of imageRows)
			card.imageData.set(r.artId, r.artPath)
		
		// Gather print data.
		const getPrints = `SELECT printCode, locale, printDate FROM cardDataPrints ${where}`
		const printRows = db.prepare(getPrints).all(searchParam)
		for (const r of printRows) {
			const printsInLocale = card.printData.get(r.locale)

			if (printsInLocale) printsInLocale.set(r.printCode, r.printDate)
			else {
				card.printData.set(r.locale, new Map())
				card.printData.get(r.locale).set(r.printCode, r.printDate)
			}
		}
	
		// TODO: Gather pricing information as well.

		return card
	}

	/**
	 * Constructs and returns a populated Card object using data from the Konami DB.
	 * This could be a case handled in the constructor, but I didn't want to have a constructor
	 * that was 5 million lines long with multiple special cases.
	 * This can do work on a card that already has some data, so don't overwrite values outright,
	 * just merge ones we don't already have.
	 * @param {Array} dbRows Rows of data returned from the card_data Konami DB table.
	 * @param {Card} card The card to populate with data.
	 * @param db An existing database connection to the Konami DB. 
	 * @returns {Card} The evaluated Card object.
	 */
	static fromKonamiDb(dbRows, card, db) {
		// Just use the first row as a representative for all the stats that aren't locale-sensitive.
		const repRow = dbRows[0]
		
		card.dbId = repRow.id
		// Map locale-sensitive rows.
		for (const r of dbRows) {
			if (!card.name.has(r.locale)) card.name.set(r.locale, r.name)
			if (!card.effect.has(r.locale)) card.effect.set(r.locale, r.effect_text)
			if (r.pendulum_text)
				if (!card.pendEffect.has(r.locale)) card.pendEffect.set(r.locale, r.pendulum_text)
		}
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
			const typeRows = db.prepare(getCardTypes).all(card.dbId)
			for (const r of typeRows) card.types.push(r.property)
		}

		// Gather print data.
		const getPrintData = `SELECT printCode, printDate, locale 
							  FROM card_prints WHERE cardId = ?
							  ORDER BY printDate`
		const printRows = db.prepare(getPrintData).all(card.dbId)
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
		const banlistRows = db.prepare(getBanlistData).all(card.dbId)
		for (const r of banlistRows) {
			if (r.cg === 'tcg') card.tcgList = r.copies
			else if (r.cg === 'ocg') card.ocgList = r.copies
		}

		// Gather art data if necessary.
		const getArtData = 'SELECT artId, artwork FROM card_artwork WHERE cardId = ?'
		const artRows = db.prepare(getArtData).all(card.dbId)
		for (const r of artRows) 
			card.addImageData(r.artId, r.artwork, true)

		// TODO: Gather pricing data.

		return card
	}
	/**
	 * Takes data from the YGOrg DB and integrates it with a card.
	 * This can do work on a card that already has some data, so it must only merge new data rather 
	 * than reset values.
	 * @param apiData The response from a card data API query on the YGOrg DB. 
	 * @param {Card} card The card to set data for. 
	 */
	static fromYgorgCardApi(apiData, card) {
		card.dbId = apiData.cardId
		if ('cardData' in apiData) {
			const apiCardData = apiData.cardData
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
		if ('faqData' in apiData) {
			const apiFaqData = apiData.faqData
			for (const entry of apiFaqData.entries)
				for (const locale in entry) {
					if (!card.faqData.has(locale)) card.faqData.set(locale, [])
					card.faqData.get(locale).push(entry[locale])
				}
		}
	}

	/**
	 * 
	 * @param {*} apiData 
	 * @param {Card} card 
	 */
	static fromYugipediaApi(apiData, card) {
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
				// Skip parsing Japanese name, just looking at that thing's wikitext gives me a headache.
				if (loc == 'ja') continue
				
				let locName = findYugipediaProperty(`${loc}_name`, revData)
				if (locName)
					card.name.set(loc, locMatch)
			}
			// Database ID
			if (!card.notInCg && !card.dbId) {
				card.dbId = findYugipediaProperty('database_id', revData, true)
			}
			// Passcode
			if (!card.passcode) {
				card.passcode = findYugipediaProperty('password', revData, true)
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
				// Assume everything else is a monster.
				else card.cardType === 'monster'
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
					let lookup = findYugipediaProperty('level', revData)
					if (lookup) card.levelRank = lookup
					else {
						lookup = findYugipediaProperty('rank', revData)
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
					let enEffect = findYugipediaProperty('pendulum_effect')
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
					card.pendScale = findYugipediaProperty('pendulum_scale')
				}
			}

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

	/**
	 * Generic wrapper for generating any type of embed.
	 * @param {Object} options Relevant options (type, locale, etc.) that are passed on to more specific embed functions.
	 */
	generateEmbed(options) {
		let embedData = {}

		if ('type' in options)
			var type = options.type
		if ('locale' in options)
			var locale = options.locale
		if ('official' in options)
			var official = options.official

		if (type === 'i' || type === 'r') {
			embedData = this.generateInfoEmbed(locale, type === 'r' ? true : false, official)
		}
		else if (type === 'a') {
			embedData = this.generateArtEmbed(locale, official)
		}
		else if (type === 'd') {
			embedData = this.generateDateEmbed(locale, official)
		}

		return embedData
	}

	/**
	 * Generates the base, common information embed for the card.
	 * @param {String} locale Which locale to use when generating the embed.
	 * @param {Boolean} rulings Whether to include additional information relevant to rulings for the card.
	 * @param {Boolean} official Whether to only include official Konami information. This overrides any inclusion from rulings mode being true.
	 */
	generateInfoEmbed(locale, rulings, official) {
		const embedData = {}

		// We shouldn't be here without data for this locale, but do a final sanity check to make sure we leave if so.
		if (!this.name.has(locale))
			return embedData
		
		const finalEmbed = new MessageEmbed()

		const cardName = this.name.get(locale)
		const colorIcon = this.getEmbedColorAndIcon()
		const titleUrl = this.getEmbedTitleLink(locale, official)

		finalEmbed.setAuthor(cardName, colorIcon[1], titleUrl)
		finalEmbed.setColor(colorIcon[0])
		const imageAttach = this.setEmbedImage(finalEmbed)

		// Generate stat description.
		// Level/Rank
		if (this.levelRank !== null) {
			const lrString = this.levelRank >= 1 ? `${this.levelRank}` : '?'
			if (this.types.includes('Xyz'))
				var stats = `${EmbedIcons['Rank']} **${searchPropertyToLocaleIndex('Rank', locale)}**: ${lrString}`
			else
				stats = `${EmbedIcons['Level']} **${searchPropertyToLocaleIndex('Level', locale)}**: ${lrString}`
		}
		// Link Markers
		else if (this.linkMarkers.length) {
			stats = `**Rating**: Link-${this.linkMarkers.length}\t**(**`
			for (const m of this.linkMarkers)
				stats += `${EmbedIcons[m]}`
			stats += '**)**'
		}
		// Pendulum Scale
		if (this.pendScale !== null)
			stats += ` | ${EmbedIcons['Pendulum Scales']} **${searchPropertyToLocaleIndex('Pendulum Scale', locale)}**: ${this.pendScale}`
		// Monster Types
		if (this.types.length) {
			if (locale !== 'en')
				var newLocaleTypes = searchPropertyToLocaleIndex(this.types, locale)
			
			if (locale === 'en' || !newLocaleTypes)
				stats += `\n**[** ${this.types.join(' **/** ')} **]**`
			else
				stats += `\n**[** ${newLocaleTypes.join(' **/** ')} **]**`
		}
		// ATK/DEF (value of -1 means ?)
		if (this.attack !== null) {
			stats += '\n\n'
			const atkStr = this.attack >= 0 ? `${this.attack}` : '?'
			stats += `**ATK** ${atkStr}`
		}
		if (this.defense !== null) {
			const defStr = this.defense >= 0 ? `${this.defense}` : '?'
			stats += ` / **DEF** ${defStr}`
		}

		if (stats)
			finalEmbed.setDescription(stats)

		// Pendulum Effect
		const pendEffect = this.pendEffect.get(locale)
		if (pendEffect)
			finalEmbed.addField(searchPropertyToLocaleIndex('Pendulum Effect', locale), pendEffect, false)
		// Effect
		let effect = this.effect.get(locale)
		if (effect) {
			if (this.types.includes('Normal'))
				effect = `*${effect}*`
			finalEmbed.addField(searchPropertyToLocaleIndex('Effect', locale), effect, false)
		}

		// Display ruling data if necessary. Only do this for cards that are on the database.
		if (rulings && this.dbId) {
			const rulingsText = this.buildRulingsField(locale, official)
			if (rulingsText)
				finalEmbed.addField('Additional Information', rulingsText, false)
		}

		// Put banlist data in the footer.
		let footerString = ''
		// If there's nothing in our effect field, this is some jank data,
		// it's probably not a card at all, so don't display any banlist data in the footer.
		if (this.effect.size) {
			if (this.notInCg) {
				footerString = '(Anime/Manga/Game Exclusive)'
			}
			else {
				const banlistData = this.getBanlistData()
				const statuses = []
				for (const status in banlistData) {
					const cgs = banlistData[status]
					if (cgs.length) 
						statuses.push(`${status} (${cgs.join('/')})`)
				}

				footerString = `F/L Status: ${statuses.join(', ')}`
			}
		}
		if (footerString)
			finalEmbed.setFooter(footerString)

		embedData.embed = finalEmbed
		if (imageAttach)
			embedData.attachment = imageAttach

		return embedData
	}

	/**
	 * Generates an embed containing an upsized card art (of the given ID).
	 * @param {String} locale The locale to use for the card name.
	 * @param {Boolean} official Whether to only include official Konami information. 
	 * @param {Number} artId The ID of the art to display. 
	 */
	generateArtEmbed(locale, official, artId = 1) {
		const embedData = {}
		
		// We shouldn't be here with no art data, but do a final sanity check to make sure we leave if so.
		if (!this.imageData.size || !this.imageData.get(artId)) 
			return embedData

		const finalEmbed = new MessageEmbed()

		// Still display the typical "author line" (name, property, link, etc.)
		const cardName = this.name.get(locale)
		const colorIcon = this.getEmbedColorAndIcon()
		const titleUrl = this.getEmbedTitleLink(locale, official)

		finalEmbed.setAuthor(cardName, colorIcon[1], titleUrl)
		finalEmbed.setColor(colorIcon[0])
		// Set the image.
		const imageAttach = this.setEmbedImage(finalEmbed, artId, false)

		embedData.embed = finalEmbed
		if (imageAttach) {
			embedData.attachment = imageAttach
		}

		return embedData
	}

	generateDateEmbed(locale, official) {
		const embedData = {}

		// We shouldn't be here with no print data, but do a final sanity check to make sure we leave if so.
		if (!this.printData.size || !this.printData.get(locale))
			return embedData
		
		const finalEmbed = new MessageEmbed()

		// Still display the typical "author line" (name, property, link, etc.)
		const cardName = this.name.get(locale)
		const colorIcon = this.getEmbedColorAndIcon()
		const titleUrl = this.getEmbedTitleLink(locale, official)

		finalEmbed.setAuthor(cardName, colorIcon[1], titleUrl)
		finalEmbed.setColor(colorIcon[0])
		const imageAttach = this.setEmbedImage(finalEmbed, 1)

		// Set the description field to be the first and last print dates in this locale.
		let introText = `${LocaleEmojis[locale]} ${locale.toUpperCase()} print data for this card:`
		const sortedDates = this.sortPrintDates(locale)
		const firstPrint = sortedDates[sortedDates.length-1]
		const lastPrint = sortedDates[0]
		const today = new Date()

		let firstText = `First (oldest) print: **${firstPrint}**`
		if (new Date(firstPrint) > today) firstText += ' *(not yet released)*'
		let lastText = `Last (newest) print: **${lastPrint}**`
		if (new Date(lastPrint) > today) lastText += ` *(not yet released)*`

		finalEmbed.setDescription(`${introText}\n● ${firstText}\n● ${lastText}`)

		// Now add a field(s) for more detailed print data. Print dates *should* already be in order in the map.
		// Add "lines" to our final product per print date, and then join them into a single string for making fields at the end.
		const printLines = []
		let currPrint = 1
		let totalPrints = this.printData.get(locale).size
		this.printData.get(locale).forEach((date, code) => {
			printLines.push(`**${currPrint}.** ${code} -> ${date}`)
			currPrint++
		})
		// If we have more than 5 prints, split based on commas rather than newlines so this embed isn't 5 million lines long.
		const breakupDelimiter = totalPrints <= 5 ? '\n' : '|'
		if (printLines.length > 5) 
			var fullPrintData = printLines.join(' | ')
		else fullPrintData = printLines.join('\n')

		// Break things up if necessary, then add all the fields.
		const fields = breakUpDiscordMessage(fullPrintData, 1024, breakupDelimiter)
		for (let i = 0; i < fields.length; i++) {
			finalEmbed.addField(
				i === 0 ? `__Full Print Data (${totalPrints} ${totalPrints > 1 ? 'prints' : 'print'})__` : '__cont.__',
				fields[i], false
			)
		}

		embedData.embed = finalEmbed
		if (imageAttach)	
			embedData.attachment = imageAttach
		
		return embedData
	}

	/**
	 * Helper function for resolving the icon and colors to be used in the embed.
	 * @returns {Array} An array containing color and icon value. Color is index 0, icon is index 1.
	 */
	getEmbedColorAndIcon() {
		let color = EmbedColors['None']
		let icon = ''

		if (this.cardType) {
			// Ignore case just for good measure.
			const lowerType = this.cardType.toLowerCase()
			
			// Spells and Traps only have one color each, and icons are either based on their property
			// or, if they have no special property (e.g., Normal Spell), just their card type.
			if (lowerType === 'spell' || lowerType === 'trap') {
				color = EmbedColors[lowerType]
				if (this.property in EmbedIcons)
					icon = EmbedIcons[this.property]
				else
					icon = EmbedIcons[lowerType]
			}
			// Monster colors are based on their type, and icons are their Attribute.
			else {
				// Go through its types and use the first one that maps to a color.
				for (const t of this.types)
					if (t in EmbedColors) {
						color = EmbedColors[t]
						break
					}
				if (this.attribute) {
					// Ignore case just for good measure.
					const lowerAttribute = this.attribute.toLowerCase()
					icon = EmbedIcons[lowerAttribute]
				}
			}
		}

		return [color, icon]
	}

	/**
	 * Generates the URL destination for the title of any embed created this card's data.
	 * @param {String} locale The locale being used for this embed. 
	 * @param {Boolean} official Whether official mode is enabled. 
	 * @returns {String} The generated URL.
	 */
	getEmbedTitleLink(locale, official) {
		// TODO: We don't support non-database queries yet, but this will have to be changed when we do.
		if (!this.dbId) return

		let localeReleased = this.isReleased(locale)
		const jaReleased = this.isReleased('ja')
		if (!localeReleased) {
			// If it's not released in this locale, look at EN.
			localeReleased = this.isReleased('en')
			if (localeReleased) locale = 'en'
			// If not in EN, it's gotta be in JP. Only do this if official mode isn't being used.
			else if (!official) {
				localeReleased = jaReleased
				locale = 'ja'
			}
		}

		return `${KONAMI_CARD_LINK}${this.dbId}${KONAMI_REQUEST_LOCALE}${locale}`

		// TODO: Generate Yugipedia page links for anything that's not on the database.
	}

	/**
	 * Sets the given embed's image to this image ID and returns
	 * the corresponding attachment (if any) that is necessary to attach with the message.
	 * @param {MessageEmbed} embed The embed to set the image for.
	 * @param {Number} id The ID of the image.
	 * @param {Boolean} thumbnail Whether to set the thumbnail rather than the actual image. Defaults to true.
	 * @returns The URL for the attachment, if any (null if no attachment).
	 */
	setEmbedImage(embed, id, thumbnail = true) {
		if (!id && this.imageData.size) 
			id = this.imageData.keys().next().value
		
		let attach = null
		const imagePath = this.imageData.get(id)

		if (imagePath) {
			// If this path is in data/card_images, it's local and needs an attachment.
			if (imagePath.includes('data/card_images')) {
				attach = imagePath
				const imageName = path.basename(imagePath)
				if (thumbnail)
					embed.setThumbnail(`attachment://${imageName}`)
				else
					embed.setImage(`attachment://${imageName}`)
			}
			else {
				// Otherwise just assume it's a URL to somewhere and use it as the image.
				if (thumbnail)
					embed.setThumbnail(imagePath)
				else
					embed.setImage(imagePath)
			}
		}

		return attach
	}

	/**
	 * Build the string for this card's "ruling information."
	 * @param {String} locale The locale this field is being generated for.
	 * @param {Boolean} official Whether to only display official information.
	 */
	buildRulingsField(locale, official) {
		let localeReleased = this.isReleased(locale, true)
		const jaReleased = this.isReleased('ja')
		if (!localeReleased) {
			// If it's not released in this locale, look at EN.
			localeReleased = this.isReleased('en', true)
			if (localeReleased) locale = 'en'
			// If not in EN, it's gotta be in JP. Only do this if official mode isn't being used.
			else if (!official) {
				localeReleased = jaReleased
				locale = 'ja'
			}
		}

		let fieldText = ''

		// Database links.
		const cardKonamiInfoLink = `${KONAMI_CARD_LINK}${this.dbId}${KONAMI_REQUEST_LOCALE}${locale}`
		const cardKonamiRulingsLink = `${KONAMI_QA_LINK}${this.dbId}${KONAMI_REQUEST_LOCALE}ja`
		const cardYgorgCardLink = `${YGORG_CARD_LINK}${this.dbId}:en`
		if (official)
			// Official mode only gives card database links to the given locale, or EN if that locale is unreleased.
			fieldText += `Konami: [card](${cardKonamiInfoLink}) (${LocaleEmojis[locale]})`
		else {
			fieldText += `Konami: [card](${cardKonamiInfoLink}) (${LocaleEmojis[locale]})`
			if (jaReleased) fieldText += ` **·** [faq](${cardKonamiRulingsLink}) (${LocaleEmojis.ja})`
			fieldText += ` | YGOrg: [card/rulings](${cardYgorgCardLink}) (${LocaleEmojis['en']})`
			// TODO: Include Yugipedia links in this?
		}

		// Most recent print date.
		const sortedPrintDates = this.sortPrintDates(locale)
		if (!localeReleased)
			fieldText += `\nLast ${locale.toUpperCase()} print: **Not yet released**`
		else {
			// Check if the date is in the future.
			const mostRecentPrint = sortedPrintDates[0]
			fieldText += `\nLast ${locale.toUpperCase()}  print: **${mostRecentPrint}**`
			if (new Date(mostRecentPrint) > new Date()) fieldText += ' *(not yet released)*'
		}

		return fieldText
	}

	/**
	 * Returns a map of banlist statuses, where each key is the status (Unlimited, Forbidden, etc.)
	 * and each value is an array of CGs (TCG, OCG, MD, etc.) with that status.
	 * @returns {Object} A map of banlist status -> CGs with that status.
	 */
	getBanlistData() {
		const banlistStatus = {
			'Unreleased': [],
			'Forbidden': [],
			'Limited': [],
			'Semi-Limited': [],
			'Unlimited': []
		}
		const tcgString = 'TCG'
		const ocgString = 'OCG'

		if (this.tcgList)
			banlistStatus[BanlistStatus[this.tcgList]].push(tcgString)
		else {
			// If no status, need to distinguish between unreleased and unlimited.
			// Check print dates to determine whether something is unreleased.
			if (this.isReleased('en')) 
				banlistStatus.Unlimited.push(tcgString)
			else
				banlistStatus.Unreleased.push(tcgString)
		}
		if (this.ocgList)
			banlistStatus[BanlistStatus[this.ocgList]].push(ocgString)
		else {
			if (this.isReleased('ja'))
				banlistStatus.Unlimited.push(ocgString)
			else
				banlistStatus.Unreleased.push(ocgString)
		}

		return banlistStatus
	}
	
	/**
	 * Adds a given image to this card's image data. If it doesn't exist on the file system,
	 * it will save the image. If it's from Neuron, it will also crop the image to include just the art.
	 * @param {Number} id The ID of the image.
	 * @param img The raw image data or URL.
	 * @param {Boolean} fromNeuron Whether this image comes from Neuron.
	 * @param {Boolean} url Whether this image is a URL rather than raw data.
	 */
	addImageData(id, img, fromNeuron, url = false) {
		// If this is a URL, we don't need to save this at all, just set it.
		if (url) {
			this.imageData.set(id, img)
			return
		}

		const artPath = `${process.cwd()}/data/card_images`
		if (this.dbId)
			var artFilename = `${this.dbId}_${id}`
		else if (this.passcode)
			artFilename = `${this.passcode}_${id}`
		else
			artFilename = `${sanitize(this.name.get('en'))}_${id}`

		const fullArtPath = `${artPath}/${artFilename}.png`

		if (fs.existsSync(fullArtPath))
			this.imageData.set(id, fullArtPath)
		else if (img !== undefined) {
			if (fromNeuron) {
				let artCropDims = { 'top': 69, 'left': 32, 'width': 193, 'height': 191 }
				// Pendulums have squished arts, so the crop needs to be different.
				if (this.pendScale !== null || this.types.includes('Pendulum')) {
					// Not only that, but OCG Pendulums have different art dimensions than TCG Pendulums.
					if (!this.printData.has('en') || !this.name.has('en'))
						// OCG has a larger Pendulum Effect text box, so the art isn't as tall.
						artCropDims = { 'top': 67, 'left': 18, 'width': 220, 'height': 165 }
					else 
						artCropDims = { 'top': 67, 'left': 18, 'width': 220, 'height': 177 }
				}
				
				sharp(img).extract(artCropDims).toFile(fullArtPath)
				.catch(err => {
					logError(err, 'Failed to save card cropped image.')
					throw err
				})
			}
			else
				fs.writeFileSync(fullArtPath, img)
			
			this.imageData.set(id, fullArtPath)
		}
	}

	/**
	 * Returns whether this card is released in a given locale.
	 * @param {String} locale The locale to search for.
	 * @param {Boolean} includeFuturePrints If true, will treat this card as released provided we have any print data for it, even in the future.
	 * @returns {Boolean} Whether this card is released in this locale.
	 */
	isReleased(locale, includeFuturePrints = false) {
		// Anything not on the database is an easy "not released" card.
		if (!this.dbId) return false

		// Check CG locales versus their list property.
		// Can't be unreleased if you're on a banlist. Hopefully.
		if (locale === 'ja' || locale === 'ko')
			if (this.ocgList)
				return this.ocgList !== -1
		else 
			if (this.tcgList)
				return this.tcgList !== -1
		
		// If we got this far, we need to look at print dates instead.
		const localePrints = this.printData.get(locale)
		// No prints means no release.
		if (!localePrints || !localePrints.size) return false
		else {
			// This has prints, but need to check whether they're in the future.
			if (includeFuturePrints) return true

			const sortedDates = this.sortPrintDates(locale)
			// If the most recent print is in the future, this isn't released.
			return new Date() >= new Date(sortedDates[0])
		}
	}

	/**
	 * Processes all the print dates in a given locale and sorts them.
	 * @param {String} locale The locale to sort print dates for.
	 * @returns {Array<String>} The print dates, sorted in descending order (oldest print last).
	 */
	sortPrintDates(locale) {
		let sortedPrintDates = []
		const localePrints = this.printData.get(locale)

		if (localePrints && localePrints.size) {
			const printDates = [...localePrints.values()]

			sortedPrintDates = printDates.sort((a, b) => {
				return new Date(b) - new Date(a)
			})
		}

		return sortedPrintDates
	}

	/**
	 * Prints this object as a string. Uses DB ID, passcode, and EN name if available.
	 * @returns {String}
	 */
	toString() {
		const strParts = []

		if (this.dbId) strParts.push(`ID(${this.dbId})`)
		if (this.passcode) strParts.push(`passcode(${this.passcode})`)
		if (this.name.get('en')) strParts.push(`EN name(${this.name.get('en')})`)


		return strParts.join(', ')
	}
}

module.exports = Card