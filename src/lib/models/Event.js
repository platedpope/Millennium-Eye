/* eslint-disable no-unused-vars */
const Discord = require('discord.js')

const { MillenniumEyeBot } = require('./MillenniumEyeBot')

/**
 * @template {keyof Discord.ClientEvents} K
 * @param {MillenniumEyeBot} bot
 * @param {Discord.ClientEvents[K]} eventArgs
 */
function ExecFunction(bot, ...eventArgs) {}

/**
 * @template {keyof Discord.ClientEvents} K
 */
class Event {
	/**
	 * @typedef {{event: K, once: Boolean, execute: ExecFunction<K>}} EventOptions
	 * @param {EventOptions} options
	 */
	constructor(options) {
		this.event = options.event
		this.once = options.once
		this.execute = options.execute
	}
}

module.exports = Event