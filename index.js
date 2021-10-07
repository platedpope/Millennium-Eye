const MillenniumEyeBot = require('./utils/structures/MillenniumEyeBot')
const config = require('./data/config.json')

// change which bot we log in as based on whether we're in test mode
const loginToken = config.testMode ? config.testToken : config.mainToken
const bot = new MillenniumEyeBot()

// load event handlers
require('./handlers/EventLoader')(bot)

// load command handlers
require('./handlers/CommandLoader')(bot)

bot.start(loginToken)
