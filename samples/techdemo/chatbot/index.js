const answers = [
  {
    input: ['dtmf', 'ask for dtmf'],
    output: {
      botSays: 'Not implemented yet....'
    }
  },
  {
    input: ['picture', 'show me a picture', 'give me a picture'],
    output: {
      botSays: 'Are you kidding?'
    }
  },
  {
    input: ['disconnect'],
    output: {
      disconnect: false
    }
  }
]

const welcome = {
  botSays: 'Welcome!'
}

require('dotenv').config()

if (!process.env.URL) {
  console.log('Error, URL is missing!')
  process.exit(1)
}

if (!process.env.PORT) {
  console.log('Error, PORT is missing!')
  process.exit(1)
}

const express = require('express')
const bodyParser = require('body-parser')
const VoiceResponse = require('twilio').twiml.VoiceResponse
const debug = require('debug')('botium-twilio-techdemo-chatbot')

const app = express()
app.use(bodyParser.urlencoded({
  extended: true
}))

app.post('/voice', (request, response) => {
  debug(`Event received on 'voice' webhook. `)
  _createResponseVoice(response, welcome)
})

app.post('/next-voice', (request, response) => {
  debug(`Event received on 'next-voice' webhook. SpeechResult: ${request.body.SpeechResult}`)
  const userSays = request.body.SpeechResult
  const answer = answers.find((a) => a.input.indexOf(userSays) >= 0)
  let output
  if (answer) {
    output = answer.output
  } else {
    output = { botSays: `You said: ${userSays}` }
  }

  _createResponseVoice(response, output)
})

const _createResponseVoice = (res, output = {}) => {
  // naming parameter collections to better understanding
  const {botSays, disconnect} = output

  const vr = new VoiceResponse()
  if (disconnect) {
    vr.hangup()
  } else {
    if (botSays) {
      vr.say(
        {
          language: 'en-US'
        },
        botSays
      )
    }
    let parameters = {
      input: 'speech',
      action: `${process.env.URL}/next-voice`,
      language: 'en-US',
      timeout: 20
    }
    vr.gather(parameters)
  }
  const result = vr.toString()
  debug(`TwiML response created ${result}`)

  res.type('application/xml')
  res.send(result)
  res.status(200).end()
}

app.listen(process.env.PORT, function () {
  console.log(`Chatbot listening on port ${process.env.PORT}`)
})
