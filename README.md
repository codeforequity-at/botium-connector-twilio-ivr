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

Supports DTMF (w is 0,5s delay)

```
#me
BUTTON 0123456789*#w
```


## Limitations
1. Twilio uses Text To Speech, and Speech To Text. A test can fail if 
TTS or STT is not converting the text well.
1. It is not possible to send DTML and speech like this:
```
#me
Hello
BUTTON 1
```

1. Special fail cases:
   * If the dialed number is wrong, or not permitted, then the testcase will fail with error
   * If the bot answers the phone, then error handling follows Botium standards
   * In every other case (For example he is busy, or picks up the phone but does not say anything, or number is temporary not available...) then the test will fail with timeout
1. Flow:
   * We expect that the bot starts the conversation. (Otherwise call initiated, but you got error while phone ringing: error sending to bot Error: Illegal state, conversation should be started by bot!)
   * Cant assert that call is ended like this:
```
...
#me
Goodbye!

#bot
Goodbye!
CALL_ENDED
...
```

   * Just one bot-says is allowed. So this is not possible:

```
...
#bot
Hello!

#bot
How are you?
...
```
But this is:  
```
...
#bot
Hello! How are you?
...
```
Otherwise the test will fail with timeout.
   * Just one me-says allowed. It is possible to use more:
```
...
#bot
Hi.

#me
Hello!

#me
Goodbye!

#bot
Goodbye!
...
```
But it will implemented as:  
```
...
#bot
Hi.

#me
Hello!

#bot
Goodbye!

#me
Goodbye!
...
```

## Prerequisites

* __Node.js and NPM__
* a __Redis__ instance (Cloud hosted free tier for example from [redislabs](https://redislabs.com/) will do as a starter)
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

## Install and Run the Botium webhook service

Call is initiated by the Connector. 
After the call is established, it is controlled by Botium webhook service via 3 webhooks. 
Botium webhook service communicates with the Connector via Redis. 

If you are using Botium Box, then the Botium webhook service is integrated.

Installation with NPM:

    > npm install -g botium-connector-twilio-ivr
    > botium-twilio-ivr-proxy-cli start --help

There are several options required for running the Botium webhook service:

_--port_: Local port to listen (optional, default _5001_)

_--publicurl_: Public URL for the webhook. If you are using ngrok, then it looks like this: 'https://xxxxxxxx.ngrok.io'

_--languageCode_: The language code used for the call, like 'en-US' (optional, default _en-US_) ([All language code](https://www.twilio.com/docs/voice/twiml/gather#languagetags))

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
      "TWILIO_IVR_HOST": "..."
    }
  }
}
```

Botium setup is ready, you can begin to write your [BotiumScript](https://github.com/codeforequity-at/botium-core/wiki/Botium-Scripting) files.

## How to start sample

There is a small demo in [samples/human](./samples/human) with Botium Bindings.  

To start it you have to create botium.json. For help see Supported Capabilities. 
So to start it you have to create botium.json from [sample.botium.json](./samples/human/sample.botium.json)

This demo requires you to emulate bot, for TWILIO_IVR_TO capability use our own number.
 
 Afterwards:

    > npm install
    > npm test

If your phone is ringing pick it up, and say 'Hi' - and after Botium greets you or plays DTMF tones, say "goodbye" and hang up. Test case completed.

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

### TWILIO_IVR_REDISURL

Same as for Botium webhook service. The default url for local redis is 'redis://localhost:6379'. 

### TWILIO_IVR_PUBLICURL

Same public url for Botium webhook service. If you are using ngrok, then it looks like this: 'http://xxxxxxxx.ngrok.io' 

### WAITFORBOTTIMEOUT

Depending on how fast your IVR responds, the default Botium timeout of 10 seconds can lead to timeout failures. Most likely you will have to increase it (see [here](https://github.com/codeforequity-at/botium-core/wiki/Botium-Configuration#waitforbottimeout) for more)

### Roadmap
* Error case fail instead of timeout
* Increasing STT accuracy
* Asserter to check call state 
* Better solution for one me-says case
* Cancel phone call if conversation test finished succesful
* Better test case termination if the DTMF specification is wrong. 
(Now Twilio got 500 from proxy, so terminates the call. Connector does not know about the error) 
