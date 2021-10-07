const Command = require('../../utils/structures/Command')

module.exports = new Command({
	name: 'ping',
	description: 'Pings the bot to test uptime and latency.',
	options: {
		name: 'ping',
		description: 'Pings the bot to test uptime and latency.',
		options: []
	},
	execute: async (interaction, bot) => {
		await interaction.reply('Pinging...')
		await interaction.editReply(`🏓 Pong! Latency: ${bot.ws.ping} ms`)
	}
})