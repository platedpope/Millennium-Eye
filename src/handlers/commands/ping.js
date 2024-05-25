const heapdump = require('heapdump')
const { inspect } = require('util')
 
const Command = require('lib/models/Command')
const config = require('config')
const { logger } = require('lib/utils/logging')

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

		// For testing purposes only, create a heapdump for memory analysis.
		if (interaction.user.id === '219319817688186891') {
			const formatBytesToMB = (data) => `${Math.round(data / 1024 / 1024 * 100) / 100} MB`
			const mem = process.memoryUsage()
			const fmtMem = {
				rss: `${formatBytesToMB(mem.rss)}`,
				heapTotal: `${formatBytesToMB(mem.heapTotal)}`,
				heapUsed: `${formatBytesToMB(mem.heapUsed)}`,
				external: `${formatBytesToMB(mem.external)}`
			}
			logger.info(`Process memory usage: ${inspect(fmtMem)}`)
			// heapdump.writeSnapshot()
		}
	}
})