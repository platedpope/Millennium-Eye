const fs = require('fs')
const { logger, logError } = require('lib/utils/logging')

/**
 * Caches configuration information (server/channel settings) to allow for runtime changes and references,
 * and writes that information to a file so data can persist through bot restarts.
 */
class ConfigCache {
	/**
	 * Initializes the cache by either loading it from a file (if one exists) or creating an empty cache.
	 * @param {String} name The name of the cache. This will also be the file it saves to and loads from.
	 * @param {Boolean} file Whether to write to and load this from a file.
	 */
	constructor(name, file) {
		this.name = name
		this.file = file

		if (!this.file) this._cache = new Object()
		else {
			try {
				this._cache = require(`${process.cwd()}/data/${this.name}.json`)
			}
			catch (err) {
				this._cache = new Object()
				logger.warn(`Using fresh empty cache for ${this.name} cache since it failed to load from file (${err}).`)
			}
		}
	}

	_keyTransform(key) {
		return key instanceof String ? key : key.toString()   
	}

	keys() {
		return Object.keys(this._cache)
	}

	values() {
		return Object.values(this._cache)
	}

	entries() {
		return Object.entries(this._cache)
	}

	/**
	 * Saves the cache to disk as a JSON file, named after this cache's name.
	 */
	save() {
		if (!this.file) return
		try {
			// write temp file first, then rename
			fs.writeFileSync(`${process.cwd()}/data/${this.name}.bak.json`, JSON.stringify(this._cache, null, '\t'))
			fs.renameSync(`${process.cwd()}/data/${this.name}.bak.json`, `${process.cwd()}/data/${this.name}.json`)
		}
		catch (err) {
			logError(err, 'Failed to save cache to file.')
		}
	}

	/**
	 * Returns the value associated with a given key, undefined otherwise.
	 * @param {any | Array<any>} key The key, or ordered array of nested keys, to retrieve the value of.
	 */
	get(key) {
		if (!(key instanceof Array)) {
			return this._cache[this._keyTransform(key)]
		}
		else {
			let currCache = this._cache
			// descend through nested keys until we either hit an undefined one or arrive at the desired value
			try {
				for (const k of key) {
					currCache = currCache[this._keyTransform(k)]
				}
				return currCache
			}
			catch (err) {
				// key didn't exist somewhere along the way
				return undefined
			}
		}
	}

	/**
	 * Sets the value associated with a given key.
	 * @param {any | Array<any>} key The key, or ordered array of nested keys, for which to set the value.
	 * @param {any} value The value to set.
	 */
	put(key, value) {
		if (!(key instanceof Array)) {
			this._cache[this._keyTransform(key)] = value
		}
		else {
			let currCache = this._cache
			// descend through nested keys, initializing empty ones along the way as necessary to build the tree
			for (const k of key.slice(0, -1)) {
				let tKey = this._keyTransform(k)
				if (currCache[tKey] === undefined) {
					currCache[tKey] = new Object()
				}
				currCache = currCache[tKey]
			}
			currCache[this._keyTransform(key.at(-1))] = value
		}
		this.save()
	}

	/**
	 * Removes a key (and its corresponding value) from the cache.
	 * @param {any | Array<any>} key The key, or ordered array of nested keys, to remove.
	 * @returns The deleted value.
	 */
	remove(key) {
		let retval = undefined

		if (!(key instanceof Array)) {
			let tKey = this._cache[this._keyTransform(key)]
			retval = this._cache[tKey]
			delete this._cache[tKey]
		}
		else {
			let currCache = this._cache
			// descend through nested keys
			const keys_to_check = key.slice(0, -1)
			try {
				for (const k of keys_to_check) {
					currCache = currCache[this._keyTransform(k)]
				}
				let tKey = this._keyTransform(key.at(-1))
				retval = currCache[tKey]
				delete currCache[tKey]
				// if this deletion left an empty object, delete it and then move back up doing the same at all levels
				if (Object.keys(currCache).length === 0) {
					for (let i = 0; i < keys_to_check.length; i++) {
						currCache = this._cache
						for (const k of keys_to_check) {
							tKey = this._keyTransform(k)
							if (!currCache[tKey] || Object.keys(currCache[tKey]).length === 0) {
								delete currCache[tKey]
							}
							else {
								currCache = currCache[tKey]
							}
						}
					}
				}
			}
			catch (err) {
				// key probably didn't exist somewhere along the way
				// logError(err, 'Encountered error removing from config cache.')
			}
		}

		if (retval !== undefined) {
			// something was removed, save
			this.save()
		}

		return retval
	}
}

module.exports = ConfigCache