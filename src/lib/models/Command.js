const { CommandInteraction }= require('discord.js')

const { MillenniumEyeBot } = require('./MillenniumEyeBot')

/**
 * @param {CommandInteraction} interaction
 * @param {MillenniumEyeBot} bot 
 */
async function ExecFunction(interaction, bot) {}

class Command {
	/**
	 * @typedef {{name: string, description: string, permissions: Array<string>, options: Object, execute: ExecFunction}} CommandArgs
	 * @param {CommandArgs} args 
	 */
	constructor(args) {
		this.name = args.name
		this.description = args.description
		this.permissions = args.permissions
		this.options = args.options
		this.execute = args.execute
	}
}

module.exports = Command