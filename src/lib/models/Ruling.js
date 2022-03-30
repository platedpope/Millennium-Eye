const { MessageEmbed } = require('discord.js')
const { logError, breakUpDiscordMessage } = require('lib/utils/logging')

const { LocaleEmojis, KONAMI_QA_LINK, KONAMI_REQUEST_LOCALE, YGORG_QA_LINK  } = require('./Defines')

class Ruling {
	/**
	 * Constructs an empty Ruling object with data to be filled out later.
	 */
	constructor() {
		this.id = null					// QA ID. Unique.
		this.title = new Map()			// Ruling title. Each key is a locale, with value as the title in that locale.
		this.question = new Map()		// Ruling question. Each key is a locale, with value as the question in that locale.
		this.answer = new Map()			// Ruling answer. Each key is a locale, with value as the question in that locale.
		this.date = new Map()			// QA date. Each key is a locale, with value as the date that any of its values (title, question, or answer) were last modified in that locale.
		this.cards = []					// An array of Cards that are tagged in this ruling.
		this.tags = []					// Any specific tags this ruling was given. (CURRENTLY UNUSED)
	}

	/**
	 * Constructs and returns a populated Ruling object using data from the YGOrg DB.
	 * This could be a case handled in the constructor, but I didn't want to have a constructor
	 * that was 5 million lines long with multiple special cases.
	 * @param {Array} dbRows Rows of data returned from the qaData YGOrg DB table. 
	 * @param db An existing database connection to the YGOrg DB.
	 * @returns {Ruling} The evaluated Ruling object.
	 */
	static fromYgorgDb(dbRows, db) {
		const qa = new Ruling()
		// Just use the first row as a representative for all the data that isn't locale-sensitive.
		const repRow = dbRows[0]

		// Map locale-sensitive data.
		for (const r of dbRows) {
			qa.title.set(r.locale, r.title)
			qa.question.set(r.locale, r.question)
			qa.answer.set(r.locale, r.answer)
			qa.date.set(r.locale, r.date)
		}
		qa.id = repRow.qaId

		// Grab any associated cards from the junction table.
		const dbCards = db.prepare('SELECT * FROM qaCards WHERE qaId = ?').all(qa.id)
		if (dbCards.length)
			for (const c of dbCards)
				qa.cards.push(c.cardId)

		return qa
	}

	/**
	 * Constructs and returns a populated Ruling object using data from the YGOrg API.
	 * This could be a case handled in the constructor, but I didn't want to have a constructor
	 * that was 5 million lines long with multiple special cases.
	 * @param {Object} apiData The data returned from the YGOrg DB API request.
	 * @returns {Ruling} The evaluated Ruling object. 
	 */
	static fromYgorgQaApi(apiData) {
		const qa = new Ruling()

		const qaData = apiData.qaData
		for (const locale in qaData) {
			// For some reason QA IDs are buried in each locale. Just use the first one we come across,
			// the rest are always the same.
			if (!qa.id) qa.id = qaData[locale].id

			qa.title.set(locale, qaData[locale].title)
			qa.question.set(locale, qaData[locale].question)
			qa.answer.set(locale, qaData[locale].answer)
			qa.date.set(locale, qaData[locale].thisSrc.date)
		}

		qa.cards = apiData.cards
		qa.tags = apiData.tags

		return qa
	}

	/**
	 * Generic wrapper for generating any type of embed.
	 * @param {Object} options Relevant options (type, locale, etc.) that are passed on to more specific embed functions.
	 */
	 generateEmbed(options) {
		let embedData = {}
		// Do not send any of these in "Official" mode.
		if ('official' in options && options.official)
			return embedData
		if ('locale' in options)
			var locale = options.locale
		if ('random' in options)
			var random = options.random
			
		embedData = this.generateRulingEmbed(locale, random)

		return embedData
	}


	/**
	 * Generate an embed containing the data for this ruling in the given locale.
	 * @param {String} locale The locale to use when generating the embed.
	 * @param {Boolean} random Whether the ruling is random. Spoilers the answer if so.
	 * @returns {MessageEmbed} The generated embed, or null if none could be generated (probably unsupported locale).
	 */
	generateRulingEmbed(locale, random = false) {
		const embedData = {}

		// We shouldn't be here without data for this locale, but do a final sanity check to make sure we leave if so.
		if (!this.title.has(locale))
			return embedData

		const konamiDbLink = `${KONAMI_QA_LINK}${this.id}${KONAMI_REQUEST_LOCALE}ja`
		const ygorgDbLink = `${YGORG_QA_LINK}${this.id}:${locale}`

		let replacedTitle = this.replaceIdsWithNames(this.title.get(locale), locale, false)
		let replacedQuestion = this.replaceIdsWithNames(this.question.get(locale), locale)
		let replacedAnswer = this.replaceIdsWithNames(this.answer.get(locale), locale)
		if (random)
			replacedAnswer = `||${replacedAnswer}||`
		// Add translation info to the answer field.
		let dateView = `**Translated**: ${this.date.get(locale)} | **View**: ${LocaleEmojis.ja} [ja](${konamiDbLink})`
		if (locale !== 'ja')
			dateView += ` **·** ${LocaleEmojis[locale]} [${locale}](${ygorgDbLink})`
		replacedAnswer = `${replacedAnswer}\n\n${dateView}`

		// Some QAs have the same title and question. In those cases, just make the title the ID.
		if (replacedTitle === replacedQuestion)
			replacedTitle = `Q&A #${this.id}`
		// Maximum embed author name is 256 characters. Break up titles before they're too long.
		if (replacedTitle.length >= 256) {
			// Try to find the last piece of punctuation and cut there.
			const truncTitle = breakUpDiscordMessage(replacedTitle, 256, '.')
			replacedTitle = truncTitle[0]
		}
		// Maximum field length is 1024 characters. Break up answers before they're too long.
		// Break on punctuation for maximum reliability.
		replacedAnswer = breakUpDiscordMessage(replacedAnswer, 1024, '.')

		const finalEmbed = new MessageEmbed()

		finalEmbed.setAuthor(replacedTitle, null, konamiDbLink)
		finalEmbed.addField('__Question__', replacedQuestion, false)
		for (let i = 0; i < replacedAnswer.length; i++) {
			finalEmbed.addField(
				i == 0 ? '__Answer__' : '__cont.__',
				replacedAnswer[i], false
			)
		}

		embedData.embed = finalEmbed

		return embedData
	}

	/**
	 * Replace all card IDs with their corresponding card names in the given locale.
	 * @param {String} text The text that contains IDs to be replaced.
	 * @param {String} locale The locale to use when replacing IDs.
	 * @param {Boolean} bold Whether to bold the newly replaced names.
	 */
	replaceIdsWithNames(text, locale, bold = true) {
		const idMatches = [...text.matchAll(/<<\s*(\d+)\s*>>/g)]
		if (idMatches.length) {
			const ids = []
			// Convert to a set to eliminate dupes and convert them to integers.
			const idSet = new Set()
			for (const match of idMatches) {
				const idMatch = match[1]
				idSet.add(parseInt(idMatch.trim(), 10))
			}
			for (const id of idSet)
				ids.push(id)

			// All of these IDs should be in our associated cards.
			for (const id of ids) {
				const card = this.cards.find(c => c.dbId === id)
				if (card)
					if (bold) text = text.replace(new RegExp(`<<\s*${id}\s*>>`, 'g'), `**${card.name.get(locale)}**`)
					else text = text.replace(new RegExp(`<<\s*${id}\s*>>`, 'g'), card.name.get(locale))
				// This shouldn't happen, but I guess this ID isn't among our associated cards?
				// else { logError(this.cards, `Could not find ID ${id} among associated cards for ruling ${this.id}.`) }
			}
		}

		return text
	}

	/**
	 * Prints this object as a string. Only reports QA ID for now.
	 */
	 toString() {
		let str = ''
		if (this.id) str += `QA ID(${this.id})`

		return str
	}
}

module.exports = Ruling