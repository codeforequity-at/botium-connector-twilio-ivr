const debug = require('debug')('botium-connector-twilio-ivr-asserter-sms')

class BotiumAsserterTwilioSms {
  constructor (context, caps = {}, args = {}) {
    this.context = context
    this.caps = caps
    this.globalArgs = args
  }

  assertConvoStep ({ transcript, ...rest }) {
    return this._checkMessage({
      dateSentAfter: transcript.convoBegin,
      ...rest
    })
  }

  async assertConvoEnd ({ transcript, ...rest }) {
    return this._checkMessage({
      dateSentAfter: transcript.convoBegin,
      ...rest
    })
  }

  async _checkMessage ({ container, dateSentAfter, args }) {
    const client = container.pluginInstance.client
    if (!client) throw new Error('Twilio Client not available')

    const receiver = container.pluginInstance.caps.TWILIO_IVR_FROM
    let messages = null
    try {
      messages = await client.messages.list({
        dateSentAfter,
        to: receiver,
        limit: 10
      })
      messages = messages.filter(m => m.direction === 'inbound')
      debug(`Twilio Client received ${messages.length} inbound SMS for ${receiver} since ${dateSentAfter}`)
      if (debug.enabled) {
        for (const [i, m] of messages.entries()) {
          debug(`#${i}: SID ${m.sid} SENT: ${m.dateSent} FROM: ${m.from} TO: ${m.to} BODY: ${m.body}`)
        }
      }
    } catch (err) {
      throw new Error(`Twilio Client failed to list received SMS: ${err.message}`)
    }

    if (args && args.length > 0) {
      for (const arg of args) {
        const matched = messages.filter(m => this.context.Match(m.body, arg))
        if (!matched || matched.length === 0) {
          throw new Error(`No SMS matching "${arg}" received for ${receiver} since ${dateSentAfter}`)
        }
      }
    } else {
      if (!messages || messages.length === 0) {
        throw new Error(`No SMS received for ${receiver} since ${dateSentAfter}`)
      }
    }
  }
}

module.exports = BotiumAsserterTwilioSms
