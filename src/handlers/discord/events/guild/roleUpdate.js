const { Role } = require('discord.js')

const { updateCommandPermissions } = require('lib/utils/permissions')
const { MillenniumEyeBot } = require('lib/models/MillenniumEyeBot')
const Event = require('lib/models/Event')

module.exports = new Event({
	event: 'roleUpdate',
	once: false,
	/**
	 * @param {MillenniumEyeBot} bot 
	 * @param {Role} oldRole 
	 * @param {Role} newRole 
	 */
	execute: async (bot, oldRole, newRole) => {
		// update command permissions in case the role gained or lost a necessary permission
		await updateCommandPermissions(bot, newRole.guild)
	}
})