/* eslint-disable no-unused-vars */

const { promisify } = require('util')
const { glob } = require('glob')
const Table = require('ascii-table')
const { logger } = require('../utils/modules/logging')
const Event = require('../utils/structures/Event')
const MillenniumEyeBot = require('../utils/structures/MillenniumEyeBot')
const { EventTypes } = require('../utils/structures/Validation')

const GP = promisify(glob)

/**
 * @param {MillenniumEyeBot} bot 
 */
module.exports = async bot => {
	const eventTable = new Table('Events');
	
	(await GP(`${process.cwd()}/handlers/events/*/*.js`))
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