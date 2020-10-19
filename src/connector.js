const fetch = require('node-fetch')
const Redis = require('ioredis')
const twilio = require('twilio')
const debug = require('debug')('botium-twilio-ivr-connector')

const {
  WEBHOOK_ENDPOINT_START,
  WEBHOOK_STATUS_CALLBACK,
  EVENT_INIT_CALL,
  EVENT_USER_SAYS,
  EVENT_BOT_SAYS,
  EVENT_CALL_COMPLETED,
  EVENT_CALL_FAILED,
  EVENT_CALL_STARTED,
  getTopicInbound,
  getTopicOutbound
} = require('./shared')

const { startProxy } = require('./proxy')

const Capabilities = {
  TWILIO_IVR_ACCOUNT_SID: 'TWILIO_IVR_ACCOUNT_SID',
  TWILIO_IVR_AUTH_TOKEN: 'TWILIO_IVR_AUTH_TOKEN',
  TWILIO_IVR_FROM: 'TWILIO_IVR_FROM',
  TWILIO_IVR_TO: 'TWILIO_IVR_TO',
  TWILIO_IVR_LANGUAGE_CODE: 'TWILIO_IVR_LANGUAGE_CODE',
  TWILIO_IVR_REDISURL: 'TWILIO_IVR_REDISURL',
  TWILIO_IVR_REDIS_TOPICBASE: 'TWILIO_IVR_REDIS_TOPICBASE',
  TWILIO_IVR_INBOUNDPORT: 'TWILIO_IVR_INBOUNDPORT',
  TWILIO_IVR_INBOUNDENDPOINT: 'TWILIO_IVR_INBOUNDENDPOINT',
  TWILIO_IVR_PUBLICURL: 'TWILIO_IVR_PUBLICURL',
  TWILIO_IVR_RECORD: 'TWILIO_IVR_RECORD',
  TWILIO_IVR_REDIAL: 'TWILIO_IVR_REDIAL',
  TWILIO_IVR_WAIT_CALL_STARTED: 'TWILIO_IVR_WAIT_CALL_STARTED',
  TWILIO_IVR_WAIT_CALL_COMPLETED: 'TWILIO_IVR_WAIT_CALL_COMPLETED',
  TWILIO_IVR_WAIT_BOTIUM_RESPONSE: 'TWILIO_IVR_WAIT_BOTIUM_RESPONSE'
}
const Defaults = {
  [Capabilities.TWILIO_IVR_RECORD]: false,
  [Capabilities.TWILIO_IVR_REDIAL]: 5,
  [Capabilities.TWILIO_IVR_LANGUAGE_CODE]: 'en-US',
  [Capabilities.TWILIO_IVR_WAIT_CALL_STARTED]: 20000,
  [Capabilities.TWILIO_IVR_WAIT_CALL_COMPLETED]: 10000,
  [Capabilities.TWILIO_IVR_WAIT_BOTIUM_RESPONSE]: 5000
}

const RequiredCapabilities = [
  Capabilities.TWILIO_IVR_ACCOUNT_SID,
  Capabilities.TWILIO_IVR_AUTH_TOKEN,
  Capabilities.TWILIO_IVR_FROM,
  Capabilities.TWILIO_IVR_TO,
  Capabilities.TWILIO_IVR_LANGUAGE_CODE,
  Capabilities.TWILIO_IVR_PUBLICURL,
  Capabilities.TWILIO_IVR_REDIAL,
  Capabilities.TWILIO_IVR_WAIT_CALL_STARTED,
  Capabilities.TWILIO_IVR_WAIT_CALL_COMPLETED,
  Capabilities.TWILIO_IVR_WAIT_BOTIUM_RESPONSE
]

class BotiumConnectorTwilioIvr {
  constructor ({ container, queueBotSays, eventEmitter, caps }) {
    this.container = container
    this.queueBotSays = queueBotSays
    this.eventEmitter = eventEmitter
    this.caps = Object.assign({}, Defaults, caps)
    this.processingEvents = false
    this.eventListeners = {}
  }

  async Validate () {
    debug('Validate called')
    for (const capName of RequiredCapabilities) {
      if (!this.caps[capName]) throw new Error(`${capName} capability required`)
    }
  }

  async Build () {
    debug('Build called')
    this.client = twilio(this.caps[Capabilities.TWILIO_IVR_ACCOUNT_SID], this.caps[Capabilities.TWILIO_IVR_AUTH_TOKEN])
    await this._buildInbound()
  }

  async Start () {
    await this._subscribeInbound()

    let lastErr = null
    for (let trial = 0; trial < this.caps[Capabilities.TWILIO_IVR_REDIAL]; trial++) {
      try {
        this.call = await this._createCall()
        await this.processOutboundEvent({
          sid: this.call.sid,
          type: EVENT_INIT_CALL,
          publicUrl: this.caps[Capabilities.TWILIO_IVR_PUBLICURL],
          languageCode: this.caps[Capabilities.TWILIO_IVR_LANGUAGE_CODE],
          responseTime: this.caps[Capabilities.TWILIO_IVR_WAIT_BOTIUM_RESPONSE]
        })
        await this._waitForInboundEvent(EVENT_CALL_STARTED, this.caps[Capabilities.TWILIO_IVR_WAIT_CALL_STARTED])
        debug(`Call initiated ${this.call.sid} at trial #${trial + 1}`)
        break
      } catch (err) {
        lastErr = err
        debug(`Call initialization trial #${trial + 1} failed: ${err.message}`)
        if (this.call) {
          try {
            await this.call.update({ status: 'completed' })
          } catch (err) {
            debug(`Call completion for trial #${trial + 1} failed, ignoring: ${err.message}`)
          }
          this.call = null
        }
      }
    }
    if (!this.call) {
      throw new Error(`Call initialization failed: ${lastErr && lastErr.message}`)
    }
  }

  async UserSays (msg) {
    if (!this.processOutboundEvent || !this.call) {
      throw new Error('Call not initialized')
    }
    debug(`Sending outboundEvent EVENT_USER_SAYS for call ${this.call.sid}`)
    await this.processOutboundEvent({
      sid: this.call.sid,
      type: EVENT_USER_SAYS,
      messageText: msg.messageText,
      buttons: msg.buttons
    })
  }

  async Stop () {
    try {
      if (this.call) {
        debug(`Setting Call Status completed for call ${this.call.sid}`)
        await this.call.update({ status: 'completed' })
        await this._waitForInboundEvent(EVENT_CALL_COMPLETED, this.caps[Capabilities.TWILIO_IVR_WAIT_CALL_COMPLETED])
      }
    } catch (err) {
      throw new Error(`Failed to set call status for ${this.call.sid} to completed: ${err.message}`)
    } finally {
      this.call = null
      await this._unsubscribeInbound()
    }
  }

  async Clean () {
    return this._cleanInbound()
  }

  _createCall () {
    let endpointBase = this.caps[Capabilities.TWILIO_IVR_PUBLICURL]
    if (!endpointBase.endsWith('/')) endpointBase = endpointBase + '/'

    const callParams = {
      url: `${endpointBase}${WEBHOOK_ENDPOINT_START}`,
      to: this.caps[Capabilities.TWILIO_IVR_TO],
      from: this.caps[Capabilities.TWILIO_IVR_FROM],
      record: this.caps[Capabilities.TWILIO_IVR_RECORD],
      statusCallback: `${endpointBase}${WEBHOOK_STATUS_CALLBACK}`,
      statusCallbackEvent: ['completed', 'answered']
    }
    debug(`Initiating call ${JSON.stringify(callParams)}`)
    return this.client.calls.create(callParams)
  }

  async _processInboundEvent ({ sid, type, ...rest }) {
    if (!this.call || this.call.sid !== sid) return

    debug(`_processInboundEvent for ${sid}, event ${type}, content ${JSON.stringify(rest)}`)

    if (this.caps[Capabilities.TWILIO_IVR_RECORD] && rest.sourceData && rest.sourceData.RecordingUrl) {
      const mp3RecordingUrl = `${rest.sourceData.RecordingUrl}.mp3`
      try {
        const res = await fetch(mp3RecordingUrl)
        debug(`Downloaded recording for ${sid} from ${mp3RecordingUrl}`)
        const bodyBase64 = (await res.buffer()).toString('base64')
        this.eventEmitter.emit('MESSAGE_ATTACHMENT', this.container, {
          base64: bodyBase64,
          mimeType: 'audio/mpeg'
        })
      } catch (err) {
        debug(`Failed to download recording for ${sid}: ${err.message}`)
      }
    }

    if (this.eventListeners[type]) {
      this.eventListeners[type].forEach(el => el({ sid, type, ...rest }))
      this.eventListeners[type] = []
    }
    if (type === EVENT_BOT_SAYS) {
      const botSays = { sender: 'bot', sourceData: rest.sourceData, messageText: rest.botSays }
      this.queueBotSays(botSays)
    } else if (type === EVENT_CALL_FAILED) {
      debug(`Call for ${sid} failed: ${JSON.stringify(rest)}`)
      this.call = null
      await this._unsubscribeInbound()
    } else if (type === EVENT_CALL_COMPLETED) {
      debug(`Call for ${sid} completed: ${JSON.stringify(rest)}`)
      this.call = null
      await this._unsubscribeInbound()
    }
  }

  async _waitForInboundEvent (type, timeout) {
    debug(`_waitForInboundEvent: Waiting for event ${type} for ${timeout}ms`)

    if (!this.eventListeners[type]) this.eventListeners[type] = []

    const result = new Promise((resolve, reject) => {
      let timedOut = false
      const to = setTimeout(() => {
        timedOut = true
        reject(new Error((`_waitForInboundEvent: Waiting for event ${type} timed out after ${timeout}ms`)))
      }, timeout)

      this.eventListeners[type].push((event) => {
        if (timedOut) return

        debug(`_waitForInboundEvent: Waiting for event ${type} for ${timeout}ms succeeded`)
        clearTimeout(to)
        resolve(event)
      })
    })
    return result
  }

  async _buildInbound () {
    if (this.caps[Capabilities.TWILIO_IVR_REDISURL]) {
      const topicOutbound = getTopicOutbound(this.caps[Capabilities.TWILIO_IVR_REDIS_TOPICBASE])

      const redisurl = this.caps[Capabilities.TWILIO_IVR_REDISURL]
      this.redisSubscriber = new Redis(redisurl)
      this.redisSubscriber.on('connect', () => {
        debug(`Redis subscriber connected to ${JSON.stringify(redisurl || 'default')}`)
      })
      this.redisClient = new Redis(redisurl)
      this.redisClient.on('connect', () => {
        debug(`Redis client connected to ${JSON.stringify(redisurl || 'default')}`)
      })
      this.redisSubscriber.on('message', (channel, event) => {
        try {
          event = JSON.parse(event)
        } catch (err) {
          return debug(`WARNING: received non-json message from ${channel}, ignoring: ${event}`)
        }
        if (this.processingEvents) {
          this._processInboundEvent(event)
            .then(() => debug(`Processed Inbound Event: ${JSON.stringify(event)}`))
            .catch((err) => debug(`Processing Inbound Event failed: ${err.message} - ${JSON.stringify(event)}`))
        }
      })
      this.processOutboundEvent = (event) => {
        try {
          this.redisClient.publish(topicOutbound, JSON.stringify(event))
        } catch (err) {
          debug(`Error while publishing to redis: ${err.message}`)
        }
      }
    } else if (this.caps[Capabilities.TWILIO_IVR_INBOUNDPORT]) {
      const { proxy, processOutboundEvent } = await startProxy({
        port: this.caps[Capabilities.TWILIO_IVR_INBOUNDPORT],
        endpointBase: this.caps[Capabilities.TWILIO_IVR_INBOUNDENDPOINT],
        processInboundEvent: (event) => {
          if (this.processingEvents) {
            this._processInboundEvent(event)
              .then(() => debug(`Processed Inbound Event: ${JSON.stringify(event)}`))
              .catch((err) => debug(`Processing Inbound Event failed: ${err.message} - ${JSON.stringify(event)}`))
          }
        }
      })
      this.proxy = proxy
      this.processOutboundEvent = processOutboundEvent
    } else {
      throw new Error('No inbound channel configured (either HTTP inbound or redis')
    }
  }

  async _subscribeInbound () {
    this.eventListeners = {}
    this.processingEvents = true
    if (this.redisSubscriber) {
      const topicInbound = getTopicInbound(this.caps[Capabilities.TWILIO_IVR_REDIS_TOPICBASE])
      try {
        const count = await this.redisSubscriber.subscribe(topicInbound)
        debug(`Redis subscribed to ${count} channels. Listening for inbound messages on the ${topicInbound} channel.`)
      } catch (err) {
        debug(err)
        throw new Error(`Redis failed to subscribe channel ${topicInbound}: ${err.message || err}`)
      }
    }
  }

  async _unsubscribeInbound () {
    this.processingEvents = false
    if (this.redisSubscriber) {
      const topicInbound = getTopicInbound(this.caps[Capabilities.TWILIO_IVR_REDIS_TOPICBASE])
      try {
        await this.redisSubscriber.unsubscribe(topicInbound)
        debug(`Redis unsubscribed from ${topicInbound} channel.`)
      } catch (err) {
        debug(err)
        throw new Error(`Redis failed to unsubscribe channel ${topicInbound}: ${err.message || err}`)
      }
    }
  }

  async _cleanInbound () {
    if (this.redisSubscriber) {
      this.redisSubscriber.disconnect()
      this.redisSubscriber = null
    }
    if (this.redisClient) {
      this.redisClient.disconnect()
      this.redisClient = null
    }
    if (this.proxy) {
      this.proxy.close()
      this.proxy = null
    }
    this.processOutboundEvent = null
  }
}

module.exports = BotiumConnectorTwilioIvr
