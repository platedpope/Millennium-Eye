const fs = require('fs')
const path = require('path')
const sharp = require('sharp')
const sanitize = require('sanitize-filename')

const { searchLocalePropertyMetadata } = require('database/YGOrgDBHandler')
const { MessageEmbed } = require('discord.js')
const { EmbedColors, EmbedIcons } = require('./Defines')
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
	 * Generic wrapper for generating any type of embed.
	 * @param {String} type The search type used to map to this embed, i.e., r, i, d, etc.
	 * @param {String} language Which language to use when generating the embed.
	 * @param {Boolean} official Whether to only include official Konami information. This overrides any inclusion from rulings mode being true.
	 */
	generateEmbed(type, language, official) {
		if (type === 'i' || type === 'r') {
			var embedData = this.generateInfoEmbed(language, type === 'r' ? true : false, official)
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
		const finalEmbed = new MessageEmbed()

		const cardName = this.name.get(language)
		const colorIcon = this.getEmbedColorAndIcon()
		// TODO: Embed (author) URL.

		finalEmbed.setAuthor(cardName, colorIcon[1])
		finalEmbed.setColor(colorIcon[0])
		const imageAttach = this.setEmbedImage(finalEmbed, 1)

		// Generate stat description.
		// Level/Rank
		if (this.levelRank !== null) {
			const lrString = this.levelRank >= 1 ? `${this.levelRank}` : '?'
			if (this.types.includes('Xyz'))
				var stats = `${EmbedIcons['Rank']} **${searchLocalePropertyMetadata('Rank', language)}**: ${lrString}`
			else
				stats = `${EmbedIcons['Level']} **${searchLocalePropertyMetadata('Level', language)}**: ${lrString}`
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
			stats += ` | ${EmbedIcons['Pendulum Scales']} **${searchLocalePropertyMetadata('Pendulum Scale', language)}**: ${this.pendScale}`
		// Monster Types
		if (this.types.length) {
			if (language !== 'en')
				var newLanTypes = searchLocalePropertyMetadata(this.types, language)
			
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
			finalEmbed.addField(searchLocalePropertyMetadata('Pendulum Effect', language), pendEffect, false)
		// Effect
		let effect = this.effect.get(language)
		if (effect) {
			if (this.types.includes('Normal'))
				effect = `*${effect}*`
			finalEmbed.addField(searchLocalePropertyMetadata('Effect', language), effect, false)
		}

		// TODO: Banlist data (footer)

		return {
			'embed': finalEmbed,
			'attachment': imageAttach
		}
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

		return attach
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
		if (!fs.existsSync(fullArtPath)) {
			if (fromNeuron)
				sharp(img).extract({ top: 69, left: 32, width: 193, height: 191 }).toFile(fullArtPath)
				.catch(err => logError(err, 'Failed to save card cropped image.'))
			else
				fs.writeFileSync(fullArtPath, img)
		}

		this.imageData.set(id, fullArtPath)
	}

	/**
	 * Prints this object as a string. Uses DB ID, passcode, and EN name if available.
	 */
	toString() {
		let str = ''
		if (this.dbId) str += `ID(${this.dbId}) `
		if (this.passcode) str += `passcode(${this.passcode}) `
		if (this.name.get('en')) str  += `EN name(${this.name.get('en')})`

		return str
	}
}

module.exports = Card