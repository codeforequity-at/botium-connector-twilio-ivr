require('dotenv').config()

const accountSid = process.env.TWILIO_IVR_ACCOUNT_SID
const authToken = process.env.TWILIO_IVR_AUTH_TOKEN
const client = require('twilio')(accountSid, authToken)

client.calls
  .create({
    url: 'http://demo.twilio.com/docs/voice.xml',
    to: process.env.TWILIO_IVR_TO,
    from: process.env.TWILIO_IVR_FROM
  })
  .then(call => console.log(call.sid))
  .done()
