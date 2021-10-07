/* eslint-disable no-unused-vars */

const { promisify } = require('util')
const { glob } = require('glob')
const Table = require('ascii-table')
const { logger } = require('../utils/modules/logging')
const Event = require('../utils/structures/Command')
const { Permissions } = require('../utils/structures/Validation')
const MillenniumEyeBot = require('../utils/structures/MillenniumEyeBot')

const GP = promisify(glob)

/**
 * @param {MillenniumEyeBot} bot 
 */
module.exports = async bot => {
	const commandTable = new Table('Commands');

	(await GP(`${process.cwd()}/handlers/commands/*.js`))
		.map(async file => {
			/**
			 * @type {Command}
			 */
			const cmd = require(file)

			if (!cmd.name) {
				const path = file.split('/')
				return commandTable.addRow(`commands/${path.at(-1)}`, '❌ Missing name')
			}
			else if (!cmd.description) return commandTable.addRow(`${cmd.name}`, '❌ Missing description')
			else if (!cmd.options) return commandTable.addRow(`${cmd.name}`, '❌ Missing options')
			else if (cmd.permissions) {
				if (!Permissions.includes(cmd.permissions)) return commandTable.addRow(`${cmd.name}`, '❌ Invalid permissions')
				else cmd.options.default_permission = false
			}

			bot.commands.set(cmd.name, cmd)
			commandTable.addRow(`${cmd.name}`, '✔ Successfully loaded')
			// don't need the command in require cache anymore
			delete require.cache[require.resolve(file)]
		})

	logger.debug(`Command load results:\n${commandTable.toString()}`)
}
