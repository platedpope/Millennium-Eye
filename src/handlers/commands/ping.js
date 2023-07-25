// const heapdump = require('heapdump')

const Command = require('lib/models/Command')
const config = require('config')

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

		/*
		// For testing purposes only, create a heapdump for memory analysis.
		if (config.testMode) {
			heapdump.writeSnapshot()
		}
		*/
	}
})