const fs = require('fs')
const path = require('path')
const sharp = require('sharp')
const sanitize = require('sanitize-filename') 
const { MessageEmbed } = require('discord.js')

const { EmbedIcons, EmbedColors, BanlistStatus, KONAMI_CARD_LINK, KONAMI_REQUEST_LOCALE, LanguageEmojis, KONAMI_QA_LINK, YGORG_CARD_LINK } = require('./Defines')
const { searchPropertyArray, searchPropertyToLanguageIndex } = require('handlers/YGOrgDBHandler')
const { logError } = require('lib/utils/logging')

class Card {
	/**
	 * The Card class has way too many possible properties, 
	 * so this constructor doesn't take any arguments and leaves them to be set manually.
	 * Note not all properties need to be set, but most of them will be for any given card.
	 */
	constructor() {
		// Main values that define a card.
		this.name = new Map()			// Card name. Each key is a language, with value as the name in that language.
		this.dbId = null				// Database ID. Unique.
		this.passcode = null			// Passcode. Unique.
		this.cardType = null			// Card type (Monster/Spell/Trap).
		this.property = null			// Property of Spell/Trap Cards (e.g., Quickplay, Continuous, etc.)
		this.types = []					// List of types that compose a monster's typeline (e.g., Spellcaster / Tuner / Pendulum / Effect)
		this.attribute = null			// Monster Attribute (e.g., DARK, WIND, etc.)
		this.levelRank = null			// Monster Level or Rank (only ever one or the other, ? = -1, only relevant for manga/anime cards)
		this.attack = null				// Monster ATK (? = -1)
		this.defense = null				// Monster DEF (? = -1)
		this.effect = new Map()			// Effect text. For Normal Monsters, this is their flavor text instead. Each key is a language, with value as the effect text in that language.
		this.pendEffect = new Map()		// Monster Pendulum Effect text. Each key is a language, with value as the effect text in that language.							
		this.pendScale = null			// Monster Pendulum Scale value.
		this.linkMarkers = []			// List of Link Monster arrows.

		// Ancillary data about the card.
		this.tcgList = null				// Status on the TCG F/L list (-1 = unreleased, 0 = forbidden, 1 = limited, 2 = semi-limited, anything else = unlimited)
		this.ocgList = null				// Status on the OCG F/L list (same values as above).
		this.notInCg = null				// True if the card isn't from the TCG or OCG; from anime/manga/game instead.
		this.printData = new Map()		// Data about when this card was printed and in which sets. Each key is a language, with value a further map of print code -> print date.
		this.imageData = new Map()		// Image(s) associated with the card. Each key is an ID, with value a link to that image (either local file or on the web).
		this.priceData = new Map()		// Any price data for this card. Valid keys are 'us' or 'eu', with values being the price data in that region.
		this.faqData = new Map()		// Any FAQ data for this card. Each key is a language, with value being the FAQ data for that language.
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

		// Just use the first row as a representative for all the stats that aren't language-sensitive.
		const repRow = dbRows[0]
		
		// Map language-sensitive rows.
		for (const r of dbRows) {
			card.name.set(r.language, r.dataName)
			card.effect.set(r.language, r.effect)
			if (r.pendEffect)
				card.pendEffect.set(r.language, r.pendEffect)
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
		const getPrints = `SELECT printCode, language, printDate FROM cardDataPrints ${where}`
		const printRows = db.prepare(getPrints).all(searchParam)
		for (const r of printRows) {
			const printsInLocale = card.printData.get(r.language)

			if (printsInLocale) printsInLocale.set(r.printCode, r.printDate)
			else {
				card.printData.set(r.language, new Map())
				card.printData.get(r.language).set(r.printCode, r.printDate)
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
		// Just use the first row as a representative for all the stats that aren't language-sensitive.
		const repRow = dbRows[0]
		
		card.dbId = repRow.id
		// Map language-sensitive rows.
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
		if (!card.imageData.size) {
			const getArtData = 'SELECT artId, artwork FROM card_artwork WHERE cardId = ?'
			const artRows = db.prepare(getArtData).all(card.dbId)
			for (const r of artRows) 
				card.addImageData(r.artId, r.artwork, true)
		}

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
			for (const lan in apiCardData) {
				const lanCardData = apiCardData[lan]
				// Map the language-specific values.
				if (!card.name.has(lan)) card.name.set(lan, lanCardData.name)
				if (!card.effect.has(lan)) card.effect.set(lan, lanCardData.effectText)
				if ('pendulumEffectText' in lanCardData)
					if (!card.pendEffect.has(lan)) card.pendEffect.set(lan, lanCardData.pendulumEffectText)
				// Parse print dates too.
				if ('prints' in lanCardData) {
					const apiPrints = lanCardData.prints
					if (!card.printData.has(lan)) card.printData.set(lan, new Map())
					for (const p of apiPrints)
						card.printData.get(lan).set(p.code, p.date)
				}
				// Some non-language-specific values are repeated per language. Just use them the first time we see them.
				if (!card.cardType) card.cardType = lanCardData.cardType
				// Parse monster-specific stats.
				if (card.cardType === 'monster') {
					if (!card.attribute && 'attribute' in lanCardData) card.property = lanCardData.attribute
					if (!card.levelRank && !card.linkMarkers.length) {
						if ('level' in lanCardData) card.levelRank = lanCardData.level
						else if ('rank' in lanCardData) card.levelRank = lanCardData.rank
						else if ('linkArrows' in lanCardData) {
							const arrows = lanCardData.linkArrows
							for (let i = 0; i < arrows.length; i++)
								card.linkMarkers.push(parseInt(arrows.charAt(i), 10))	
						}
					}
					if (!card.types.length && 'properties' in lanCardData)
						for (const prop of lanCardData.properties)
							card.types.push(searchPropertyArray(prop, 'en'))
					if (!card.attack && 'atk' in lanCardData) card.attack = lanCardData.atk
					if (!card.defense && 'def' in lanCardData) card.defense = lanCardData.def
					if (!card.pendScale && 'pendulumScale' in lanCardData) card.pendScale = lanCardData.pendulumScale
				}
				// Parse Spell/Trap specific stats.
				else {
					if (!card.property && 'property' in lanCardData) card.property = lanCardData.property
				}
				
			}
		}
		if ('faqData' in apiData) {
			const apiFaqData = apiData.faqData
			for (const entry of apiFaqData.entries)
				for (const lan in entry) {
					if (!card.faqData.has(lan)) card.faqData.set(lan, [])
					card.faqData.get(lan).push(entry[lan])
				}
		}
	}

	/**
	 * Generic wrapper for generating any type of embed.
	 * @param {Object} options Relevant options (type, language, etc.) that are passed on to more specific embed functions.
	 */
	generateEmbed(options) {
		let embedData = {}

		if ('type' in options)
			var type = options.type
		if ('language' in options)
			var language = options.language
		if ('official' in options)
			var official = options.official

		if (type === 'i' || type === 'r') {
			embedData = this.generateInfoEmbed(language, type === 'r' ? true : false, official)
		}

		return embedData
	}

	/**
	 * Generates the base, common information embed for the card.
	 * @param {String} language Which language to use when generating the embed.
	 * @param {Boolean} rulings Whether to include additional information relevant to rulings for the card.
	 * @param {Boolean} official Whether to only include official Konami information. This overrides any inclusion from rulings mode being true.
	 */
	generateInfoEmbed(language, rulings, official) {
		const embedData = {}

		// We shouldn't be here without data for this language, but do a final sanity check to make sure we leave if so.
		if (!this.name.has(language))
			return embedData
		
		const finalEmbed = new MessageEmbed()

		const cardName = this.name.get(language)
		const colorIcon = this.getEmbedColorAndIcon()
		const titleUrl = this.getEmbedTitleLink(language, official)

		finalEmbed.setAuthor(cardName, colorIcon[1], titleUrl)
		finalEmbed.setColor(colorIcon[0])
		const imageAttach = this.setEmbedImage(finalEmbed, 1)

		// Generate stat description.
		// Level/Rank
		if (this.levelRank !== null) {
			const lrString = this.levelRank >= 1 ? `${this.levelRank}` : '?'
			if (this.types.includes('Xyz'))
				var stats = `${EmbedIcons['Rank']} **${searchPropertyToLanguageIndex('Rank', language)}**: ${lrString}`
			else
				stats = `${EmbedIcons['Level']} **${searchPropertyToLanguageIndex('Level', language)}**: ${lrString}`
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
			stats += ` | ${EmbedIcons['Pendulum Scales']} **${searchPropertyToLanguageIndex('Pendulum Scale', language)}**: ${this.pendScale}`
		// Monster Types
		if (this.types.length) {
			if (language !== 'en')
				var newLanTypes = searchPropertyToLanguageIndex(this.types, language)
			
			if (language === 'en' || !newLanTypes)
				stats += `\n**[** ${this.types.join(' **/** ')} **]**`
			else
				stats += `\n**[** ${newLanTypes.join(' **/** ')} **]**`
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
		const pendEffect = this.pendEffect.get(language)
		if (pendEffect)
			finalEmbed.addField(searchPropertyToLanguageIndex('Pendulum Effect', language), pendEffect, false)
		// Effect
		let effect = this.effect.get(language)
		if (effect) {
			if (this.types.includes('Normal'))
				effect = `*${effect}*`
			finalEmbed.addField(searchPropertyToLanguageIndex('Effect', language), effect, false)
		}

		// Display ruling data if necessary. Only do this for cards that are on the database.
		if (rulings && this.dbId) {
			const rulingsText = this.buildRulingsField(language, official)
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
	 * @param {String} language The language being used for this embed. 
	 * @param {Boolean} official Whether official mode is enabled. 
	 * @returns {String} The generated URL.
	 */
	getEmbedTitleLink(language, official) {
		// TODO: We don't support non-database queries yet, but this will have to be changed when we do.
		if (!this.dbId) return

		let localeReleased = this.isReleased(language)
		const jaReleased = this.isReleased('ja')
		if (!localeReleased) {
			// If it's not released in this language, look at EN.
			localeReleased = this.isReleased('en')
			if (localeReleased) language = 'en'
			// If not in EN, it's gotta be in JP. Only do this if official mode isn't being used.
			else if (!official) {
				localeReleased = jaReleased
				language = 'ja'
			}
		}

		return `${KONAMI_CARD_LINK}${this.dbId}${KONAMI_REQUEST_LOCALE}${language}`

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
	 * @param {String} language The language this field is being generated for.
	 * @param {Boolean} official Whether to only display official information.
	 */
	buildRulingsField(language, official) {
		let localeReleased = this.isReleased(language, true)
		const jaReleased = this.isReleased('ja')
		if (!localeReleased) {
			// If it's not released in this language, look at EN.
			localeReleased = this.isReleased('en', true)
			if (localeReleased) language = 'en'
			// If not in EN, it's gotta be in JP. Only do this if official mode isn't being used.
			else if (!official) {
				localeReleased = jaReleased
				language = 'ja'
			}
		}

		let fieldText = ''

		// Database links.
		const cardKonamiInfoLink = `${KONAMI_CARD_LINK}${this.dbId}${KONAMI_REQUEST_LOCALE}${language}`
		const cardKonamiRulingsLink = `${KONAMI_QA_LINK}${this.dbId}${KONAMI_REQUEST_LOCALE}ja`
		const cardYgorgCardLink = `${YGORG_CARD_LINK}${this.dbId}:en`
		if (official)
			// Official mode only gives card database links to the given language, or EN if that language is unreleased.
			fieldText += `Konami: [card](${cardKonamiInfoLink}) (${LanguageEmojis[language]})`
		else {
			fieldText += `Konami: [card](${cardKonamiInfoLink}) (${LanguageEmojis[language]})`
			if (jaReleased) fieldText += ` **·** [faq](${cardKonamiRulingsLink}) (${LanguageEmojis.ja})`
			fieldText += ` | YGOrg: [card/rulings](${cardYgorgCardLink}) (${LanguageEmojis['en']})`
			// TODO: Include Yugipedia links in this?
		}

		// Most recent print date.
		const sortedPrintDates = this.sortPrintDates(language)
		if (!localeReleased)
			fieldText += `\nLast ${language.toUpperCase()} print: **Not yet released**`
		else {
			// Check if the date is in the future.
			const mostRecentPrint = sortedPrintDates[0]
			fieldText += `\nLast ${language.toUpperCase()}  print: **${mostRecentPrint}**`
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
	 * @param img The raw image data. 
	 * @param {Boolean} fromNeuron Whether this image comes from Neuron.
	 */
	addImageData(id, img, fromNeuron) {
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