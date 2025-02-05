/* eslint-disable no-useless-escape */
module.exports = {
	// Regexes.
	KONAMI_DB_QA_REGEX: /https?:\/\/www\.db\.yugioh-card\.com\/yugiohdb\/faq_search\.action\?ope=5&fid=(\d+)/g,
	KONAMI_DB_CARD_REGEX: /https?:\/\/www\.db\.yugioh-card\.com\/yugiohdb\/(?:card_search|faq_search)\.action\?ope=[24]&cid=(\d+)/g,
	YGORESOURCES_DB_QA_REGEX: /https?:\/\/db\.ygorganization\.com\/qa#(\d+)|https?:\/\/db\.ygoresources\.com\/qa#(\d+)/g,
	YGORESOURCES_DB_CARD_REGEX: /https?:\/\/db\.ygorganization\.com\/card#(\d+)|https?:\/\/db\.ygoresources\.com\/card#(\d+)/g,
	IGNORE_LINKS_REGEX: /https?|www\.|steamcommunity\.com/g,
	MARKDOWN_LINK_REGEX: /\[.*\]\(https?:.*\)/g,
	// Constant values.
	API_TIMEOUT: 1000 * 3,									// 3 seconds.
	MESSAGE_TIMEOUT: 15,							// 15 seconds.
	USER_TIMEOUT: 60,								// 1 minute.
	TCGPLAYER_PRICE_TIMEOUT: 1000 * 60 * 60 * 8,	// 8 hours.
	CACHE_TIMEOUT: 1000 * 60 * 60 * 6,				// 6 hours.
	SEARCH_TIMEOUT_TRIGGER: 15,
	TCGPLAYER_API_VERSION: 'v1.39.0',
	TCGPLAYER_LOGO: 'https://cdn.discordapp.com/attachments/1016081566541303899/1124542759240466574/resized_tcgplayer.png',
	BOT_DB_PATH: `${process.cwd()}/data/bot.db`,
	KONAMI_DB_PATH: `${process.cwd()}/data/carddata.db`,
	NEURON_DB_PATH: `${process.cwd()}/data/neuron_name_rainbow`,
	YGORESOURCES_DB_PATH: `${process.cwd()}/data/ygoresources.db`,
	YUGIPEDIA_API_PARAMS: {
		action: 'query',
		format: 'json',
		formatversion: 2,
		redirects: true,
		prop: 'revisions|categories|pageimages',
		rvprop: 'content',
		cllimit: 50,
		piprop: 'original',
		generator: 'search',
		gsrlimit: 10,
		gsrwhat: 'title'
		// There's also a "gsrsearch" property that is used for the actual search value.
		// That value is filled in at runtime, per search.
	},
	// Seed URLs.
	KONAMI_REQUEST_LOCALE: `&request_locale=`,
	KONAMI_CARD_LINK: `https://www.db.yugioh-card.com/yugiohdb/card_search.action?ope=2&cid=`,
	KONAMI_QA_LINK: `https://www.db.yugioh-card.com/yugiohdb/faq_search.action?ope=5&fid=`,
	KONAMI_DB_LOGO: 'https://cdn.discordapp.com/attachments/1016081806635827362/1336526536529936424/konami-db-edit15-bg.png?ex=67a420d5&is=67a2cf55&hm=4bed4d18a62d52a4572476038e7419ec56ff5fb0898a49758310ccbaf8d4b4c5&',
	YGORESOURCES_MANIFEST: `https://db.ygoresources.com/manifest`,
	YGORESOURCES_CARD_LINK: `https://db.ygoresources.com/card#`,
	YGORESOURCES_QA_LINK: `https://db.ygoresources.com/qa#`,
	YGORESOURCES_CARD_DATA_API: 'https://db.ygoresources.com/data/card',
	YGORESOURCES_QA_DATA_API: 'https://db.ygoresources.com/data/qa',
	YGORESOURCES_ARTWORK_API: `https://artworks.ygoresources.com`,
	YGORESOURCES_NAME_ID_INDEX: 'https://db.ygoresources.com/data/idx/card/name',
	YGORESOURCES_TYPES_METADATA: 'https://db.ygoresources.com/data/meta/mprop',
	YGORESOURCES_PROPERTY_METADATA: 'https://db.ygoresources.com/data/meta/auto',
	YUGIPEDIA_WIKI: `https://yugipedia.com/wiki`,
	YUGIPEDIA_API: 'https://yugipedia.com/api.php',
	TCGPLAYER_API: 'https://api.tcgplayer.com',
	TCGPLAYER_PRODUCT_SEARCH: 'https://www.tcgplayer.com/search/yugioh/product?Language=English&q=',
	TCGPLAYER_SET_SEARCH: 'https://tcgplayer.com/search/yugioh/',
	MASTER_DUEL_API: 'https://www.masterduelmeta.com/api/v1',
	// Bot data type definitions for easy reference.
	QueryTypes: {
		'i': 'info',
		'r': 'ruling',
		'a': 'art',
		'd': 'date',
		'p': 'Yugipedia',
		'$': 'US price',
		'f': 'FAQ',
		'q': 'QA'
	},
	Locales: {
		'de': 'German',
		'en': 'English',
		'es': 'Spanish',
		'fr': 'French',
		'it': 'Italian',
		'ja': 'Japanese',
		'ko': 'Korean',
		'pt': 'Portuguese'
	},
	LocaleEmojis: {
		'de': '🇩🇪',
		'en': '🇬🇧',
		'es': '🇪🇸',
		'fr': '🇫🇷',
		'it': '🇮🇹',
		'ja': '🇯🇵',
		'ko': '🇰🇷',
		'pt': '🇵🇹'
	},
	EmbedIcons: {
		'continuous': '<:continuous:1325173713485697044>',
		'counter': '<:counter:1325173714308042804>',
		'dark': '<:dark:1325208267084795935>',
		'divine': '<:divine:1325208268447944795>',
		'earth': '<:earth:1325208269509365931>',
		'equip': '<:equip:1325173715348226230>',
		'field': '<:field:1325173716170313799>',
		'fire': '<:fire:1325208270461337731>',
		'laugh': 'https://cdn.discordapp.com/attachments/1016081806635827362/1023711475396775957/LAUGH.png',
		'Level': '<:level:979391060163825696>',
		'light': '<:light:1325208272982249512>',
		'Pendulum Scales': '<:pendscale:979390261249589248>',
		'quickplay': '<:quickplay:1325173717034209291>',
		'Rank': '<:rank_star:549859884460408842>',
		'ritual': '<:ritual:1325173718238105710>',
		'spell': '<:spell:1325208274001199156>',
		'trap': '<:trap:1325208275658211378>',
		'water': '<:water:1325208321648754760>',
		'wind': '<:wind:1325208279000940635>',
		'3': '↘', 
		'2': '⬇',
		'1': '↙', 
		'4': '⬅', 
		'7': '↖',
		'8': '⬆',
		'9': '↗', 
		'6': '➡',
		'Yugipedia Logo': 'https://cdn.discordapp.com/attachments/558000214087172101/558021639607156746/Wiki_2x.png',
		'Skill': 'https://cdn.discordapp.com/attachments/558000214087172101/558117295252176916/nKigv6X.png',
	},
	EmbedColors: {
		'Effect': 0xFF8B53,
		'Fusion': 0xA086B7,
		'Xyz': 0x111111,
		'Synchro': 0xFEFEFE,
		'Ritual': 0x9DB5CC,
		'Link': 0x00008B,
		'Normal': 0xFDE68A,
		'spell': 0x1D9E74,
		'trap': 0xBC5A84,
		'None': 0x000000
	},
	BanlistStatus: {
		'-1': 'Unreleased',
		0: 'Forbidden',
		1: 'Limited',
		2: 'Semi-Limited'
	},
	//																		7 8 9
	// Link markers are stored by the konami DB in the following format:	4   6
	//																		1 2 3
	LinkMarkersIndexMap: {
		'Bottom-Left': 1,
		'Bottom-Center': 2,
		'Bottom-Right': 3,
		'Middle-Left': 4,
		'Middle-Right': 6,
		'Top-Left': 7,
		'Top-Center': 8,
		'Top-Right': 9
	},
	// Discord API value verification.
	CommandTypes: {
		'SUB_COMMAND': 1,
		'SUB_COMMAND_GROUP': 2,
		'STRING': 3,
		'INTEGER': 4,
		'BOOLEAN': 5,
		'USER': 6,
		'CHANNEL': 7,
		'ROLE': 8,
		'MENTIONABLE': 9,
		'NUMBER': 10,
	},
	ChannelTypes: {
		'GUILD_TEXT': 0,
		'DM': 1,
		'GUILD_VOICE': 2,
		'GROUP_DM': 3,
		'GUILD_CATEGORY': 4,
		'GUILD_NEWS': 5,
		'GUILD_STORE': 6,
		'GUILD_NEWS_THREAD': 10,
		'GUILD_PUBLIC_THREAD': 11,
		'GUILD_PRIVATE_THREAD': 12,
		'GUILD_STAGE_VOICE': 13
	},
	EventTypes: [
		'applicationCommandCreate',
		'applicationCommandDelete',
		'applicationCommandUpdate',
		'channelCreate',
		'channelDelete',
		'channelPinsUpdate',
		'channelUpdate',
		'debug',
		'emojiCreate',
		'emojiDelete',
		'emojiUpdate',
		'error',
		'guildBanAdd',
		'guildBanRemove',
		'guildCreate',
		'guildDelete',
		'guildIntegrationsUpdate',
		'guildMemberAdd',
		'guildMemberAvailable',
		'guildMemberRemove',
		'guildMembersChunk',
		'guildMemberUpdate',
		'guildUnavailable',
		'guildUpdate',
		'interaction',
		'interactionCreate',
		'invalidated',
		'invalidRequestWarning',
		'inviteCreate',
		'inviteDelete',
		'message',
		'messageCreate',
		'messageDelete',
		'messageDeleteBulk',
		'messageReactionAdd',
		'messageReactionRemove',
		'messageReactionRemoveAll',
		'messageReactionRemoveEmoji',
		'messageUpdate',
		'presenceUpdate',
		'rateLimit',
		'ready',
		'roleCreate',
		'roleDelete',
		'roleUpdate',
		'shardDisconnect',
		'shardError',
		'shardReady',
		'shardReconnecting',
		'shardResume',
		'stageInstanceCreate',
		'stageInstanceDelete',
		'stageInstanceUpdate',
		'stickerCreate',
		'stickerDelete',
		'stickerUpdate',
		'threadCreate',
		'threadDelete',
		'threadListSync',
		'threadMembersUpdate',
		'threadMemberUpdate',
		'threadUpdate',
		'typingStart',
		'userUpdate',
		'voiceStateUpdate',
		'warn',
		'webhookUpdate',
	],
}