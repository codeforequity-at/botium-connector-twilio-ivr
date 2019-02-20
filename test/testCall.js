const caps = require('./botium').botium.Capabilities

const accountSid = caps.TWILIO_IVR_ACCOUNT_SID
const authToken = caps.TWILIO_IVR_AUTH_TOKEN
const client = require('twilio')(accountSid, authToken)

client.calls
  .create({
    url: 'http://demo.twilio.com/docs/voice.xml',
    to: caps.TWILIO_IVR_TO,
    from: caps.TWILIO_IVR_FROM
  })
  .then(call => console.log(call.sid))
  .done()
