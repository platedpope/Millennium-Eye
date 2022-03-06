const { Role } = require('discord.js')

const { updateCommandPermissions } = require('lib/utils/permissions')
const MillenniumEyeBot = require('lib/models/MillenniumEyeBot')
const Event = require('lib/models/Event')

module.exports = new Event({
	event: 'roleCreate',
	once: false,
	/**
	 * @param {MillenniumEyeBot} bot 
	 * @param {Role} role
	 */
	execute: async (bot, role) => {
		// update command permissions in case the role has a necessary permission
		await updateCommandPermissions(bot, role.guild)
	}
})