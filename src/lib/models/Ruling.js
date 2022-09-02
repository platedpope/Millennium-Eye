const { EmbedBuilder } = require('discord.js')

const { LocaleEmojis, KONAMI_QA_LINK, KONAMI_REQUEST_LOCALE, YGORG_QA_LINK  } = require('./Defines')
const { logError, breakUpDiscordMessage } = require('lib/utils/logging')
const { replaceIdsWithNames } = require('lib/utils/regex')

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
	 * Generic wrapper for generating any type of embed.
	 * @param {Object} options Relevant options (type, locale, etc.) that are passed on to more specific embed functions.
	 */
	 async generateEmbed(options) {
		let embedData = {}
		// Do not send any of these in "Official" mode.
		if ('official' in options && options.official)
			return embedData
		if ('locale' in options)
			var locale = options.locale
		if ('random' in options)
			var random = options.random
			
		embedData = await this.generateRulingEmbed(locale, random)

		return embedData
	}

	/**
	 * Generate an embed containing the data for this ruling in the given locale.
	 * @param {String} locale The locale to use when generating the embed.
	 * @param {Boolean} random Whether the ruling is random. Spoilers the answer if so.
	 * @returns {EmbedBuilder} The generated embed, or null if none could be generated (probably unsupported locale).
	 */
	async generateRulingEmbed(locale, random = false) {
		const embedData = {}

		// We shouldn't be here without data for this locale, but do a final sanity check to make sure we leave if so.
		if (!this.title.has(locale))
			return embedData

		const konamiDbLink = `${KONAMI_QA_LINK}${this.id}${KONAMI_REQUEST_LOCALE}ja`
		const ygorgDbLink = `${YGORG_QA_LINK}${this.id}:${locale}`

		let replacedTitle = await replaceIdsWithNames(this.title.get(locale), locale, false)
		let replacedQuestion = await replaceIdsWithNames(this.question.get(locale), locale)
		let replacedAnswer = await replaceIdsWithNames(this.answer.get(locale), locale)
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
		replacedAnswer = breakUpDiscordMessage(replacedAnswer, 1024, '\n')

		const finalEmbed = new EmbedBuilder()

		finalEmbed.setAuthor({ name: replacedTitle, iconURL: konamiDbLink })
		finalEmbed.addFields({ name: '__Question__', value: replacedQuestion, inline: false })
		for (let i = 0; i < replacedAnswer.length; i++) {
			finalEmbed.addFields({
				name: i == 0 ? '__Answer__' : '__cont.__',
				value: replacedAnswer[i], inline: false
			})
		}

		embedData.embed = finalEmbed

		return embedData
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