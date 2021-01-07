# Botium Connector for Twilio IVR

[![NPM](https://nodei.co/npm/botium-connector-twilio-ivr.png?downloads=true&downloadRank=true&stars=true)](https://nodei.co/npm/botium-connector-twilio-ivr/)

[![Codeship Status for codeforequity-at/botium-connector-twilio-ivr](https://app.codeship.com/projects/184b7020-1d79-0137-4301-5aea4b3287ff/status?branch=master)](https://app.codeship.com/projects/329045)
[![npm version](https://badge.fury.io/js/botium-connector-twilio-ivr.svg)](https://badge.fury.io/js/botium-connector-twilio-ivr)
[![license](https://img.shields.io/github/license/mashape/apistatus.svg)]()

This is a [Botium](https://github.com/codeforequity-at/botium-core) connector for testing IVR (Interactive Voice Response)
bots by phone call.

__Did you read the [Botium in a Nutshell](https://medium.com/@floriantreml/botium-in-a-nutshell-part-1-overview-f8d0ceaf8fb4) articles? Be warned, without prior knowledge of Botium you won't be able to properly use this library!__

## How it works
Uses [Programmable Voice](https://www.twilio.com/docs/voice) of [Twilio](https://www.twilio.com/) 
to make calls. See [Pricing of Twilio](https://www.twilio.com/voice/pricing).

This connector is separated into two parts.
* To communicate with Twilio we have to provide webhook endpoints. See Botium webhook service.     
* The Connector can be used as any other Botium connector with all Botium Stack components:
  * [Botium CLI](https://github.com/codeforequity-at/botium-cli/)
  * [Botium Bindings](https://github.com/codeforequity-at/botium-bindings/)
  * [Botium Box](https://www.botium.at)
* The Connector, and the Webhooks are communicating via __Redis__ 

Supports DTMF (accepted characters: "0123456789*#w". w is 0,5s delay). Example:

```
#me
BUTTON 012w345
```


## Limitations
1. Twilio uses Text To Speech, and Speech To Text. A test can fail if TTS or STT is not converting the text well.
2. It is not possible to send DTMF and speech like this:
```
#me
Hello
BUTTON 1
```

3. Special fail cases:
   * If the dialed number is wrong, or not permitted, then the testcase will fail with error
   * If the bot answers the phone, then error handling follows Botium standards
   * In every other case (For example he is busy, or picks up the phone but does not say anything, or number is temporary not available...) then the test will fail with timeout
4. Flow:
   * We expect that the bot starts the conversation. (Otherwise call initiated, but you got error while phone ringing: error sending to bot Error: Illegal state, conversation should be started by bot!)

## Prerequisites

* __Node.js and NPM__
* (optional) a __Redis__ instance (Cloud hosted free tier for example from [redislabs](https://redislabs.com/) will do as a starter)
* __Twilio Account__ (Trial account is not sufficent because [Limitations](https://www.twilio.com/docs/usage/tutorials/how-to-use-your-free-trial-account#trial-account-restrictions-and-limitations)) 
    * Sign up at [Twilio](https://www.twilio.com/try-twilio)
    * [Upgrade trial account](https://www.twilio.com/docs/usage/tutorials/how-to-use-your-free-trial-account#how-to-upgrade-your-account)
    * [Note accountSid and authToken](https://www.twilio.com/docs/voice/quickstart/node#replace-the-placeholder-credential-values) 
* __[Purchased](https://www.twilio.com/docs/voice/quickstart/node#sign-up-for-twilio-and-get-a-phone-number), or [verified](https://www.twilio.com/docs/usage/tutorials/how-to-use-your-free-trial-account#verify-your-personal-phone-number) phone number__ (Otherwise you got error: The source phone number provided, xxxxxxxxxx, is not yet verified for your account. You may only make calls from phone numbers that you've verified or purchased from Twilio.) 
* __[Enabled call destination](https://www.twilio.com/console/voice/calls/geo-permissions/low-risk)__ (Otherwise you got error: "Account not authorized to call xxxxxxxxxx. Perhaps you need to enable some international permissions: https://www.twilio.com/console/voice/calls/geo-permissions/low-risk")
* a __project directory__ on your workstation to hold test cases and Botium configuration    

## Install Botium and Twilio IVR Connector

When using __Botium CLI__:

```
> npm install -g botium-cli
> npm install -g botium-connector-twilio-ivr
> botium-cli init
> botium-cli run
```

When using __Botium Bindings__:

```
> npm install -g botium-bindings
> npm install -g botium-connector-twilio-ivr
> botium-bindings init mocha
> npm install && npm run mocha
```

When using __Botium Box__:

_Already integrated into Botium Box, no setup required_

## Install and Run the Botium Twilio Webhook Proxy

**If the host you are running Botium can be reached from publich internet (directly or via a service like ngrok) you can skip this step**

Twilio communicates with Botium by calling webhooks published locally by Botium. If the host you are running Botium is not reachable from public internet, you have to run an additional component on a host which can be reached from public internet.

* Call is initiated by the Botium Connector
* After the call is established, it is controlled by Botium Twilio Webhook Proxy via 3 webhooks
* Botium Twilio Webhook Proxy communicates with the Botium Connector via Redis

If you are using Botium Box, then the Botium webhook service is integrated.

Installation with NPM:

    > npm install -g botium-connector-twilio-ivr
    > botium-twilio-ivr-proxy-cli start --help

There are several options required for running the Botium webhook service:

_--port_: Local port to listen (optional, default _5001_)

_--redisurl_: Redis connection url, ex "redis://my-redis-host:6379" 

Botium is providing the service, but you have to take care for connectivity and process management yourself:
* If your server is not reachable from the internet, consider to use a service like [ngrok](https://ngrok.com/) for publishing your endpoint (If you use ngrok start it on the port of the Webhook Service)
* For process management, logging, monitoring we recommend to use [pm2](https://pm2.keymetrics.io)

## Connecting Twilio to Botium

Open the file _botium.json_ in your working directory fill it. See Supported Capabilities. 

```
{
  "botium": {
    "Capabilities": {
      "PROJECTNAME": "<whatever>",
      "CONTAINERMODE": "twilio-ivr",
      "TWILIO_IVR_ACCOUNT_SID": "...",
      "TWILIO_IVR_AUTH_TOKEN": "...",
      "TWILIO_IVR_FROM": "...",
      "TWILIO_IVR_TO": "...",
      "TWILIO_IVR_REDISURL" : "...",
      "TWILIO_IVR_PUBLICURL": "...",
      "TWILIO_IVR_LANGUAGE_CODE": "en-US"
    }
  }
}
```

Botium setup is ready, you can begin to write your [BotiumScript](https://github.com/codeforequity-at/botium-core/wiki/Botium-Scripting) files.

## Checking for received SMS

A common use case is to verify that an SMS has been received during the call to an IVR engine.

Add the asserter to your botium.json:

```
  ...
  "ASSERTERS": [
    {
      "ref": "CHECKTWILIOSMS",
      "src": "botium-connector-twilio-ivr/CHECKTWILIOSMS"
    }
  ]
  ...
```

Use it in the _#end_-section to verify that an SMS has been received by the caller:

    #end
    CHECKTWILIOSMS

Or check for the content of the SMS (a common pattern is to give it some time to receive the SMS, in this example 10 seconds):

    #end
    PAUSE 10000
    CHECKTWILIOSMS welcome to our service

## Supported Capabilities

Set the capability __CONTAINERMODE__ to __twilio-ivr__ to activate this connector.

### TWILIO_IVR_ACCOUNT_SID

See accountSid in Prerequisites

### TWILIO_IVR_AUTH_TOKEN

See authToken in Prerequisites

### TWILIO_IVR_FROM

[Purchased](https://www.twilio.com/docs/voice/quickstart/node#sign-up-for-twilio-and-get-a-phone-number), or [verified](https://www.twilio.com/docs/usage/tutorials/how-to-use-your-free-trial-account#verify-your-personal-phone-number) phone number  

### TWILIO_IVR_TO

Arbitary telephone number. It must be [enabled](https://www.twilio.com/console/voice/calls/geo-permissions/low-risk) 

### TWILIO_IVR_PUBLICURL

URL on which Botium (or the Botium Twilio Webhook Proxy) is reachable from public internet.

If you are using ngrok, then it looks like this: _http://xxxxxxxx.ngrok.io_

### TWILIO_IVR_INBOUNDPORT and TWILIO_IVR_INBOUNDENDPOINT
_only required when **NOT** using the Botium Twilio Webhook Proxy_

Local port and endpoint to be used for launching the webhook

### TWILIO_IVR_REDISURL and TWILIO_IVR_REDIS_TOPICBASE
_only required when using the Botium Twilio Webhook Proxy_

Redis Url and base topic name for Redis subscription topic.

The default url for local redis is _redis://localhost:6379_

### TWILIO_IVR_LANGUAGE_CODE
The language code used for the call, like 'en-US' (optional, default _en-US_) ([All language code](https://www.twilio.com/docs/voice/twiml/gather#languagetags))

### TWILIO_IVR_RECORD
Record the call (true/false)

### TWILIO_IVR_REDIAL
Number of redial attempts if no answer (default 5)

### TWILIO_IVR_SPEECH_TIMEOUT
tbd

### TWILIO_IVR_WAIT_CALL_STARTED
tbd

### TWILIO_IVR_WAIT_CALL_COMPLETED
tbd

### TWILIO_IVR_WAIT_BOTIUM_RESPONSE
tbd

### WAITFORBOTTIMEOUT

Depending on how fast your IVR responds, the default Botium timeout of 10 seconds can lead to timeout failures. Most likely you will have to increase it (see [here](https://github.com/codeforequity-at/botium-core/wiki/Botium-Configuration#waitforbottimeout) for more)

### Roadmap
* Error case fail instead of timeout
* Increasing STT accuracy
* Asserter to check call state 
* Cancel phone call if conversation test finished succesful
