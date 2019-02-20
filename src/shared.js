module.exports.WEBHOOK_ENDPOINT_START = '/api/twilio-ivr/start'
module.exports.WEBHOOK_ENDPOINT_NEXT = '/api/twilio-ivr/next'
module.exports.WEBHOOK_STATUS_CALLBACK = '/api/twilio-ivr/status'

// proxy -> connector events
module.exports.EVENT_BOT_BUSY = 'EVENT_BOT_BUSY'
module.exports.EVENT_BOT_CALL_FAILED = 'EVENT_BOT_CALL_FAILED'
// bot does not pick up the phone
module.exports.EVENT_BOT_NO_ANSWER = 'EVENT_BOT_NO_ANSWER'
// this event is rising in proxy. But we dont know who finished
// the call.
module.exports.EVENT_CALL_COMPLETED = 'EVENT_CALL_COMPLETED'

// connector -> proxy events
module.exports.EVENT_USER_DISCONNECTED = 'EVENT_USER_DISCONNECTED'
module.exports.EVENT_CONFIRMED = 'EVENT_CONFIRMED'

module.exports.getTopicName = (sid) => `TWILIO_TOPIC_${sid}`
