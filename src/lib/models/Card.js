const fs = require('fs')
const path = require('path')
const sharp = require('sharp')
const sanitize = require('sanitize-filename') 
const deasync = require('deasync')
const { MessageEmbed } = require('discord.js')

const { EmbedIcons, EmbedColors, BanlistStatus, LocaleEmojis, YGORG_CARD_LINK, YUGIPEDIA_WIKI } = require('./Defines')
const { searchPropertyToLocaleIndex } = require('handlers/YGOrgDBHandler')
const { logError, breakUpDiscordMessage } = require('lib/utils/logging')
const { TCGPlayerProduct } = require('./TCGPlayer')

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
		/**
		 * @type {Array<TCGPlayerProduct>}
		 */
		this.priceData = []				// The TCGPlayer product data associated with this card, which contain price info.
		this.faqData = new Map()		// Any FAQ data for this card. Each key is a locale, with value being the FAQ data for that locale.

		// Data unique to Rush Duel cards.
		// NOTE: These are not filled out or used yet. I can't be bothered.
		this.rushDuel = null			// Whether this card is a Rush Duel card.
		this.maximumAttack = null		// ATK of Maximum cards when Maximum Summoned.
		this.effectType = null			// Effect type, e.g., Continuous, Multi-Choice, etc.
		this.summCond = new Map()		// Summoning condition. Each key is a locale, with value as the summoning condition in that locale.
		this.requirement = new Map()	// Requirement. Each key is a locale, with value as the Requirement in that locale.
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
		if ('rulings' in options)
			var rulings = options.rulings
		else
			rulings = type === 'r'

		if (type === 'i' || type === 'r' || type === 'p') {
			embedData = this.generateInfoEmbed(locale, rulings, official)
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
		const today = new Date()
		if (sortedDates.length) {
			const firstPrint = sortedDates[sortedDates.length-1]
			const lastPrint = sortedDates[0]

			var firstText = `First (oldest) print: **${firstPrint}**`
			if (new Date(firstPrint) > today) firstText += ' *(not yet released)*'
			var lastText = `Last (newest) print: **${lastPrint}**`
			if (new Date(lastPrint) > today) lastText += ` *(not yet released)*`
		}
		else {
			firstText = `First (oldest) print: **Not yet released**`
			lastText = `Second (newest) print: **Not yet released**`
		}

		finalEmbed.setDescription(`${introText}\n● ${firstText}\n● ${lastText}`)

		let totalPrints = this.printData.get(locale).size
		if (totalPrints > 0) {
			// Now add a field(s) for more detailed print data. Print dates *should* already be in order in the map.
			// Add "lines" to our final product per print date, and then join them into a single string for making fields at the end.
			const printLines = []
			let currPrint = 1
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
		let link = ''

		// If this has no database ID we know of, make it a Yugipedia link.
		if (!this.dbId) {
			const nameUrl = this.getNameYugipediaUrl()
			link = `${YUGIPEDIA_WIKI}/${nameUrl}`
		}
		else {
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
		}

		return link
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
		const nameLink = this.getNameYugipediaUrl()

		let fieldText = ''

		// Information links. Don't print these for official mode, the card name is already a link to the Konami DB in that case.
		if (!official) {
			/*
			const cardKonamiInfoLink = `${KONAMI_CARD_LINK}${this.dbId}${KONAMI_REQUEST_LOCALE}${locale}`
			const cardKonamiRulingsLink = `${KONAMI_QA_LINK}${this.dbId}${KONAMI_REQUEST_LOCALE}ja`
			*/
			const cardYgorgCardLink = `${YGORG_CARD_LINK}${this.dbId}:en`
			const cardYugipediaCardLink = `${YUGIPEDIA_WIKI}/${nameLink}`

			// const konamiLinks = `${LocaleEmojis[locale]} [card](${cardKonamiInfoLink})` + jaReleased ? `, ${LocaleEmojis.ja} [faq/qa](${cardKonamiRulingsLink})` : ''
			fieldText += `YGOrg (${LocaleEmojis.en} [card/faq/qa](${cardYgorgCardLink})) **·** Yugipedia (${LocaleEmojis.en} [card](${cardYugipediaCardLink}))`
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
				
				// This is really ugly, but I realized too late this was asynchronous and it's lead to some scenarios
				// where the card embed is generated before the image is saved.
				// As such, I'm changing this to synchronous for saving the FIRST art file. The rest can stay async.
				if (id === 1) {
					let sync = true
					sharp(img).extract(artCropDims).toFile(fullArtPath, err => {
						if (err) logError(err, 'Failed to save card cropped image.')
						sync = false
					})
					while (sync) deasync.sleep(100)
				}
				else {
					sharp(img).extract(artCropDims).toFile(fullArtPath, err => {
						if (err) logError(err, 'Failed to save card cropped image.')
					})
				}
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
	 * Converts this card's name in the given locale to something that can be used to construct a Yugipedia URL.
	 * @param {String} locale The locale to use when converting the name. 
	 * @returns {String} The name in the given locale converted to a URL-friendly format. 
	 */
	getNameYugipediaUrl(locale = 'en') {
		return this.name.get(locale).replace(/\s/g, '_').replace(/\?/g, '%3F')
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