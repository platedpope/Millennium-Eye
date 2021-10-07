/* eslint-disable no-unused-vars */
const { Guild } = require('discord.js')
const { logger } = require('./logging')
const MillenniumEyeBot = require('../structures/MillenniumEyeBot')

/**
 * Bulk updates the permissions associated with every command in the server.
 * @param {MillenniumEyeBot} bot The bot object.
 * @param {Guild} guild The guild to update commands for.
 */
async function updateCommandPermissions(bot, guild) {
	const fullPermissions = [];

	(await guild.commands.fetch())
		.each(cmd => {
			const botCommand = bot.commands.get(cmd.name)
			if (!botCommand || !botCommand.permissions) return
			
			const permissions = []
			// find which roles have the permissions necessary to use this command
			guild.roles.cache.filter(r => r.permissions.has(botCommand.permissions))
				.each(role => {
					permissions.push({
						id: role.id,
						type: 'ROLE',
						permission: true
					})
				})
			// the member.permissions.has function only accounts for roles + server ownership
			// only filtering on guild roles, as above, omits server owners that don't have necessary roles
			// for efficiency purposes, filter on members too only if we didn't find any roles with the permissions,
			// to account for small servers that might not have meaningful roles assigned
			if (!permissions.length) {
				guild.members.cache.filter(m => m.permissions.has(botCommand.permissions))
					.each(member => {
						permissions.push({
							id: member.id,
							type: 'USER',
							permission: true
						})
					})
			}

			if (permissions.length) {
				fullPermissions.push({
					id: cmd.id,
					'permissions': permissions
				})
			}
		})

	if (fullPermissions) await guild.commands.permissions.set({ fullPermissions })
}

module.exports = updateCommandPermissions