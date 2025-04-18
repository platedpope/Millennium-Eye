const { EmbedBuilder } = require('discord.js')

const { LocaleEmojis, KONAMI_QA_LINK, KONAMI_REQUEST_LOCALE, YGORESOURCES_QA_LINK, KONAMI_DB_LOGO  } = require('./Defines')
const { breakUpDiscordMessage } = require('lib/utils/logging')
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
		const ygoresourcesDbLink = `${YGORESOURCES_QA_LINK}${this.id}:${locale}`

		// Konami has made a habit of listing 5 billion other cards a ruling could possibly apply to.
		// YGOResources DB places "~~~" before these lists to denote that one of these card lists is starting (and to make it collapsible),
		// so look for that first to prune it and make sure those long-ass lists don't appear in the ruling embeds.
		// We do this before replacing IDs with names so that we avoid having to look up all the IDs in the list.
		const prunedAnswer = this.answer.get(locale).split('~~~')[0].trim()

		let replacedTitle = await replaceIdsWithNames(this.title.get(locale), locale, false)
		let replacedQuestion = await replaceIdsWithNames(this.question.get(locale), locale)
		let replacedAnswer = await replaceIdsWithNames(prunedAnswer, locale)
		if (random)
			replacedAnswer = `||${replacedAnswer}||`

		// Some QAs have the same title and question. In those cases, just make the title the ID.
		if (replacedTitle === replacedQuestion)
			replacedTitle = `Q&A #${this.id}`
		// Maximum embed author name is 256 characters. Break up titles before they're too long.
		if (replacedTitle.length >= 256) {
			// Try to find the last piece of punctuation and cut there.
			const truncTitle = breakUpDiscordMessage(replacedTitle, 256, '.')
			replacedTitle = truncTitle[0]
		}
		
		// Maximum field length is 1024 characters. Break up questions and answers before they're too long.
		replacedQuestion = breakUpDiscordMessage(replacedQuestion, 1024, '\n')
		replacedAnswer = breakUpDiscordMessage(replacedAnswer, 1024, '\n')
		// Truncate if necessary.
		const truncateAnswer = replacedAnswer.length > 2
		if (truncateAnswer) replacedAnswer.length = 2
		// Add translation info to the end of the answer field.
		let dateView = `**Translated**: ${this.date.get(locale)} | **View**: ${LocaleEmojis.ja} [ja](${konamiDbLink})`
		if (locale !== 'ja')
			dateView += ` **·** ${LocaleEmojis[locale]} [${locale}](${ygoresourcesDbLink})`
		if (truncateAnswer) {
			dateView += `\nNote: The answer shown here was truncated due to being prohibitively long.`
		}
		const answerWithDates = replacedAnswer[replacedAnswer.length - 1] + `\n\n${dateView}`
		if (answerWithDates.length < 1024) {
			replacedAnswer[replacedAnswer.length - 1] = answerWithDates
		}
		else {
			// If the last answer field + dates is too long, just make the dates their own field.
			replacedAnswer.push(dateView)
		}

		const finalEmbed = new EmbedBuilder()

		finalEmbed.setAuthor({ name: replacedTitle, url: konamiDbLink, iconURL: KONAMI_DB_LOGO,  })
		for (let i = 0; i < replacedQuestion.length; i++) {
			finalEmbed.addFields({
				name: i === 0 ? '__Question__' : '__Question (cont.)__',
				value: replacedQuestion[i], inline: false
			})
		}
		for (let i = 0; i < replacedAnswer.length; i++) {
			finalEmbed.addFields({
				name: i == 0 ? '__Answer__' : '__Answer (cont.)__',
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