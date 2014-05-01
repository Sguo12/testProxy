#[testProxy]

####A basic proxy to assist testing of network protocols

* Passthrough proxy that prints everything out to console
* return 401, 500 selectively by calling the new API
* return long timeout, drop calls selectively by calling API
* Uses self signed certificate so that client under test has to accept that
* new API can be added to aid in other tests

***

####This proxy is built on top of the following libraries :

* [Node.js](http://nodejs.org/) - Application Server
* [node-http-proxy](https://github.com/nodejitsu/node-http-proxy) - The real javascript proxy
* [node-minimist](https://www.npmjs.org/package/minimist) - command line arguments parser

####Installation & Setup
npm install
./proxy.js


###New API endpoints:

* /api/testproxy/actions
* /api/testproxy/actions?return401=1
* /api/testproxy/actions?return500=5
* /api/testproxy/actions?droprequest=3
* /api/testproxy/actions?longtimeout=2
* /api/testproxy/actions?passthrough=1

The setters can be combined, so '/api/testproxy/actions?return401=2&passthrough=3&return500=1' will send out two 401
followed by three passthrough, then one 500.

A call to the endpoint without any action will clear the pending actions

Note that the sequence of these command is straightly followed.

A new call will clear all the counters so you have fresh start everytime calling this API endpoint.
