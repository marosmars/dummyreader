const express = require('express')
const bodyParser = require('body-parser')
const rp = require('request-promise-native');

const app = express()
app.use(bodyParser.json())
const port = 3000

const readersPrefix = '/readers'

async function execute(req, res, next, reader) {
  console.log("req.body:", req.body)
  let path = req.body["path"]
  console.log("req.body.path:", path)
  let executeRead = async function(cmd) {
    let cliResponse
    let executeCliCommandEndpoint = req.body["executeCliCommandEndpoint"]
    console.log("Reading from", executeCliCommandEndpoint)
    let reqJSON = {
      "cmd": cmd
    }
    var options = {
      method: 'POST',
      uri: executeCliCommandEndpoint,
      body: reqJSON,
      json: true // Automatically stringifies the body to JSON
    }
    cliResponse = await rp(options)
    console.log("Got cli response:", cliResponse)
    return cliResponse
  }
  const cli = {
    "executeRead": executeRead
  }
  let model = await reader(path, cli)
  console.log("Sending back", model)
  res.send(model)
}


const IFC = '/openconfig-interfaces:interfaces/interface'
async function ifcReader(path, cli) {
  cliResponse = await cli.executeRead("ip link show")
  let matches = [...cliResponse.matchAll(/(\d+):\s+([^@:]+).*/g)].map(x => {
    let rObj = {}
    rObj['name'] = x[2]
    return rObj
  });

  let model = {}
  model['keys'] = matches
  return model
}
app.post(readersPrefix + IFC, async (req, res, next) => {
  execute(req, res, next, ifcReader)
})

const IFC_CFG = '/openconfig-interfaces:interfaces/interface/config'
async function readerIfcCfg(path, cli) {
  let ifcName = path.match(/name='(.+)'/)[1];
  cliResponse = await cli.executeRead("ip link show " + ifcName)

  let enabled = cliResponse.match(/<.*,.*(UP|DOWN).*>/)[1] === "UP"
  let mtu = parseInt(cliResponse.match(/mtu (\d+)/)[1])

  let model = {}
  model['name'] = ifcName
  model['enabled'] = enabled
  model['mtu'] = mtu > 65535 ? 65535 : mtu

  return model
}
app.post(readersPrefix + IFC_CFG, async (req, res, next) => {
  execute(req, res, next, readerIfcCfg)
})

const IFC_STATE = '/openconfig-interfaces:interfaces/interface/state'
async function readerIfcState(path, cli) {
  let ifcName = path.match(/name='(.+)'/)[1];
  cliResponse = await cli.executeRead("ip link show " + ifcName)

  let model = {}
  model['name'] = ifcName
 
  return model
}
app.post(readersPrefix + IFC_STATE, async (req, res, next) => {
  execute(req, res, next, readerIfcState)
})

app.listen(port, () => console.log(`Linux interface plugin listening port ${port}!`))

/** DEMO

Start container:

 docker run -d -h devmanddevel --net devmanddevelnet        --ip 172.8.0.85       --name DEMO       -v "$(realpath ../../):/cache/devmand/repo:ro"       -v "$(realpath ~/cache_devmand_build):/cache/devmand/build:rw"       --entrypoint /bin/bash       "demo/dvmd:9"       -c '/usr/sbin/sshd && bash -c "sleep infinity && ls"'

Start devmand:

 /tmp/tmp.9o00X9FDVP/cmake-build-debug/devmand --logtostderr=1 --device_configuration_file=/root/dev_conf.yaml

Start js reader:

 cd /cache/devmand/build
 nodemon app.js

Open Sublime:
Enable Autorefresh on the json file:

**/