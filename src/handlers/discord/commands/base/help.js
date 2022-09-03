const { EmbedBuilder, PermissionsBitField } = require('discord.js')

const config = require('config')
const Command = require('lib/models/Command')
const { QueryTypes, Locales, CommandTypes, LocaleEmojis } = require('lib/models/Defines')

module.exports = new Command({
	name: 'help',
	description: 'Responds with a summary of the bot features and how to use them.',
	options: {
		name: 'help',
		description: 'Provides a summary of a bot feature and how to use it.',
		options: [
			{
				name: 'feature',
				description: 'What set of bot features to request help with.',
				type: CommandTypes.STRING,
				required: true,
				choices: [
					{
						'name': 'Syntax',
						'value': 'syntax'
					},
					{
						'name': 'Commands',
						'value': 'commands'
					}
				]
			}
		]
	},
	execute: async (interaction, bot) => {
		const embedData = new EmbedBuilder()

		const feature = interaction.options.getString('feature', true)

		if (feature === 'syntax') {
			embedData.setTitle('Millennium Eye Help: Syntax')

			const defaultSyntax = { open: config.defaultOpen, close: config.defaultClose }
			const guildSyntaxes = bot.getGuildQueries(interaction.guild)
			// If the default syntax is still available, use it. Otherwise, find the first one we can use.
			if ('default' in guildSyntaxes)
				var syntax = defaultSyntax
			else
				for (const locale in guildSyntaxes) {
					syntax = bot.guildSettings.get([interaction.guildId, 'queries', locale])
					if (syntax)
						break
				}

			const desc = `You **MUST** mention the bot (<@${bot.user.id}>) in your message so it can see the query, or use the /query command (see Commands Help for more on the latter). The bot also tracks message edits for up to 15 seconds if you need to adjust your query (or forgot to mention it initially).`
			embedData.setDescription(desc)

			const queryTypes = `(${(Object.keys(QueryTypes)).join('|')})`
			const queryLocales = `(${(Object.keys(Locales)).join('|')})`
			const queryString = `${syntax.open}QUERY${syntax.close}`

			const genSyntax = `__General Syntax__: \`${queryTypes}${queryString}${queryLocales}\`\n\n`
			let syntaxHelpString = 'All queries must follow this general syntax. The options in parentheses separated by | are *not required*, and change the behavior or result of the query. They are also mutually exclusive--i.e., you can only use one at a time among each group. ' +
								`Some example queries might look like: \`${syntax.open}dark magician${syntax.close}\`, \`a${syntax.open}blue-eyes white dragon${syntax.close}\`, \`r${syntax.open}pot of greed${syntax.close}de\`.\n`
			embedData.addFields({ name: genSyntax, value: syntaxHelpString, inline: false })

			// Explaining the query type options.
			let queryTypesHelpString =  '● `i`— Returns a card\'s printed information and its status on the Forbidden/Limited list.\n' +
										'● `r`— Returns the same as `i` queries plus details like last print date and links to database/FAQ pages.\n' +
										'● `a`— Returns a larger version of the card art.\n' +
										'● `d`— Returns all physical prints of the card and their release date.\n' +
										'● `p`— Ignore the Konami database (normally priority for queries) and instead go straight to Yugipedia, typically for querying OCG-exclusive, or anime/manga cards.\n' +
										'● `$`— Returns all physical prints of the card and their prices on TCGPlayer (primarily card retailer for North America).\n' +
										'● `f`— Returns a card\'s FAQ bullets from the Konami database. Note FAQs are only officially available in Japanese, so versions in other languages are unofficial translations.\n' +
										'● `q`— Returns the information for a given Q&A entry (given by ID) on the Konami database. Note Q&As are only officially available in Japanese, so versions in other languages are unofficial translations.'
			embedData.addFields({ name: `Query Types: \`${queryTypes}\``, value: queryTypesHelpString, inline: false })
			queryTypesHelpString = `If you provide *none* of the above behavior-changing prefixes, \`${queryString}\` will adopt automatic behavior based on the channel the query was sent in.\n` +
									'● if sent in a "ruling channel": acts as a `r`-type query\n' +
									'● if sent outside of a "ruling channel": acts as an `i`-type query\n' +
									'For more information on ruling channels, refer to Commands Help.'
			embedData.addFields({ name: `Query Types Help (cont.)`, value: queryTypesHelpString, inline: false })

			// Explaining the locale options.
			let localesHelpString = `● \`de\`— ${LocaleEmojis['de']} German.\n` +
									`● \`en\`— ${LocaleEmojis['en']} English.\n` +
									`● \`es\`— ${LocaleEmojis['es']} Spanish.\n` +
									`● \`fr\`— ${LocaleEmojis['fr']} French.\n` +
									`● \`it\`— ${LocaleEmojis['it']} Italian.\n` +
									`● \`ja\`— ${LocaleEmojis['ja']} Japanese.\n` +
									`● \`ko\`— ${LocaleEmojis['ko']} Korean.\n` +
									`● \`pt\`— ${LocaleEmojis['pt']} Portuguese.\n`
			localesHelpString += 'When a locale is specified, the query results will be in that language (if available in that language) and any locale-sensitive values (e.g., print dates in that locale) will be drawn from that locale. ' + 
								 'Note that most locale data is sourced directly from the Konami database. If it is unavailable there, it will probably be unavailable to the bot.' 
			embedData.addFields({ name: `Locales: \`${queryLocales}\``, value: localesHelpString, inline: false })
		}
		else if (feature === 'commands') {
			embedData.setTitle('Millennium Eye Help: Commands')

			// Explaining /config. Only display this to users that run this that also have the necessary permissions to use it.
			if (interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
				let configHelpString =  'Contains bot configuration-related items to control bot behavior in individual channels or enitre servers. ' +
										'Currently configurable items are:\n' +
										'● **Query Syntax**: Controls what the bot considers a "query" and therefore what it responds to. This also allows setting up different syntaxes per language. See Syntax Help for more on how syntaxes work.\n' +
										'● **Official Mode**: While enabled, query results will be limited to only what comes from official Konami sources (i.e., the database). Information from unofficial sources will be hidden, and queries that rely on such information may not work.\n' +
										'● **Rulings Mode**: While enabled, basic card information queries will default to displaying all relevant rulings information. In syntax terms, this is the difference between an `i`- and `r`-type queries (see Syntax Help for more).\n\n'
				embedData.addFields({ name: '`/config`', value: configHelpString, inline: false })
				configHelpString = 'Official and Rulings Modes are configurable at both the channel- and server- level. Query Syntax is only configurable at the server-level.\n\n'
				configHelpString += 'You can view the current state of server/channel configuration with `/config settings`, and can change Official or Rulings mode from this command as well. Query Syntax must be changed with the `/config query add|remove` subcommands.'
				embedData.addFields({ name: '`/config` (cont.)', value: configHelpString, inline: false })
			}

			// Explaining /query.
			let queryHelpString =  'Provides a command form for querying the bot. It follows all the same syntax rules as a normal message-based query. See Syntax Help for more.'
			embedData.addFields({ name: '`/query`', value: queryHelpString, inline: false })

			// Explaining /art.
			let artHelpString = 'Provides a command form for querying art. It acts as a normal `a`-type query, with one key difference: for cards with multiple alternate artworks, it will display a selection menu allowing you to view any of those artworks you choose.\n' +
								'Normal `a`-type queries (i.e., those not performed using this command) will always default to displaying Artwork 1 in their result, so this command is used to view all the others (if there are any).'
			embedData.addFields({ name: '`/art`', value: artHelpString, inline: false })

			// Explaining /price.
			let priceHelpString =   'Provides a command form for querying card prices. It acts as a normal `$`-type query, but provides more command options for increased customization of the query that would otherwise be too complex to include in the ordinary query syntax. ' +
									'The available additional options are:\n' +
									'● **rarity**: Specify a card rarity to filter on. If a card or set has multiple prints in various rarities, you can use this option to only display prices of prints with the specific rarity you\'re interested in. ' +
									'Also, card price searches will default to only displaying up to 3 prints of a specific rarity, but adding this option will increase that number to up to 15 so more prints of that rarity appear.\n' +
									'● **sort**: Control which order the prices are displayed in. By default, price searches for cards display prices in ascending order (least to most expensive), and price searches for sets display prices in descending order (most to least expensive). ' +
									'This option allows you to change those default orders.'
			embedData.addFields({ name: '`/price`', value: priceHelpString, inline: false })

			// Explaining /match.
			let matchHelpString =   'Allows a more general query that searches for all cards that meet a specific critera. When the query is complete, a menu will be given to allow you to select and cycle through up to 25 cards that resulted from the query. ' +
									'Available "match type" (i.e., general criteria the bot can query) options are:\n' +
									'● **card name**: Specify a string you\'re looking for in a card name and the bot will find cards with names that either directly contain that string or closely resemble it.'
			embedData.addFields({ name: '`/match`', value: matchHelpString, inline: false })

			// Explaining /ping.
			let pingHelpString = 'A simple command that "pings" the bot, i.e. prompts it for a response. Used to sanity check whether the bot is currently responsive, in cases where it may seem to have abruptly stopped working.'
			embedData.addFields({ name: '`/ping`', value: pingHelpString, inline: false })
		}

		await interaction.reply({
			embeds: [ embedData ]
		})
	}
})