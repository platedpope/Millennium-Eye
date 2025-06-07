const { promisify } = require('util')
const { glob } = require('glob')
const Table = require('ascii-table')

const { logger } = require('lib/utils/logging')
const { MillenniumEyeBot, Command } = require('lib/models/MillenniumEyeBot')

const GP = promisify(glob)

/**
 * @param {MillenniumEyeBot} bot 
 */
module.exports = async bot => {
	const commandTable = new Table('Commands');

	(await GP(`${process.cwd()}/src/handlers/commands/*.js`))
		.map(async file => {
			/** @type {Command} */
			const cmd = require(file)

			if (!cmd.data.name) {
				const path = file.split('/')
				return commandTable.addRow(`commands/${path.at(-1)}`, '❌ Missing name')
			}
			else if (!cmd.data.description) return commandTable.addRow(`${cmd.data.name}`, '❌ Missing description')
			else if (!cmd.data.options) return commandTable.addRow(`${cmd.data.name}`, '❌ Missing options')

			bot.commands.set(cmd.data.name, cmd)
			commandTable.addRow(`${cmd.data.name}`, '✔ Successfully loaded')
			// don't need the command in require cache anymore
			delete require.cache[require.resolve(file)]
		})

	logger.info(`Command load results:\n${commandTable.toString()}`)
}
