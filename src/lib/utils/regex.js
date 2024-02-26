const { QueryTypes, Locales } = require('lib/models/Defines')

function setupQueryRegex(openSymbol, closeSymbol) {
	const open = escRegex(openSymbol)
	const close = escRegex(closeSymbol)
	const regexQueryTypes = `[${(Object.keys(QueryTypes)).join('')}]`
	const regexLocales = `${(Object.keys(Locales)).join('|')}|jp`		// JP will be an alias for JA.
	
	// if open/close are < >, special case: 
	// !, @, #, : must be ignored to avoid conflict with plaintext discord formatting of stuff like mentions
	let angleIgnore = ''
	if (open === '<' && close === '>') {
		angleIgnore = '[^#!@:]'
	}

	return new RegExp(
		'((' + regexQueryTypes + ')*)?' +                               // match query type if present, e.g. the 'r' in r[card name]
		'(?<!^' + open + ')' +                                          // ignore cases with multiple of the open symbol in a row, e.g. [[card name]]
		open + '(' + angleIgnore + '[^' + close + ']+?)' + close +      // match what's in between the open/close symbols, e.g. the 'card name' in [card name]
		'(?!' + close + ')' +                                           // ignore cases with multiple of the close symbol in a row
		'(' + regexLocales + ')?'                                     	// match locale if present, e.g. the 'fr' in [card name]fr
		, 'g')															// global flag to ensure we match all possible
}

// helper function for escaping reserved regex characters
function escRegex(string) {
	return string.replace(/[.*+\-?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Helper function to construct a regex to find the given property
 * within a bunch of Yugipedia wikitext.
 * @param {String} prop The property to find. 
 * @param {String} data The wikitext to parse. 
 * @param {Boolean} toInt Whether to convert the final value to an integer.
 * @returns {String | Number} The result of the match, or null if nothing was found.
 */
function findYugipediaProperty(prop, data, toInt = false) {
	let retval = null

	const propRegex = new RegExp(`\\| ${prop}\\s*= (.*?)\\n(?:\\||})`, 's')
	let match = data.match(propRegex)
	if (match && match[1]) {
		match = match[1]
		match = match.trim()
		if (match) {
			if (toInt) match = parseInt(match, 10)
			retval = match
		}
	}

	return retval
}

/**
 * Replace all card IDs with their corresponding card names in the given locale.
 * @param {String} text The text that contains IDs to be replaced.
 * @param {String} locale The locale to use when replacing IDs.
 * @param {Boolean} bold Whether to bold the newly replaced names.
 */
 async function replaceIdsWithNames(text, locale, bold = true) {
	// This is in here to avoid a circular dependency. Not ideal, but easy.
	const Query = require('lib/models/Query')
	const Search = require('lib/models/Search')
	const { processQuery } = require('handlers/QueryHandler')

	const idMatches = [...text.matchAll(/<<\s*(\d+)\s*>>/g)]
	if (idMatches.length) {
		const ids = []
		// Convert to a set to eliminate dupes and convert them to integers.
		const idSet = new Set()
		for (const match of idMatches) {
			const idMatch = match[1]
			idSet.add(parseInt(idMatch.trim(), 10))
		}
		for (const id of idSet)
			ids.push(id)

		// Bootstrap a query from the IDs that need resolution.
		const searches = []
		for (const id of ids) {
			searches.push(new Search(id, 'i', locale))
		}
		const qry = new Query(searches)
		
		await processQuery(qry)
		for (const id of ids) {
			const cardSearch = qry.searches.find(s => s.data && s.data.dbId === id)
			if (cardSearch) {
				const card = cardSearch.data
				if (bold) text = text.replace(new RegExp(`<<\s*${id}\s*>>`, 'g'), `**${card.name.get(locale)}**`)
				else text = text.replace(new RegExp(`<<\s*${id}\s*>>`, 'g'), card.name.get(locale))
			}
			// This shouldn't happen, but if this fails then we couldn't map the ID to a card.
		}
	}

	return text
}

module.exports = {
	setupQueryRegex, escRegex, 
	findYugipediaProperty, replaceIdsWithNames
}
