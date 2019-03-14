const util = require('util')
const express = require('express')
const listEndpoints = require('express-list-endpoints')
const bodyParser = require('body-parser')
const debug = require('debug')('botium-twilio-ivr-proxy')
const {VoiceResponse} = require('twilio').twiml
const kue = require('kue')

const {WEBHOOK_ENDPOINT_START, WEBHOOK_ENDPOINT_NEXT, WEBHOOK_STATUS_CALLBACK, getTopicName, EVENT_CALL_COMPLETED, EVENT_BOT_BUSY, EVENT_BOT_CALL_FAILED, EVENT_BOT_NO_ANSWER, EVENT_USER_DISCONNECTED, EVENT_CONFIRMED} = require('./shared')

// const mapSidToContext = new Map()

const startProxy = async (proxyParams) => {
  proxyParams = Object.assign({sendTextAsPhraseHint: true}, proxyParams)
  if (!proxyParams.publicurl) {
    throw Error('Public URL is not set!')
  }
  if (!proxyParams.port) {
    throw Error('Port is not set!')
  }
  if (!proxyParams.languageCode) {
    throw Error('LanguageCode is not set!')
  }

  this.queue = _setupRedis(proxyParams.redisurl)

  await _setupEndpoints(proxyParams)
}

const _createWebhookResponse = (proxyParams, expressContext, convoStepContext) => {
  // naming parameter collections to better understanding
  const {publicurl, languageCode, sendTextAsPhraseHint} = proxyParams
  const {res} = expressContext
  const {userSays, hintBotSays, errorMessage, userDisconnected} = convoStepContext

  if (errorMessage) {
    return res.send(500, errorMessage)
  }
  const response = new VoiceResponse()
  if (userDisconnected) {
    response.hangup()
  } else {
    let parameters = {
      input: 'speech',
      action: `${publicurl}${WEBHOOK_ENDPOINT_NEXT}`,
      language: languageCode
    }

    if (sendTextAsPhraseHint && hintBotSays) {
      parameters.hints = hintBotSays
    }

    const gather = response.gather(parameters)

    if (userSays) {
      gather.say(
        {
          language: languageCode
        },
        userSays
      )
    }
  }
  const result = response.toString()
  debug(`TwiML response created ${result}`)

  res.type('application/xml')
  res.send(result)
  res.status(200).end()
}

const _setupRedis = (redisUrl) => {
  const queueSettings = {redis: redisUrl}
  debug(`Connecting to Redis ${util.inspect(queueSettings)}`)
  const queue = kue.createQueue(queueSettings)
  queue.on('error', (err) => {
    debug(`ERROR, Communication error with Redis '${util.inspect(queueSettings)}': ${util.inspect(err)}`)
  })

  return queue
}

const _setupEndpoints = (proxyParams) => {
  const app = express()
  app.use(bodyParser.urlencoded({
    extended: true
  }))
  app.post(WEBHOOK_ENDPOINT_START, (req, res) => {
    debug(`Event received on 'start' webhook. SID: ${req.body.CallSid} Status ${req.body.CallStatus}`)
    // We start the conversation always by bot. So we dont send userSays here
    _createWebhookResponse(proxyParams, {req, res}, {})
  })

  app.post(WEBHOOK_ENDPOINT_NEXT, (req, res) => {
    debug(`Event received on 'next' webhook. SID: ${req.body.CallSid} Status ${req.body.CallStatus} SpeechResult ${req.body.SpeechResult} `)
    _createJob(proxyParams, {req, res}, {botSays: req.body.SpeechResult})
  })

  app.post(WEBHOOK_STATUS_CALLBACK, (req, res) => {
    debug(`Event received on 'status callback' webhook. SID: ${req.body.CallSid} Status ${req.body.CallStatus}`)

    let event
    if (req.body.CallStatus === 'completed') {
      event = EVENT_CALL_COMPLETED
    } else if (req.body.CallStatus === 'busy') {
      event = EVENT_BOT_BUSY
    } else if (req.body.CallStatus === 'failed') {
      event = EVENT_BOT_CALL_FAILED
    } else if (req.body.CallStatus === 'no-answer') {
      event = EVENT_BOT_NO_ANSWER
    }

    if (event) {
      _createJob(proxyParams, {req, res}, {event})
    }

    res.status(200).end()
  })

  app.listen(proxyParams.port, () => {
    const message = `Botium Twilio IVR Proxy server is listening on port ${proxyParams.port} \nEndpoints: ${util.inspect(listEndpoints(app))}`
    if (debug.enabled) {
      debug(message)
    } else {
      console.log(message)
    }
  })
}

const _createJob = (proxyParams, {req, res}, {botSays, event}) => {
  const sid = req.body.CallSid
  let jobData
  if (botSays) {
    jobData = {
      msg: {
        messageText: botSays
      }
    }
  } else if (event) {
    jobData = {event}
  } else {
    throw Error('Illegal stete. Nothing to process to the job')
  }

  const job = this.queue.create(getTopicName(sid), jobData).save()
  debug(`Job created: ${util.inspect(jobData)}`)

  job.on('complete', (result) => {
    debug('Job finished ', result)
    if (result.event === EVENT_CONFIRMED) {
      debug(`Job confirmed`)
    } else if (result.event === EVENT_USER_DISCONNECTED) {
      _createWebhookResponse(proxyParams, {req, res}, {userDisconnected: true})
    } else {
      _createWebhookResponse(proxyParams, {req, res}, {userSays: result.msg.messageText})
    }
  }).on('failed', (errorMessage) => {
    debug(`Job failed: ${util.inspect(errorMessage)}`)
    _createWebhookResponse(proxyParams, {req, res}, {error: errorMessage})
  })
}

module.exports = {
  startProxy
}
