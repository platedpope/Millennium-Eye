const munkres = require('munkres-js')

class CardDataFilter {
	static tokenRegex = /[一-龠]+|[ぁ-ゔ]+|[ァ-ヴー]+|[a-zA-Z0-9]+|[ａ-ｚＡ-Ｚ０-９]+|[々〆〤]|[가-힣]/ug
	static MAX_DISTANCE = 4
	static mr = new munkres.Munkres()

	/**
	 * @param {Object} idx The indexed field.
	 * @param {String} ref The reference string (i.e., search) to filter on.
	 * @param {String} filterType The string of the FilterTypeFunction associated with the filtering function to be used.
	 */
	constructor(idx, ref, filterType) {
		this.FilterTypeFunctions = {
			'CARD_NAME': this.fuzzyTokenFilter
		}

		this.idx = idx
		// Tokenize the reference string.
		this.ref = ref.match(CardDataFilter.tokenRegex)
		this.filter = this.FilterTypeFunctions[filterType]
	}

	/**
	 * Filter on the index to find best-scoring matches.
	 * @param {Number} returnMatches The number of best-scoring matches to return.
	 * @param {Boolean} returnNames Whether to return the names of what was matched in addition to IDs.
	 * @return {Map<Number,Number>} A map of matched IDs to the score of that match. 
	 */
	filterIndex(returnMatches = 1, returnNames = false) {
		const requestedMatches = new Map()
		if (!this.ref) return requestedMatches

		const filteredResult = {}
		for (const k in this.idx) {
			const score = (+this.filter(k)) || 0
			if (score > 0)
				// Save this, and if it's a better score than one we got for that ID previously, overwrite.
				for (const id of this.idx[k]) 
					// Ignore negative IDs, they're used for Skills on YGOrg DB.
					if (id > 0) {
						// If using names, return "Name|ID" as the key so we can track both name + ID.
						const scoreKey = returnNames ? `${k}|${id}` : id
						filteredResult[scoreKey] = Math.max(score, filteredResult[scoreKey] || 0)
					}
		}

		// Now sort the results.
		// If scores are different, descending sort by score (i.e., higher scores first).
		// If scores are the same, ascending sort by ID (i.e., lower IDs first).
		const sortedResult = Object.entries(filteredResult).sort(
			([idA, scoreA], [idB, scoreB]) => {
				return (scoreA !== scoreB) ? (scoreB - scoreA) : (idA - idB)
			})
		// Only include the number of requested matches.
		sortedResult.splice(returnMatches)
		sortedResult.forEach(r => requestedMatches.set(r[0], r[1]))

		return requestedMatches
	}

	/**
	 * Computes the distance score between this filter's reference string and
	 * the value passed in to this function.
	 * THIS LOGIC IS SHAMELESSLY STOLEN FROM THE YGORG DB. THANKS GALLANTRON :)
	 * @param {String} val The value to calculate distance from.
	 * @returns {Number} The distance score.
	 */
	fuzzyTokenFilter(val) {
		// Tokenize the value we're comparing to.
		const hayWords = val.toLowerCase().match(CardDataFilter.tokenRegex)
		const nWords = Math.max(hayWords.length, this.ref.length)

		let costMatrix = [...Array(this.ref.length)].map(() => Array(nWords).fill(CardDataFilter.MAX_DISTANCE))
		for (let i = 0; i < this.ref.length; i++) {
			for (let j = 0; j < hayWords.length; j++) {
				let score = CardDataFilter.distanceScore(this.ref[i], hayWords[j])
				// Penalize score for terms that are in a different place.
				if (this.ref.length > 1 && i !== j) score += 0.5

				costMatrix[i][j] = score
			}
		}

		let sum = 0
		for (const [i, j] of CardDataFilter.mr.compute(costMatrix))
			sum += costMatrix[i][j]
		// Penalize matches that are longer than our search term(s), i.e. missing words.
		sum += Math.max(hayWords.length - this.ref.length, 0)/hayWords.length
		
		const MAX = CardDataFilter.MAX_DISTANCE * this.ref.length
		return (MAX - sum) / MAX
	}

	/**
	 * Calculates the restricted Damerau-Levenshtein distance between 2 strings.
	 * @param {String} a
	 * @param {String} b
	 * @returns {Number}
	 */
	static distanceScore(a, b) {
		if (a === b) return 0
		if (b.includes(a)) return 1

		// Calculate (restricted) Damerau-Levenshtein distance for fuzzy matching.
		const lenA = a.length, lenB = b.length
		const lenDelta = Math.abs(lenA - lenB)
		// Shortcut, length difference is a lower bound on DLr distance.
		if (this.MAX_DISTANCE <= lenDelta)
			return this.MAX_DISTANCE
		// Do the dirty work.
		let data = [...Array(lenA + 1)].map(() => Array(lenB + 1))
		for (let i = 0; i <= lenA; i++)
			data[i][0] = i
		for (let j = 0; j <= lenB; j++)
			data[0][j] = j
		for (let i = 1; i <= lenA; i++) {
			for (let j = 1; j <= lenB; j++) {
				let c = +(a.charAt(i-1) !== b.charAt(j-1))
				data[i][j] = Math.min(
					data[i-1][j] + 1,
					data[i][j-1] + 1,
					data[i-1][j-1] + c
				)

				if ((1 < i) && (j < 1) && (a.charAt(i-1) === b.charAt(j-2)) && (a.charAt(i-2) === b.charAt(j-1)))
					data[i][j] = Math.min(data[i][j], data[i-2][j-2]+c)
			}
		}

		return Math.min(this.MAX_DISTANCE, data[lenA][lenB])
	}
}

module.exports = {
	CardDataFilter
}