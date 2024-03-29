const express = require('express')
const { v1: uuidV1 } = require('uuid')
const bodyParser = require('body-parser')
const Redis = require('ioredis')
const { VoiceResponse } = require('twilio').twiml
const debug = require('debug')('botium-connector-twilio-ivr-proxy')

const {
  WEBHOOK_ENDPOINT_START,
  WEBHOOK_ENDPOINT_NEXT,
  WEBHOOK_ENDPOINT_FILE,
  WEBHOOK_STATUS_CALLBACK,
  EVENT_INIT_CALL,
  EVENT_USER_SAYS,
  EVENT_BOT_SAYS,
  EVENT_CALL_COMPLETED,
  EVENT_CALL_FAILED,
  EVENT_CALL_STARTED,
  getTopicInbound,
  getTopicOutbound,
  getCallbackUrl
} = require('./shared')

const isValidDtmf = (keys, fail) => {
  for (const key of keys) {
    if (!((key >= '0' && key <= '9') || key === '*' || key === '#' || key === 'w')) {
      if (fail) {
        throw new Error(`Invalid character "${key}" in DTMF specification "${keys}". Accepted keys are "0123456789 #* w" (w is for wait 0.5s)`)
      } else {
        return false
      }
    }
  }
  return true
}

const _createWebhookResponse = async (sid, { req, res }, { sessionStore, wait }) => {
  debug(`Creating webhook response from context for call ${sid}`)

  let twilioSession = await sessionStore.get(sid)
  if (!twilioSession) {
    debug(`No Twilio Session found for call ${sid}, returning error`)
    return res.status(500).end()
  }

  if (wait && twilioSession.responseTime) {
    await new Promise((resolve) => setTimeout(() => resolve(), twilioSession.responseTime))
  }
  twilioSession = await sessionStore.get(sid)
  if (!twilioSession) {
    debug(`No Twilio Session found for call ${sid}, returning error`)
    return res.status(500).end()
  }
  if (!twilioSession.publicUrl || !twilioSession.languageCode) {
    debug(`Twilio Session for call ${sid} not yet initialized (no publicUrl, languageCode)`)
    return res.status(500).end()
  }

  const response = new VoiceResponse()
  for (const va of twilioSession.voiceActions) {
    if (va.type === EVENT_USER_SAYS) {
      if (va.buttons && va.buttons.length > 0) {
        const buttonText = va.buttons[0].payload || va.buttons[0].text
        isValidDtmf(buttonText, true)
        response.play({
          digits: va.buttons[0].payload
        })
      } else if (va.messageText) {
        if (isValidDtmf(va.messageText, false)) {
          response.play({
            digits: va.messageText
          })
        } else {
          const sayArgs = {
            language: twilioSession.languageCode
          }
          if (twilioSession.voice) {
            sayArgs.voice = twilioSession.voice
          }
          response.say(sayArgs, va.messageText)
        }
      } else if (va.playUrl) {
        response.play(va.playUrl)
      }
    }
  }
  twilioSession.voiceActions = []
  await sessionStore.set(sid, twilioSession)

  const gatherArgs = {
    input: 'speech',
    action: getCallbackUrl(twilioSession.publicUrl, WEBHOOK_ENDPOINT_NEXT, twilioSession.publicUrlParams),
    language: twilioSession.languageCode,
    actionOnEmptyResult: true
  }
  if (twilioSession.speechModel) {
    gatherArgs.speechModel = twilioSession.speechModel
    if (twilioSession.speechModel === 'phone_call') {
      gatherArgs.enhanced = !!twilioSession.enhanced
    }
  }
  if (twilioSession.speechTimeout) {
    gatherArgs.speechTimeout = twilioSession.speechTimeout
  }

  response.gather(gatherArgs)

  const twimlResponse = response.toString()
  debug(`TwiML response created ${twimlResponse}`)

  res.type('application/xml')
  res.send(twimlResponse)
  res.status(200).end()
}

const setupEndpoints = ({ app, endpointBase, middleware, processInboundEvent, sessionStore }) => {
  if (!endpointBase) endpointBase = '/'
  else if (!endpointBase.endsWith('/')) endpointBase = endpointBase + '/'

  app.post(endpointBase + WEBHOOK_ENDPOINT_START, ...(middleware || []), async (req, res) => {
    debug(`Event received on 'start' webhook. SID: ${req.body.CallSid} Status ${req.body.CallStatus}`)
    await _createWebhookResponse(req.body.CallSid, { req, res }, { sessionStore })
  })

  app.post(endpointBase + WEBHOOK_ENDPOINT_NEXT, ...(middleware || []), async (req, res) => {
    debug(`Event received on 'next' webhook. SID: ${req.body.CallSid} Status ${req.body.CallStatus} SpeechResult ${req.body.SpeechResult} `)
    if (req.body.SpeechResult) {
      processInboundEvent({
        sid: req.body.CallSid,
        type: EVENT_BOT_SAYS,
        botSays: req.body.SpeechResult,
        sourceData: req.body
      })
      await _createWebhookResponse(req.body.CallSid, { req, res }, { sessionStore, wait: true })
    } else {
      await _createWebhookResponse(req.body.CallSid, { req, res }, { sessionStore, wait: false })
    }
  })

  app.get(endpointBase + WEBHOOK_ENDPOINT_FILE, ...(middleware || []), async (req, res) => {
    const twilioSession = await sessionStore.get(req.params.sessionId)
    if (twilioSession && twilioSession.files && twilioSession.files[req.params.fileId]) {
      const fileInfo = twilioSession.files[req.params.fileId]
      debug(`File retrieved. SID: ${req.params.sessionId} File ${req.params.fileId}/${fileInfo.mediaUri}`)
      const buffer = Buffer.from(fileInfo.base64, 'base64')
      res.writeHead(200, {
        'Content-Type': fileInfo.mimeType,
        'Content-Length': buffer.length
      })
      res.end(buffer)
    } else {
      debug(`File not found. SID: ${req.params.sessionId} File ${req.params.fileId}/${req.params.fileName}`)
      res.status(404).end()
    }
  })

  app.post(endpointBase + WEBHOOK_STATUS_CALLBACK, ...(middleware || []), async (req, res) => {
    debug(`Event received on 'status callback' webhook. SID: ${req.body.CallSid} Status ${req.body.CallStatus}`)

    const event = {
      sid: req.body.CallSid,
      sourceData: req.body
    }
    if (req.body.CallStatus === 'completed') {
      event.type = EVENT_CALL_COMPLETED
      await sessionStore.delete(req.body.CallSid)
    } else if (req.body.CallStatus === 'busy') {
      event.type = EVENT_CALL_FAILED
      await sessionStore.delete(req.body.CallSid)
    } else if (req.body.CallStatus === 'failed') {
      event.type = EVENT_CALL_FAILED
      await sessionStore.delete(req.body.CallSid)
    } else if (req.body.CallStatus === 'no-answer') {
      event.type = EVENT_CALL_FAILED
      await sessionStore.delete(req.body.CallSid)
    } else if (req.body.CallStatus === 'in-progress') {
      event.type = EVENT_CALL_STARTED
    }

    if (event.type) {
      await processInboundEvent(event)
    }
    res.status(200).end()
  })
}

const processOutboundEvent = async ({ sid, type, ...rest }, { sessionStore }) => {
  debug(`Received outbound Event for call ${sid}: ${type}`)
  let twilioSession = await sessionStore.get(sid)

  if (!twilioSession) {
    twilioSession = {
      publicUrl: null,
      publicUrlParams: {},
      languageCode: null,
      responseTime: 5000,
      voice: null,
      files: {},
      voiceActions: [],
      speechModel: 'phone_call',
      enhanced: true
    }
  }

  if (type === EVENT_INIT_CALL) {
    const { publicUrl, publicUrlParams, languageCode, voice, speechTimeout, responseTime, speechModel, enhanced } = rest
    twilioSession.publicUrl = publicUrl
    twilioSession.publicUrlParams = publicUrlParams
    twilioSession.languageCode = languageCode
    twilioSession.voice = voice
    twilioSession.speechTimeout = speechTimeout
    twilioSession.responseTime = responseTime
    twilioSession.speechModel = speechModel
    twilioSession.enhanced = enhanced

    if (!twilioSession.publicUrl.endsWith('/')) twilioSession.publicUrl = twilioSession.publicUrl + '/'
    await sessionStore.set(sid, twilioSession)
  } else if (type === EVENT_USER_SAYS) {
    const { messageText, buttons, mediaUri, base64, mimeType } = rest

    if (buttons && buttons.length > 0) {
      for (const key of buttons[0].payload) {
        if (!((key >= '0' && key <= '9') || key === '*' || key === '#' || key === 'w')) {
          throw new Error(`Invalid character "${key}" in DTMF specification "${buttons[0].payload}". Accepted keys are "0123456789 #* w" (w is for wait 0.5s)`)
        }
      }
    }
    const voiceAction = {
      type,
      messageText,
      buttons
    }
    if (base64) {
      const fileId = uuidV1()
      voiceAction.playUrl = getCallbackUrl(twilioSession.publicUrl, WEBHOOK_ENDPOINT_FILE.replace(':sessionId', sid).replace(':fileId', fileId), twilioSession.publicUrlParams)
      twilioSession.files[fileId] = {
        mediaUri,
        base64,
        mimeType
      }
    }
    twilioSession.voiceActions.push(voiceAction)
    await sessionStore.set(sid, twilioSession)
  }
}

const _inMemorySessionStore = () => {
  const twilioSessions = {}
  return {
    get: (sid) => twilioSessions[sid],
    set: (sid, data) => { twilioSessions[sid] = data },
    delete: (sid) => { delete twilioSessions[sid] }
  }
}

const startProxy = async ({ port, endpointBase, processInboundEvent, sessionStore }) => {
  return new Promise((resolve, reject) => {
    const app = express()
    const useSessionStore = sessionStore || _inMemorySessionStore()
    endpointBase = endpointBase || '/'

    setupEndpoints({
      app,
      middleware: [
        bodyParser.json(),
        bodyParser.urlencoded({ extended: true })
      ],
      endpointBase: endpointBase,
      processInboundEvent,
      sessionStore: useSessionStore
    })

    const proxy = app.listen(port, () => {
      console.log(`Botium Twilio Inbound Messages proxy is listening on port ${port}`)
      console.log(`Botium Twilio Inbound Messages endpoint available at http://127.0.0.1:${port}${endpointBase}`)
      resolve({ proxy, processOutboundEvent: async ({ sid, ...rest }) => processOutboundEvent({ sid, ...rest }, { sessionStore: useSessionStore }) })
    })
  })
}

const buildRedisHandlers = async (redisurl, topicBase) => {
  const topicInbound = getTopicInbound(topicBase)
  const topicOutbound = getTopicOutbound(topicBase)

  const redisSubscriber = new Redis(redisurl)
  redisSubscriber.on('connect', () => {
    debug(`Redis subscriber connected to ${JSON.stringify(redisurl || 'default')}`)
  })
  const redisClient = new Redis(redisurl)
  redisClient.on('connect', () => {
    debug(`Redis client connected to ${JSON.stringify(redisurl || 'default')}`)
  })

  const sessionStore = {
    get: async (sid) => {
      const content = await redisClient.get(sid)
      if (content) return JSON.parse(content)
    },
    set: async (sid, data) => {
      await redisClient.set(sid, JSON.stringify(data))
    },
    delete: async (sid) => {
      await redisClient.del(sid)
    }
  }

  const count = await redisSubscriber.subscribe(topicOutbound)
  debug(`Redis subscribed to ${count} channels. Listening for outbound messages on the ${topicOutbound} channel.`)
  redisSubscriber.on('message', (channel, event) => {
    try {
      event = JSON.parse(event)
      processOutboundEvent(event, { sessionStore })
    } catch (err) {
      return debug(`WARNING: received non-json message from ${channel}, ignoring: ${event}`)
    }
  })

  return {
    sessionStore,
    disconnect: async () => {
      redisSubscriber.disconnect()
      redisClient.disconnect()
    },
    processInboundEvent: async (event) => {
      try {
        redisClient.publish(topicInbound, JSON.stringify(event))
      } catch (err) {
        debug(`Error while publishing to redis: ${err.message}`)
      }
    }
  }
}

module.exports = {
  buildRedisHandlers,
  setupEndpoints,
  startProxy
}
