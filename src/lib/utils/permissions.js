
const { Guild } = require('discord.js')

const { MillenniumEyeBot } = require('lib/models/MillenniumEyeBot')

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
			// filtering on guild role, as above, does not account for server ownership (which inherently gives admin privileges)
			// this might be a problem on smaller/private servers that have no meaningful roles assigned
			// member permission check will account for server ownership, 
			// but for efficiency reasons, only check if we didn't find any roles with the permissions
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

module.exports = {
	updateCommandPermissions
}