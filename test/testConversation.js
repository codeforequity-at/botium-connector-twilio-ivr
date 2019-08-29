const express = require('express')
const listEndpoints = require('express-list-endpoints')
const bodyParser = require('body-parser')
const {VoiceResponse} = require('twilio').twiml
const util = require('util')
require('dotenv').config()

const accountSid = process.env.TWILIO_IVR_ACCOUNT_SID
const authToken = process.env.TWILIO_IVR_AUTH_TOKEN
const client = require('twilio')(accountSid, authToken)

const CALLER_START = `/api/caller/start`
const CALLER_REPEAT = `/api/caller/gather`
const RECEIVER_REPEAT = `/api/receiver/answer`

const _gather = (vr, action) => {
  return vr.gather({
    input: 'speech',
    // action,
    language: 'de-DE' //,
    // actionOnEmptyResult: 'true',
    // speechTimeout: '15'
    // hints: HINTS
  })
}

const _say = (vr, text) => {
  return vr.say(
    {
      voice: 'Polly.Matthew'
    },
    'goodbye'
  )
}

const _send = (vr, res, side) => {
  console.log(`${side}. Twiml: ${vr.toString()}`)
  res.type('application/xml')
  res.send(vr.toString())
  res.status(200).end()
}

const _logEntry = (req, side) => {
  console.log(`${side}. SpeechResult: "${req.body.SpeechResult || 'N/A'}" CallSid: "${req.body.CallSid}"`)
}

const initEndpointsCaller = (app) => {
  app.use(bodyParser.urlencoded({
    extended: true
  }))
  app.post(CALLER_START, (req, res) => {
    _logEntry(req, 'Caller')

    const vr = new VoiceResponse()
    _gather(vr, `${process.env.TWILIO_IVR_PUBLICURL}${CALLER_REPEAT}`)
    _send(vr, res, 'Caller')
  })
  app.post(CALLER_REPEAT, (req, res) => {
    _logEntry(req, 'Caller')

    const vr = new VoiceResponse()

    _send(vr, res, 'Caller')
  })
}

const initEndpointsReceiver = (app) => {
  app.use(bodyParser.urlencoded({
    extended: true
  }))
  app.post(RECEIVER_REPEAT, (req, res) => {
    _logEntry(req, 'Called')
    const vr = new VoiceResponse()

    _say(vr, '')

    _send(vr, res, 'Called')
  })
}

const initiateCall = () => {
  const callRequest = {
    url: `${process.env.TWILIO_IVR_PUBLICURL}${CALLER_START}`,
    to: process.env.TWILIO_IVR_TO,
    from: process.env.TWILIO_IVR_FROM,
    trim: 'do-not-trim',
    record: true
  }
  client.calls
    .create(callRequest)
    .then(call => {
      console.log(`Call.   Params: ${JSON.stringify(callRequest)}`)
      console.log(`Call.   Call object: ${JSON.stringify(call)}`)
    })
}

const app = express()

initEndpointsCaller(app)
initEndpointsReceiver(app)

app.listen(3000, function () {
  console.log(`Demo listening on port 3000 \\nEndpoints: ${util.inspect(listEndpoints(app))}`)
})

initiateCall()
