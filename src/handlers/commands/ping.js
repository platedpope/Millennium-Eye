const { inspect } = require('util')
const { SlashCommandBuilder } = require('discord.js')
 
const { logger } = require('lib/utils/logging')

module.exports = {
	data: new SlashCommandBuilder()
		.setName('ping')
		.setDescription('Pings the bot to test uptime and latency.'),
	execute: async (interaction, bot) => {
		await interaction.reply('Pinging...')
		await interaction.editReply(`🏓 Pong! Latency: ${bot.ws.ping} ms`)

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
		}
	}
}