const _ = require('lodash')

module.exports.WEBHOOK_ENDPOINT_START = 'twilio-ivr/start'
module.exports.WEBHOOK_ENDPOINT_NEXT = 'twilio-ivr/next'
module.exports.WEBHOOK_STATUS_CALLBACK = 'twilio-ivr/status'

// proxy -> connector events
module.exports.EVENT_CALL_STARTED = 'EVENT_CALL_STARTED'
module.exports.EVENT_CALL_FAILED = 'EVENT_CALL_FAILED'
module.exports.EVENT_CALL_COMPLETED = 'EVENT_CALL_COMPLETED'
module.exports.EVENT_BOT_SAYS = 'EVENT_BOT_SAYS'

// connector -> proxy events
module.exports.EVENT_INIT_CALL = 'EVENT_INIT_CALL'
module.exports.EVENT_USER_SAYS = 'EVENT_USER_SAYS'

module.exports.getTopicInbound = (topicBase) => `${topicBase || 'BOTIUM_TWILIO_IVR'}_INBOUND`
module.exports.getTopicOutbound = (topicBase) => `${topicBase || 'BOTIUM_TWILIO_IVR'}_OUTBOUND`

module.exports.getCallbackUrl = (endpointBase, endpoint, endpointParams) => {
  let result = endpointBase
  if (!result.endsWith('/')) result = result + '/'
  result += endpoint
  if (endpointParams) {
    if (_.isString(endpointParams)) {
      result += '?' + endpointParams
    } else if (endpointParams.length > 0) {
      result += '?' + Object.keys(endpointParams).map(k => `${k}=${endpointParams[k]}`).join('&')
    }
  }
  return result
}
