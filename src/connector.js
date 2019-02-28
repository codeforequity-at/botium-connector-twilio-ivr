const debug = require('debug')('botium-twilio-ivr-connector')
const util = require('util')
const twilio = require('twilio')
const kue = require('kue')

const {WEBHOOK_ENDPOINT_START, WEBHOOK_STATUS_CALLBACK, getTopicName, EVENT_CALL_COMPLETED, EVENT_USER_DISCONNECTED, EVENT_CONFIRMED} = require('./shared')

const STARTED_BY_BOT = 'STARTED_BY_BOT'
const ENDED_BY_USER_REASON_STOP = 'ENDED_BY_USER_REASON_STOP'

const Capabilities = {
  TWILIO_IVR_ACCOUNT_SID: 'TWILIO_IVR_ACCOUNT_SID',
  TWILIO_IVR_AUTH_TOKEN: 'TWILIO_IVR_AUTH_TOKEN',
  TWILIO_IVR_FROM: 'TWILIO_IVR_FROM',
  TWILIO_IVR_TO: 'TWILIO_IVR_TO',
  TWILIO_IVR_REDISURL: 'TWILIO_IVR_REDISURL',
  TWILIO_IVR_PUBLICURL: 'TWILIO_IVR_PUBLICURL'
}

const { TWILIO_IVR_REDISURL, ...RequiredCapabilities } = Capabilities

class BotiumConnectorTwilioIvr {
  constructor ({ queueBotSays, caps }) {
    this.queueBotSays = queueBotSays
    this.caps = caps
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
    this.queue = await this._buildRedis()
  }

  async Start () {
    debug('Start called')
    if (this.convoSession && !this.convoSession.finished) {
      throw Error(`It is not possible to start a new conversation if the previous is not finished! ${this.convoSession}`)
    }

    if (this.jobContext) {
      throw Error(`It is not possible to start a new conversation step if the previous step is not finished! ${this.jobContext}`)
    }
    this.convoSession = {status: {}}
    debug('Conversation started')

    const call = await this._createCall()
    debug(`Call initiated ${call.sid}`)

    this.convoSession.call = call
    this._listenToJobQueue(getTopicName(call.sid))
  }

  async UserSays (msg) {
    debug(`UserSays called ${util.inspect(msg)}`)
    if (this.convoSession.status.endedByBotReason) {
      throw new Error(`Bot already ended the call ${this.convoSession.status.endedByBotReason}`)
    }
    if (this.convoSession.status.startedBy !== STARTED_BY_BOT) {
      this.convoSession.status.dead = true
      throw new Error('Illegal state, conversation should be started by bot!')
    }

    this._checkJobContext({userSays: msg})
  }

  async Stop () {
    debug('Stop called')
    this.convoSession.finished = true
    if (!this.convoSession.status.endedByBotReason) {
      if (!this.convoSession.status.endedByUserReason) {
        this.convoSession.status.endedByUserReason = ENDED_BY_USER_REASON_STOP
        if (this.jobContext) {
          debug('Conversation already ended by user, we have to inform proxy about it')
          this._checkJobContext({convoFinished: true})
        } else {
          // this case means, that called is busy, or number is wrong. Or anything else?
          debug('We dont have job context, cant inform proxy about stop')
        }
      } else {
        throw Error(`Illegal state, this.convoSession.status.endedByUserReason already set to  ${this.convoSession.status.endedByUserReason}!`)
      }
    } else {
      debug('Conversation already ended by bot')
    }
    if (this.jobContext) {
      throw Error('Illegal state, job context is not finished')
    }
    debug('Conversation finished')
  }

  async Clean () {
    debug('Clean called')
    this.client = null
    this._cleanRedis()
  }

  _buildRedis () {
    const queueSettings = {redis: this.caps[Capabilities.TWILIO_IVR_REDISURL]}
    const queue = kue.createQueue(queueSettings)
    queue.on('error', (err) => {
      debug(`Communication error with Redis '${util.inspect(queueSettings)}': ${util.inspect(err)}`)
    })
    return queue
  }

  _listenToJobQueue (topic) {
    debug(`Listening to jobs on ${topic}`)

    this.queue.process(topic, (job, done) => {
      debug(`Job received ${util.inspect(job.data)}`)
      if (job.data.event) {
        if (job.data.event === EVENT_CALL_COMPLETED) {
          if (!this.convoSession.status.endedByUserReason) {
            if (!this.convoSession.status.endedByBotReason) {
              this.convoSession.status.endedByBotReason = job.data.event
              debug(`Job event: Bot ended the call ${job.data.event}`)
              this._checkJobContext({done, eventInJob: job.data.event})
            } else {
              const e = `Illegal state, this.convoSession.status.endedByBotReason already set to ${this.convoSession.status.endedByBotReason}`
              debug(e)
              throw Error(e)
            }
          } else {
            debug(`Conversation is already finished by user, just got event from finished call. Nothing to do`)
          }
        } else {
          debug(`Job event: Bot ended the call ${job.data.event}`)
          this._checkJobContext({done, eventInJob: job.data.event})
        }
      } else {
        if (!this.convoSession.finished) {
          if (!this.convoSession.status.startedBy) {
            this.convoSession.status.startedBy = STARTED_BY_BOT
            debug(`Convo session status: STARTED_BY_BOT`)
          }
          this._checkJobContext({done, botSays: job.data.msg})
        } else {
          const errorMessage = 'Illegal state, phone call is not finished, but testcase is!'
          debug(errorMessage)
          this._checkJobContext({done, error: new Error(errorMessage)})
        }
      }
    })
  }

  /**
   * Finishes the job if convoStep is done
   * @param jobContext
   * @private
   */
  _checkJobContext (jobContext = {}) {
    debug(`Checking job context start`)
    if (!this.jobContext) {
      debug(`Starting job context ${util.inspect(jobContext)}`)
      this.jobContext = jobContext
    } else {
      debug(`Continue job context ${util.inspect(this.jobContext)} With ${util.inspect(jobContext)}`)
      this.jobContext = Object.assign(this.jobContext, jobContext)
    }

    if (this.jobContext.botSays) {
      if (!this.jobContext.botSaysSent) {
        const botSays = {sender: 'bot', sourceData: this.jobContext.msg, messageText: this.jobContext.botSays.messageText}
        this.queueBotSays(botSays)
        this.jobContext.botSaysSent = true
        debug(`BotSays sent ${util.inspect(botSays)}`)
      } else {
        debug(`BotSays already sent`)
      }
    } else {
      debug(`BotSays not set, nothing to send`)
    }

    let response
    if (this.jobContext.done && (this.jobContext.userSays || this.jobContext.error || this.jobContext.convoFinished || this.jobContext.eventInJob)) {
      if (this.jobContext.error) {
        response = this.jobContext.error
        // this is an error case
        this.jobContext.done(response)
      } else if (this.jobContext.convoFinished) {
        response = {sid: this.convoSession.call.sid, event: EVENT_USER_DISCONNECTED}
        this.jobContext.done(null, response)
      } else if (this.jobContext.eventInJob) {
        response = {sid: this.convoSession.call.sid, event: EVENT_CONFIRMED}
        this.jobContext.done(null, response)
      } else if (this.jobContext.userSays) {
        response = {sid: this.convoSession.call.sid, msg: this.jobContext.userSays}
        this.jobContext.done(null, response)
      } else {
        throw Error('Illegal state, convo state is not consistent!')
      }
      debug(`Job processed, response sent: ${util.inspect(response)}`)
      this.jobContext = null
      debug('Job context cleaned up')
    } else {
      debug(`Can't respond to job yet, job context is not cleaned up`)
    }
    debug(`Checking job context end`)
  }

  _cleanRedis () {
    if (this.redis) {
      this.redis.disconnect()
      this.redis = null
    }
  }

  _createCall () {
    const callParams = {
      url: `${this.caps[Capabilities.TWILIO_IVR_PUBLICURL]}${WEBHOOK_ENDPOINT_START}`,
      to: this.caps[Capabilities.TWILIO_IVR_TO],
      from: this.caps[Capabilities.TWILIO_IVR_FROM],
      statusCallback: `${this.caps[Capabilities.TWILIO_IVR_PUBLICURL]}${WEBHOOK_STATUS_CALLBACK}`,
      // Dont get busy event???
      statusCallbackEvent: ['completed', 'busy', 'failed', 'no-answer']
      // statusCallbackEvent: ['queued', 'ringing', 'in-progress', 'completed', 'busy', 'failed', 'no-answer', 'initiated', 'answered']

    }
    debug(`Initiating call ${util.inspect(callParams)}`)
    return this.client.calls
      .create(callParams)
  }
}

module.exports = BotiumConnectorTwilioIvr
