const { promisify } = require('util')
const { glob } = require('glob')
const Table = require('ascii-table')

const { logger } = require('lib/utils/logging')
const { MillenniumEyeBot } = require('lib/models/MillenniumEyeBot')
const Event = require('lib/models/Event')
const { EventTypes } = require('lib/models/Defines')

const GP = promisify(glob)

/**
 * @param {MillenniumEyeBot} bot 
 */
module.exports = async bot => {
	const eventTable = new Table('Events');
	
	(await GP(`${process.cwd()}/src/handlers/discord/events/*/*.js`))
		.map(async file => {
			/**
			 * @type {Event}
			 */
			const e = require(file)

			if (!e.event || !EventTypes.includes(e.event)) {
				const path = file.split('/')
				eventTable.addRow(`${e.event || 'MISSING'}`, `❌ Invalid/missing event name: ${path.at(-2)}/${path.at(-1)}`)
			}
			else {
				eventTable.addRow(e.event, '✔ Successfully loaded')
				if (e.once) bot.once(e.event, e.execute.bind(null, bot))
				else bot.on(e.event, e.execute.bind(null, bot))
			}
		})
	
	logger.info(`Event load results:\n${eventTable.toString()}`)
}