const fs = require('fs')
const path = require('path')
const PluginClass = require('./src/connector')

const languageCsv = fs.readFileSync(path.join(__dirname, 'language-tags.csv'), 'utf-8')
const languages = languageCsv.split('\n').filter((l, i) => l.length && i >= 1).map(l => l.trim()).map(l => {
  if (l.startsWith('"')) {
    return {
      name: l.substring(1, l.indexOf('"', 1)),
      key: l.split(',')[1]
    }
  } else {
    return {
      name: l.split(',')[0],
      key: l.split(',')[1]
    }
  }
})

module.exports = {
  PluginVersion: 1,
  PluginClass: PluginClass,
  PluginDesc: {
    name: 'Botium Connector for IVR Systems',
    capabilities: [
      {
        name: 'TWILIO_IVR_ACCOUNT_SID',
        label: 'Twilio Account SID',
        description: 'Account SID from Twilio account',
        type: 'string',
        required: true
      },
      {
        name: 'TWILIO_IVR_AUTH_TOKEN',
        label: 'Twilio Auth Token',
        description: 'Auth Token from Twilio account',
        type: 'secret',
        required: true
      },
      {
        name: 'TWILIO_IVR_FROM',
        label: 'Caller Id',
        description: 'Purchased or Verified phone number from Twilio account',
        type: 'string',
        required: true
      },
      {
        name: 'TWILIO_IVR_TO',
        label: 'IVR Phone Number',
        description: 'Phone number to call',
        type: 'string',
        required: true
      },
      {
        name: 'TWILIO_IVR_LANGUAGE_CODE',
        label: 'Language',
        description: 'Language of the IVR System (for Speech Recognition)',
        type: 'choice',
        required: true,
        choices: languages
      },
      {
        name: 'TWILIO_IVR_PUBLICURL',
        label: 'Webhook Url',
        description: 'Public accessible Webhook Url',
        type: 'query',
        required: true,
        query: async (caps, ctx) => {
          const baseLink = `${ctx.request.protocol}://${ctx.request.headers.host}/api/twilio`
          return [{
            name: baseLink,
            key: baseLink
          }]
        }
      },
      {
        name: 'TWILIO_IVR_PUBLICURLPARAMS',
        label: 'Webhook Url Params',
        description: 'Additional Webhook Url Parameters (Api Key)',
        type: 'query',
        required: true,
        query: async (caps, ctx) => {
          const keys = await ctx.db.query.apiKeys({ orderBy: 'name_ASC' }, '{ id name key }')
          return keys.map(k => ({
            name: k.name,
            key: `APIKEY=${k.key}`
          }))
        }
      },
      {
        name: 'TWILIO_IVR_RECORD',
        label: 'Record Calls',
        description: 'Call recordings will be attached to the Botium conversations after hangup.',
        type: 'boolean'
      }
    ]
  }
}
