#!/usr/bin/env /usr/local/bin/node

var http = require('http');
var httpProxy = require('http-proxy');
var url=require('url');
var fs = require('fs');
var net = require('net');
var https = require('https');
var util = require('util');
var argv = require('minimist')(process.argv.slice(2));
var zlib = require('zlib');
var exec = require('child_process').exec;

var port = argv.p || 3000;

if (argv.h) {
    console.log("node proxy.js [-p port] [-s SocialcastServer]");
    return;
}

//
// Create a proxy server with custom application logic
//
var proxy = httpProxy.createProxyServer({});

//
// Create your custom server and just call `proxy.web()` to proxy
// a web request to the target passed in the options
// also you can use `proxy.ws()` to proxy a websockets request
//
var server = require('http').createServer(function(req, res) {
    // You can define here your custom logic to handle the request
    // and then proxy the request.
    //
    uri = url.parse(req.url);
    proxy.web(req, res, { target: uri.href });
});

console.log("listening on port " + port)
server.listen(port);

var localPortNumber = 10001;

server.on('connect', function(req, socket, head) {
    console.log("got url: " + req.url);
    console.log("got method: " + req.method);
    console.log("got header: " + util.inspect(req.headers));

    //
    // for each new "connect" request, we create a new internal https server
    // to serve the TLS negoatation. Once the TLS connection is made, the https
    // server will act as a proxy to the destionation server
    //
    createMITMHttpsServer(localPortNumber);

    // create a local socket connection to the new interceptor https server we just created
    var proxySocket = net.connect({port: localPortNumber, host: '127.0.0.1'},  function() { 

        // Connection Successful
        console.log('proxySocket connected...');

        // Data Received from Server
        proxySocket.on('data', function(d) {
            //console.log('>>>>> proxySocket data: ' + util.inspect(d));
        });

        proxySocket.on('end', function() { 
            console.log('proxySocket end');
        });

        proxySocket.on('error', function(e) {
            console.log('proxySocket error: ' + e);
        });
    });

    // tell the client to continue
    socket.write("HTTP/1.0 200 Connection established\r\n" +
        "Proxy-agent: Netscape-Proxy/1.1\r\n\r\n");

    socket.on('data', function(part) {
        //console.log('<<<<<<<< clientSocket got data: ' + util.inspect(part));
    });

    //
    // create a bi-directional pipe between the two sockets: one from the client, one to the
    // internal intercepting https server
    //
    socket.pipe(proxySocket).pipe(socket);

    localPortNumber++;
});


//
// use thse options to start our local https server
//
var options = {
    key: fs.readFileSync('./self-ssl.key'),
    cert: fs.readFileSync('./self-ssl.crt')
};

//
// create a https server and watch all the requests coming in,
// for our own api, process it, otherwise pass to the proxy
//
function createMITMHttpsServer(port) {
    https.createServer(options, function (req, res) {
        uri = url.parse(req.url);
        console.log("got uri path: " + uri.path);
        console.log("got method: " + req.method);
        console.log("got header: " + util.inspect(req.headers));

        var target = "https://" + req.headers.host + uri.path;
        console.log("forward target: " + target);

        if (req.url.substr(0, 22) == '/api/testproxy/actions') {
            processOurAPI(req, res);

        } else if (pendingActions.length > 0) {
            processPendingActions(req, res);

        } else {
        	
            proxy.web(req, res, { target: target });
            req.on("data", function(part) {
            	console.log("got request: " + part.toString('hex'));
            	parseAndPrintwbXml(part);
            });
            
            res.oldwrite = res.write;
        	res.write = function (data) {  
        		  switch (res._headers['content-encoding']) {
        		    case 'gzip':
        		    case 'deflate':
                		zlib.unzip(data, function(err, data) {
                			if (err) console.log('got err unzip data');
                			else {
                				console.log('got response: ' + data.toString('hex'));
                				parseAndPrintwbXml(data);
                			}
                      		res.oldwrite(data);
                		});

        		    	break;

        		    default:
                  		res.oldwrite(data);
        		    	break;
        		  }
        	   }
        }
    }).listen(port);
}


proxy.on('error', function (err, req, res) {
    res.writeHead(500, {
        'Content-Type': 'text/plain'
    });

    res.end('Something went wrong. And we are reporting a custom error message.');
});

proxy.on('proxyRes', function (res) {
    console.log('RAW Response from the target', JSON.stringify(res.headers, true, 2));
});

//
// pending test actions
//
var pendingActions = [];
//
// possible pending actions/API end points
//
var actionTypes = ['return401', 'return500', 'passthrough', 'droprequest', 'longtimeout'];

function return401Action(req, res) {
    res.writeHead(401, {
                  'Content-Type': 'text/plain'
                  });

    res.end('Token expired');
}

function return500Action(req, res) {
    res.writeHead(500, {
                  'Content-Type': 'text/plain'
                  });

    res.end('Really bad things happened');
}

function passthroughAction(req, res) {
    req.headers.host = scServer;
    proxy.web(req, res, { target: 'https://' + scServer });
}

function droprequestAction(req, res) {

}

function longtimeoutAction(req, res) {
    setTimeout(function() {
               req.headers.host = scServer;
               proxy.web(req, res, { target: 'https://' + scServer });
               }, 75000);
}

// api end point action table
var actionTable = {return401 : return401Action,
    return500 : return500Action,
    passthrough : passthroughAction,
    droprequest : droprequestAction,
    longtimeout : longtimeoutAction
};

//
// our API end point
//
function processOurAPI(req, res) {
    var query = require('url').parse(req.url,true).query;

    //
    // when we set a new test value, we clear all other
    // leftover flags! this makes sure that we get a fresh start
    //
    pendingActions = [];

    for (var property in query) {
        if (actionTypes.indexOf(property) < 0) {
            res.writeHead(400, {
                'Content-Type': 'text/plain'
            });

            res.end(property + ' is not a valid action');
            return;
        }

        if (isNaN(query[property]) || query[property] < 1 || query[property] > 10000) {
            res.writeHead(400, {
                          'Content-Type': 'text/plain'
                          });

            res.end(property + '=' + query[property] + ' is a valid value');
            return;
        }

        // add the action to the pending fifo
        pendingActions.push({count : Math.floor(query[property]),
                            callback : actionTable[property]});
    }

    res.writeHead(200, {
        'Content-Type': 'application/json'
    });

    res.end(JSON.stringify(pendingActions));
}

//
// process each pending action in-order
//
function processPendingActions(req, res) {
    var action = pendingActions.shift();
    console.log(util.inspect(action));

    action.callback(req, res);

    action.count--;
    if (action.count > 0) {
        pendingActions.unshift(action);
    }
}

/**
 * @param data is a binary Buffer contains wbXml
 * @returns
 */
function parseAndPrintwbXml(data) {
	var shellCommand = 'echo "'  + data.toString('hex') + '" | runner';
    var child = exec(shellCommand, function(err, stdout, stderr) {
        if (err) throw err;
        else console.log(stdout + stderr);
    });
}
