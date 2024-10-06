# Millennium Eye
This is the official repository for the **Millennium Eye** (or **Eyebot**, for short) [Discord](https://discord.com/) bot. It is implemented in JavaScript using the [discord.js](https://discord.js.org/#/) API library.  The goal of the bot is to provide customizable, flexible syntax to query and quickly display information on cards in the [Yu-Gi-Oh!](https://www.yugioh-card.com/) card game while using Discord.

## Links 
* [Official Millennium Eye Discord Support Server](https://discord.gg/2wgqJHQhNj)--if you wish to contact the developer(s) to ask questions, report bugs, or request new features, then this is the place to do it.

## Usage

Cards can be searched by putting their name or database ID between `[]`, as in `[card name]`. The bot also supports Slash Commands, of which the `/query` command offers the same functionality and follows the same syntax.

There are certain modifiers you can put before or after the closing braces that change the results returned by the query. Some examples (not comprehensive):
- `d[card name]` will return the card's print data
- `a[card name]` or `/art card name` (Slash Command) will return the card's artwork
- `$[card name]` will return the card's price data

Similarly, locale abbreviations can be added after the closing brace to change the language returned. Some examples (not comprehensive):
* `[card name]de` will return the card's data in German
* `[card name]es` will return the card's data in Spanish

Read the below section to see what languages are supported, or use the `/help Syntax` Slash Command for more details on what options are available and what they do.

The bot also offers various configuration options, like changing the above `[]` syntax (which is just the default), or even associating different syntaxes to certain languages (e.g., `[]` returns English, while `{}` returns Spanish). Explore the `/config` slash command to see its capabilities, and use `/help Commands` to understand more about what other commands are available.

## Available Languages & Data

Yu-Gi-Oh is a game that is played worldwide, and is governed (broadly speaking) by two different branches split geographically:
- the OCG (Official Card Game) covers territories in Asia--specifically Japan, Korea, and China
- the TCG (Trading Card Game) is effectively everything else, and as such covers North and South America, Europe, and Oceania, among other things.

The bot is focused on supporting regions in the TCG first and foremost, and is written by and catered toward English-speaking users. That said, it supports and stores card data for all locales that are available on the [Card Database](https://www.db.yugioh-card.com/yugiohdb/), which are:
- English (en)
- Spanish (es)
- French (fr)
- German (de)
- Portuguese (pt)
- Italian (it)
- Japanese (ja/jp)
- Korean 

## Data Sources
The bot gathers the data it displays to users from several different sources. In order from most to least commonly used:
#### [YGOResources Database](https://db.ygoresources.com/)
This is a fanmade and fan-run (i.e., unofficial) database that mirrors the official Konami card database and offers its own wealth of data. Notably, the OCG version of the Official Card Database contains a section for card FAQs and Q&As that only exists in Japanese and has yet to be ported (officially) to English or any other locale; this database compiles and offers unofficial translations of this data (done by YGOrganization and other trusted sources) plus a number of other things. There is no more accessible single source of data for the physical card game, so the bot leverages the YGOResource database as much as possible.

The bot also makes use of this database's [artwork repository](https://artworks.ygoresources.com/) to source HD, unwatermarked card arts.
#### [Official Card Database](https://www.db.yugioh-card.com/yugiohdb/) 
This is a repository of card data that is maintained by Konami (the publishers of Yu-Gi-Oh!) themselves. The bot maintains a local copy of relevant parts of this database for various purposes. Usage of this has been gradually phased out over several bot updates, and currently its primary role is as a reference for the current state of the Forbidden & Limited Lists across the TCG, OCG, and Master Duel.

#### [Master Duel](https://www.konami.com/yugioh/masterduel/asia/en/)
As the currently most well-known and up-to-date Yu-Gi-Oh! video game, Master Duel is the flagship digital form of the Yu-Gi-Oh! CCG across both the globe. The bot tracks the status of the Master Duel Forbidden & Limited List (via the [MasterDuelMeta](https://www.masterduelmeta.com/) API) for display in its card embed footers alongside the TCG and OCG statuses. Also, full-resolution HD card arts are sourced from the game files for display when available. 
#### [TCGPlayer](https://www.tcgplayer.com/)
This is the the primary Yu-Gi-Oh! retailer in North America, and the source of all the bot's pricing data. This bot is **not** affilliated with or endorsed by TCGPlayer in any way, and only makes use of its API to display price data. There are currently no plans to gather data from other retailers ([Cardmarket](https://www.cardmarket.com/en) being the most prominent outside of North America).  
#### [Yugipedia](https://yugipedia.com/wiki/Yugipedia)
Another fanmade and fan-run project that gathers the exact wealth and variety of Yu-Gi-Oh! related information that one might expect from a Wikipedia offshoot dedicated to it. Most often, Yugipedia allows the bot access to data that has not yet made its way to the official database; typically cards that are revealed or teased in advance of their physical release. Aside from early teasers, Yugipedia also allows access to anime- or manga-related material.

## Acknowledgments
- gallantron, for writing basically every parser this bot makes use of to store data, as well as the YGOResources database, and for generally doing everything in your power to make as much Yu-Gi-Oh! data as accessible as possible. It is no exaggeration to say the bot in its current state would not be possible without your hard work and assistance
- my fellow moderators on the [r/yugioh subreddit Discord](https://discord.com/invite/yugioh), who indulged the bot in its infancy years ago and, in so doing, gave it the publicity it needed to become used across hundreds of servers as it is today
- many people beyond counting who have used or spread the bot, reported bugs, or made feature suggestions, and whose continued support ensure the survival and improvement of the bot 
