#!/usr/bin/env node
const util = require('util')
const yargsCmd = require('yargs')
const { buildRedisHandlers, startProxy } = require('../src/proxy')

const debug = require('debug')('botium-twilio-ivr-proxy-cli')

const wrapHandler = (builder) => {
  const origHandler = builder.handler
  builder.handler = (argv) => {
    if (argv.verbose) {
      require('debug').enable('botium*')
    }
    debug(`command options: ${util.inspect(argv)}`)
    origHandler(argv)
  }
  return builder
}

yargsCmd.usage('Botium Twilio IVR Proxy\n\nUsage: $0 [options]') // eslint-disable-line
  .help('help').alias('help', 'h')
  .version('version', require('../package.json').version).alias('version', 'V')
  .showHelpOnFail(true)
  .strict(true)
  .demandCommand(1, 'You need at least one command before moving on')
  .env('BOTIUM_TWILIO_IVR')
  .command(wrapHandler({
    command: 'start',
    describe: 'Launch Botium Twilio IVR Proxy',
    builder: (yargs) => {
      yargs
        .option('port', {
          describe: 'Local port the proxy is listening to (also read from env variable "BOTIUM_TWILIO_IVR_PORT")',
          number: true,
          default: 5001
        })
        .option('redisurl', {
          describe: 'Redis connection url, ex "redis://my-redis-host:6379" (also read from env variable "BOTIUM_TWILIO_IVR_REDISURL")',
          demandOption: false
        })
    },
    handler: async (argv) => {
      const { sessionStore, processInboundEvent } = await buildRedisHandlers(argv.redisurl)
      await startProxy({
        port: argv.port,
        endpointBase: '/',
        processInboundEvent,
        sessionStore
      })
    }
  }))
  .option('verbose', {
    alias: 'v',
    type: 'boolean',
    describe: 'Enable verbose output (also read from env variable "BOTIUM_TWILIO_IVR_VERBOSE" - "1" means verbose)',
    default: false
  })
  .argv
