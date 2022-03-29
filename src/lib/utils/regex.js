const { QueryTypes, Locales } = require('lib/models/Defines')

function setupQueryRegex(openSymbol, closeSymbol) {
	const open = escRegex(openSymbol)
	const close = escRegex(closeSymbol)
	const regexQueryTypes = `[${(Object.keys(QueryTypes)).join('')}]`
	const regexLocales = `${(Object.keys(Locales)).join('|')}`
	
	// if open/close are < >, special case: 
	// !, @, #, : must be ignored to avoid conflict with plaintext discord formatting of stuff like mentions
	let angleIgnore = ''
	if (open === '<' && close === '>') {
		angleIgnore = '[^#!@:]'
	}

	return new RegExp(
		'(' + regexQueryTypes + ')?' +                                  // match query type if present, e.g. the 'r' in r[card name]
		'(?<!^' + open + ')' +                                          // ignore cases with multiple of the open symbol in a row, e.g. [[card name]]
		open + '(' + angleIgnore + '[^' + close + ']+?)' + close +      // match what's in between the open/close symbols, e.g. the 'card name' in [card name]
		'(?!' + close + ')' +                                           // ignore cases with multiple of the close symbol in a row
		'(' + regexLocales + ')?'                                     // match locale if present, e.g. the 'fr' in [card name]fr
		, 'g')															// global flag to ensure we match all possible
}

// helper function for escaping reserved regex characters
function escRegex(string) {
	return string.replace(/[.*+\-?^${}()|[\]\\]/g, '\\$&')
}

module.exports = {
	setupQueryRegex, escRegex
}
