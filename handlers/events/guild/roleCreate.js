/* eslint-disable no-unused-vars */
const { Role } = require('discord.js')
const MillenniumEyeBot = require('../../../utils/structures/MillenniumEyeBot')
const Event = require('../../../utils/structures/Event')
const { updateCommandPermissions } = require('../../../utils/modules/permissions')

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