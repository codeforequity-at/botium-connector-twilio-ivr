const debug = require('debug')('botium-twilio-ivr-connector')
const util = require('util')
const twilio = require('twilio')

const {
  WEBHOOK_ENDPOINT_START,
  WEBHOOK_STATUS_CALLBACK,
  EVENT_INIT_CALL,
  EVENT_USER_SAYS,
  EVENT_BOT_SAYS,
  EVENT_CALL_COMPLETED
} = require('./shared')

const { startProxy } = require('./proxy')

const Capabilities = {
  TWILIO_IVR_ACCOUNT_SID: 'TWILIO_IVR_ACCOUNT_SID',
  TWILIO_IVR_AUTH_TOKEN: 'TWILIO_IVR_AUTH_TOKEN',
  TWILIO_IVR_FROM: 'TWILIO_IVR_FROM',
  TWILIO_IVR_TO: 'TWILIO_IVR_TO',
  TWILIO_LANGUAGE_CODE: 'TWILIO_LANGUAGE_CODE',
  TWILIO_IVR_REDISURL: 'TWILIO_IVR_REDISURL',
  TWILIO_IVR_INBOUNDPORT: 'TWILIO_IVR_INBOUNDPORT',
  TWILIO_IVR_INBOUNDENDPOINT: 'TWILIO_IVR_INBOUNDENDPOINT',
  TWILIO_IVR_PUBLICURL: 'TWILIO_IVR_PUBLICURL'
}

const { TWILIO_IVR_REDISURL, TWILIO_IVR_INBOUNDPORT, TWILIO_IVR_INBOUNDENDPOINT, ...RequiredCapabilities } = Capabilities

class BotiumConnectorTwilioIvr {
  constructor ({ queueBotSays, caps }) {
    this.queueBotSays = queueBotSays
    this.caps = caps
    this.processingEvents = false
  }

  async Validate () {
    debug('Validate called')
    for (const cap of Object.keys(RequiredCapabilities)) {
      if (!this.caps[Capabilities[cap]]) throw new Error(`${Capabilities[cap]} capability required`)
    }
  }

  async Build () {
    debug('Build called')
    this.client = twilio(this.caps[Capabilities.TWILIO_IVR_ACCOUNT_SID], this.caps[Capabilities.TWILIO_IVR_AUTH_TOKEN])
    await this._buildInbound()
  }

  async Start () {
    debug('Start called')

    //todo retry
    this.call = await this._createCall()
    debug(`Call initiated ${this.call.sid}`)
    await this._subscribeInbound()
    await this.processOutboundEvent({
      sid: this.call.sid,
      type: EVENT_INIT_CALL,
      publicUrl: this.caps[Capabilities.TWILIO_IVR_PUBLICURL],
      languageCode: this.caps[Capabilities.TWILIO_LANGUAGE_CODE]
    })
  }

  async UserSays (msg) {
    debug(`UserSays called`)
    if (!this.processOutboundEvent || !this.call) {
      throw new Error('Call not initialized')
    }
    await this.processOutboundEvent({
      sid: this.call.sid,
      type: EVENT_USER_SAYS,
      messageText: msg.messageText,
      buttons: msg.buttons 
    })
  }

  async Stop () {
    await this._unsubscribeInbound()
    if (this.call) {
      try {
        await this.call.update({ status: 'completed' })
      } catch (err) {
        throw new Error(`Failed to set call status for ${this.call.sid} to completed: ${err.message}`)
      } finally {
        this.call = null
      }
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
      record: false,
      statusCallback: `${endpointBase}${WEBHOOK_STATUS_CALLBACK}`,
      statusCallbackEvent: ['completed']
    }
    debug(`Initiating call ${util.inspect(callParams)}`)
    return this.client.calls.create(callParams)
  }

  _processInboundEvent ({ sid, type, ...rest }) {
    if (!this.call || this.call.sid !== sid) return

    if (type === EVENT_BOT_SAYS) {
      const botSays = {sender: 'bot', sourceData: rest.sourceData, messageText: rest.botSays}
      this.queueBotSays(botSays)
    } else if (type === EVENT_CALL_COMPLETED) {
      debug(`Call completed: ${util.inspect(rest.sourceData)}`)      
    }
  }

  async _buildInbound () {
    if (this.caps[Capabilities.TWILIO_IVR_INBOUNDPORT]) {
      const { proxy, processOutboundEvent } = await startProxy({
        port: this.caps[Capabilities.TWILIO_IVR_INBOUNDPORT],
        endpointBase: this.caps[Capabilities.TWILIO_IVR_INBOUNDENDPOINT],
        processInboundEvent: (event) => {
          if (this.processingEvents) {
            debug('Got Inbound Event:')
            debug(JSON.stringify(event, null, 2))
            this._processInboundEvent(event)
          }
        }
      })
      this.proxy = proxy
      this.processOutboundEvent = processOutboundEvent
    }
  }

  async _subscribeInbound () {
    this.processingEvents = true

  }

  async _unsubscribeInbound () {
    this.processingEvents = false

  }

  async _cleanInbound () {

    if (this.proxy) {
      this.proxy.close()
      this.proxy = null
    }
    this.processOutboundEvent = null
  }
}

module.exports = BotiumConnectorTwilioIvr
