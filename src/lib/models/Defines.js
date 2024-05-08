/* eslint-disable no-useless-escape */
module.exports = {
	// Regexes.
	KONAMI_DB_QA_REGEX: /https?:\/\/www\.db\.yugioh-card\.com\/yugiohdb\/faq_search\.action\?ope=5&fid=(\d+)/g,
	KONAMI_DB_CARD_REGEX: /https?:\/\/www\.db\.yugioh-card\.com\/yugiohdb\/(?:card_search|faq_search)\.action\?ope=[24]&cid=(\d+)/g,
	YGORG_DB_QA_REGEX: /https?:\/\/db\.ygorganization\.com\/qa#(\d+)/g,
	YGORG_DB_CARD_REGEX: /https?:\/\/db\.ygorganization\.com\/card#(\d+)/g,
	IGNORE_LINKS_REGEX: /(?:https?|www\.|steamcommunity\.com\/gift)/g,
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
	YGORG_DB_PATH: `${process.cwd()}/data/ygorg.db`,
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
	YGORG_MANIFEST: `https://db.ygorganization.com/manifest`,
	YGORG_CARD_LINK: `https://db.ygorganization.com/card#`,
	YGORG_QA_LINK: `https://db.ygorganization.com/qa#`,
	YGORG_CARD_DATA_API: 'https://db.ygorganization.com/data/card',
	YGORG_QA_DATA_API: 'https://db.ygorganization.com/data/qa',
	YGORG_ARTWORK_API: `https://artworks.ygorganization.com`,
	YGORG_NAME_ID_INDEX: 'https://db.ygorganization.com/data/idx/card/name',
	YGORG_PROPERTY_METADATA: 'https://db.ygorganization.com/data/meta/mprop',
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
		'continuous': 'https://cdn.discordapp.com/attachments/1016081806635827362/1023711471940673567/continuous.png',
		'counter': 'https://cdn.discordapp.com/attachments/1016081806635827362/1023711472494313553/counter.png',
		'dark': 'https://cdn.discordapp.com/attachments/1016081806635827362/1023711472892780565/dark.png',
		'divine': 'https://cdn.discordapp.com/attachments/1016081806635827362/1023711473282846771/divine.png',
		'earth': 'https://cdn.discordapp.com/attachments/1016081806635827362/1023711473773584434/earth.png',
		'equip': 'https://cdn.discordapp.com/attachments/1016081806635827362/1023711474184630292/equip.png',
		'field': 'https://cdn.discordapp.com/attachments/1016081806635827362/1023711474536956004/field.png',
		'fire': 'https://cdn.discordapp.com/attachments/1016081806635827362/1023711474906058893/fire.png',
		'laugh': 'https://cdn.discordapp.com/attachments/1016081806635827362/1023711475396775957/LAUGH.png',
		'Level': '<:level:979391060163825696>',
		'light': 'https://cdn.discordapp.com/attachments/1016081806635827362/1023711476151754792/light.png',
		'Pendulum Scales': '<:pendscale:979390261249589248>',
		'quickplay': 'https://cdn.discordapp.com/attachments/1016081806635827362/1023711531357192212/quickplay.png',
		'Rank': '<:rank_star:549859884460408842>',
		'ritual': 'https://cdn.discordapp.com/attachments/1016081806635827362/1023711531738857503/ritual.png',
		'spell': 'https://cdn.discordapp.com/attachments/1016081806635827362/1023711532388978828/spell.png',
		'trap': 'https://cdn.discordapp.com/attachments/1016081806635827362/1023711533060071444/trap.png',
		'water': 'https://cdn.discordapp.com/attachments/1016081806635827362/1023711533580177448/water.png',
		'wind': 'https://cdn.discordapp.com/attachments/1016081806635827362/1023711533978619976/wind.png',
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
		'Konami DB Logo': 'https://cdn.discordapp.com/attachments/549781799484522518/627857980389589002/yugioh.png',
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