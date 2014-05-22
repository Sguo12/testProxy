#[testProxy]

####A forward proxy to assist testing of exchange active sync protocol

* Passthrough proxy that prints everything out to console
* return 401, 500 selectively by calling the new API
* return long timeout, drop calls selectively by calling API
* return EAS sync invalid key if specified, the OSX app 'runner' is used to decode wbxml.
* A new certificate is created for every host using my own ROOT CA, so client under test has to accept that
* new API can be added to aid in other tests

***

####This proxy is built on top of the following libraries :

* [Node.js](http://nodejs.org/) - Application Server
* [node-http-proxy](https://github.com/nodejitsu/node-http-proxy) - The real javascript proxy
* [node-minimist](https://www.npmjs.org/package/minimist) - command line arguments parser
* [pem](https://github.com/andris9/pem) - Create private keys and certificates with node.js

####Installation & Setup & usage
npm install
./proxy.js
./proxy.js -v -s -h vmware.com

###Parameters
* -p port: specify the port to use, default is 3000
* -h hostname: specify which host we will be monitoring, default is All
* -s when set, we will ignore SSL errors from the server side(accept self signed cert)
* -r when set, all headers/body will be print out to the console
* -v when set, all exchange active sync commands will be printed on the console(OSX app 'runnner' is required for the parsing)

###New API endpoints:

* /api/testproxy/actions
* /api/testproxy/actions?return401=1
* /api/testproxy/actions?return500=5
* /api/testproxy/actions?droprequest=3
* /api/testproxy/actions?longtimeout=2
* /api/testproxy/actions?passthrough=1
* /api/testproxy/actions?syncinvalidkey=1
* /api/testproxy/actions?foldersyncerror500=1
* /api/testproxy/actions?foldersyncerror401=1
* /api/testproxy/actions?syncprotocolerror=1
* /api/testproxy/actions?syncerror500=1
* /api/testproxy/actions?syncerror401=1
* /api/testproxy/actions?syncerrordrop=1
* /api/testproxy/actions?protocolerror=1

The setters can be combined, so '/api/testproxy/actions?return401=2&passthrough=3&return500=1' will send out two 401
followed by three passthrough, then one 500.

A call to the endpoint without any action will clear the pending actions

Note that the sequence of these command is straightly followed.

A new call will clear all the counters so you have fresh start everytime calling this API endpoint.
