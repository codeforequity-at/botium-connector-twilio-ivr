const Connector = require('../index').PluginClass

const queueBotSays = (msg) => {
  console.log(msg)
}

const caps = require('./botium.json').botium.Capabilities

const connector = new Connector({queueBotSays, caps})

connector.Validate()
  .then(() => connector.Validate())
  .then(() => connector.Build())
  .then(() => connector.Start())
  .catch((ex) => console.error(ex))
