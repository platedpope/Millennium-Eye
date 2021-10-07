const { createLogger, format, transports } = require('winston')
const { inspect } = require('util')
const { testMode } = require('../../data/config.json')
// eslint-disable-next-line no-unused-vars
const MillenniumEyeBot = require('../structures/MillenniumEyeBot')

const logger = createLogger({
	transports: [
		new transports.Console({
			// change log level of console depending on whether we're in test mode
			level: testMode ? 'debug' : 'warn',
			handleExceptions: true,
		}),
		new transports.File({
			filename: './data/bot.log',
			level: 'debug',
			handleExceptions: true,
		}),
	],
	format: format.combine(
		format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
		format.printf(log => `(${log.timestamp}) [${log.level.toUpperCase()}]: ${log.message}`)
	),
	exitOnError: false,
})

/**
 * Helper function for logging errors to both the console, file log, and pre-defined Discord channel.
 * @param {any} error The error to log.
 * @param {String} desc A brief description of the error.
 * @param {MillenniumEyeBot} bot The bot.
 * @param  {...any} more Other details (typically objects) to include in the error log.
 */
async function logError(error, desc, bot, ...more) {
	// log to console and file first, they don't have any length restrictions to check
	let logString = `${desc}\n${inspect(error)}`
	if (more.length) {
		logString += '\nAdditional information:\n'
		for (const v of more) 
			logString += `${inspect(v)}\n`
	}
	logger.error(logString)

	// now log to discord channel if possible
	if (bot) {
		const msgs = [desc]
		msgs.push(...prepareDiscordLogJsMessage(error))
		if (more.length) {
			msgs.push('Additional information:')
			for (const v of more) 
				msgs.push(...prepareDiscordLogJsMessage(v))
			
		}
		for (const m of msgs) {
			await bot.logChannel.send(m)
		}
	}
}

/**
 * Helper function for generating error messages which allows 
 * differentiating between internal log messages and what to report to the user.
 * @param {String} logMessage The internal log message. An empty string/null indicates nothing is logged.
 * @param {String} channelResponse The message sent to the user. An empty string/null indicates nothing is sent.
 * @returns {Object} An object with both parameters as properties to be referenced.
 */
function generateError(logMessage, channelResponse) {
	return {
		'logMessage': logMessage,
		'channelResponse': channelResponse
	}
}

/**
 * Helper function for logging a JS object to Discord.
 * @param {Object} obj The object to be logged.
 */
function prepareDiscordLogJsMessage(obj) {
	const formattedMsgs = []
	const objString = inspect(obj)
	
	const objMsgs = breakUpDiscordMessage(objString)
	for (const m of objMsgs)
		formattedMsgs.push(formatDiscordJson(m))

	return formattedMsgs
}

/**
 * Helper function to adhere to maximum Discord character length, and automatically break up
 * messages that are too long into smaller chunks.
 * @param {String} str The message string to break up.
 * @param {Number} maxLength The maximum length of an individual message.
 * @returns {String[]} The array of messages constructed from the broken up message.
 */
function breakUpDiscordMessage(str, maxLength = 1990) {
	const msgs = []
	while (str.length > maxLength) {
		let idx = str.lastIndexOf('\n', maxLength)
		if (idx === -1) {
			// holy crap this is long, just abandon ship
			msgs.push(`${str.substr(0, maxLength - 40)}\n --- truncated very long message`)
			return
		}
		msgs.push(`${str.substr(0, idx)}`)
		str = str.substr(idx+1)
	}
	if (str.length) {
		msgs.push(str)
	}

	return msgs
}

/**
 * Helper function for printing out the JS representation of an object with Discord formatting. 
 * @param {String} fmt The string to format. 
 * @returns {string} A Discord-formatted string representation of the passed object.
 */
function formatDiscordJson(fmt) {
	return '```js\n' + fmt + '\n```'
}

module.exports = {
	logger, generateError, logError, breakUpDiscordMessage, prepareDiscordLogJsMessage
}