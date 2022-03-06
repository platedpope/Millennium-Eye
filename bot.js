require('module-alias/register')

const config = require('config')
const MillenniumEyeBot = require('lib/models/MillenniumEyeBot')

// change which bot we log in as based on whether we're in test mode
const loginToken = config.testMode ? config.testToken : config.mainToken
const bot = new MillenniumEyeBot()

// load event handlers
require('api/EventLoader')(bot)

// load command handlers
require('api/CommandLoader')(bot)

bot.start(loginToken)
