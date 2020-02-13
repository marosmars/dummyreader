var register = {}

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
register[IFC] = ifcReader

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
register[IFC_CFG] = readerIfcCfg

const IFC_STATE = '/openconfig-interfaces:interfaces/interface/state'
async function readerIfcState(path, cli) {
  let ifcName = path.match(/name='(.+)'/)[1];
  cliResponse = await cli.executeRead("ip link show " + ifcName)

  let model = {}
  model['name'] = ifcName

  return model
}
register[IFC_STATE] = readerIfcState

// grpc specifics start here
var PROTO_PATH = __dirname + '/ReaderPlugin.proto'
var grpc = require('grpc')
var pluginService = grpc.load(PROTO_PATH).devmand.channels.cli.plugin.ReaderPlugin
// utils start
var sending = function(obj) {
  console.log("Sending", obj);
  return obj;
}
// utils end

function read(call) {
  console.log("read started")
  var currentCliPromise = null

  let executeRead = async function(cmd) {
    console.log("executeRead", cmd)
    if (currentCliPromise) {
      throw "Expected empty currentCliPromise"
    }
    var p = new Promise((resolve, reject) => {
      currentCliPromise = {
        resolve: resolve,
        reject: reject
      }
    })
    call.write(sending({
      cliRequest: {
        cmd: cmd
      }
    }))
    return p
  }
  var cli = {
    "executeRead": executeRead
  }
  var started = false

  call.on('data', function(readRequest) {
    console.log(readRequest)
    if (!started) {
      if (!readRequest.actualReadRequest) {
        call.end()
        throw "Expected actualReadRequest"
      }
      started = true
      // start reader

      console.log(typeof kRegx)
      let unkeyed = readRequest.actualReadRequest.path.replace(/\[[^\]]+\]/g, '')
      console.log("Executing reader for", unkeyed, "with fx", register[unkeyed])

      readerFx = register[unkeyed]
      if (typeof readerFx != 'function') {
        call.end()
        return
      }
      readerFx(readRequest.actualReadRequest.path, cli).then(function(responseJSON) {
        // send final response back to framework
        if (typeof responseJSON === 'object') {
          responseJSON = JSON.stringify(responseJSON)
        }
        call.write(sending({
          actualReadResponse: {
            json: responseJSON
          }
        }))
        call.end()
      }, function(err) {
        console.log("Plugin failed", err)
        call.end()
      })
    } else {
      if (!readRequest.cliResponse) {
        call.end()
        if (currentCliPromise) {
          currentCliPromise.reject("Expected cliResponse")
        }
        throw "Expected cliResponse"
      }
      // inform cli about response
      if (!currentCliPromise) {
        call.end()
        throw "Expected currentCliPromise"
      }
      var resolve = currentCliPromise.resolve
      currentCliPromise = null
      resolve(readRequest.cliResponse.output)
    }
  })
  call.on('end', function() {
    console.log('got end')
  })
}

if (require.main === module) {
  var server = new grpc.Server()
  server.addProtoService(pluginService.service, {
    read: read
  })
  server.bind('0.0.0.0:50051', grpc.ServerCredentials.createInsecure())
  server.start()
}

/** DEMO

Start container:

 docker run -d -h devmanddevel --net devmanddevelnet        --ip 172.8.0.85       --name DEMO       -v "$(realpath ../../):/cache/devmand/repo:ro"       -v "$(realpath ~/cache_devmand_build):/cache/devmand/build:rw"       --entrypoint /bin/bash   "demo/dvmd:10"       -c '/usr/sbin/sshd && bash -c "sleep infinity && ls"'

Start devmand:

 /tmp/tmp.9o00X9FDVP/cmake-build-debug/devmand --logtostderr=1 --device_configuration_file=/root/dev_conf.yaml

Start js reader:

 cd /cache/devmand/build/dummyreader
 nodemon app.js

Open Sublime:
Enable Autorefresh on the json file:

**/