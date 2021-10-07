/* eslint-disable no-unused-vars */
const { Role } = require('discord.js')
const MillenniumEyeBot = require('../../../utils/structures/MillenniumEyeBot')
const Event = require('../../../utils/structures/Event')
const { updateCommandPermissions } = require('../../../utils/modules/permissions')

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