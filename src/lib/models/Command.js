const { CommandInteraction }= require('discord.js')

const { MillenniumEyeBot } = require('./MillenniumEyeBot')

/**
 * @param {CommandInteraction} interaction
 * @param {MillenniumEyeBot} bot 
 */
async function ExecFunction(interaction, bot) {}
/**
 * @param {CommandInteraction} interaction
 * @param {MillenniumEyeBot} bot 
 */
 async function AutocompleteFunction(interaction, bot) {}

class Command {
	/**
	 * @typedef {{name: string, description: string, options: Object, execute: ExecFunction, autocomplete: AutocompleteFunction}} CommandArgs
	 * @param {CommandArgs} args 
	 */
	constructor(args) {
		this.name = args.name
		this.description = args.description
		this.options = args.options
		this.execute = args.execute
		this.autocomplete = args.autocomplete
	}
}

module.exports = Command