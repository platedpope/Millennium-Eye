require('module-alias/register')

const config = require('config')
const { meInstance } = require('lib/models/MillenniumEyeBot')

// Change which bot we log in as based on whether we're in test mode.
const loginToken = config.testMode ? config.testToken : config.mainToken

// Load event handlers.
require('handlers/EventLoader')(meInstance)

// Load command handlers.
require('handlers/CommandLoader')(meInstance)

meInstance.start(loginToken)
