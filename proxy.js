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
var host = argv.h || 'awmdm.com';
var verbose = argv.v || false;

if (argv.q) {
    console.log("node proxy.js -v(verbos) [-p userLocalPort#] [-h remoteHostName(for https host only)]");
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
    
    if (req.url.substr(0, 22) === '/api/testproxy/actions') {
        processOurAPI(req, res);
    } else if (req.url === '/api/testproxy/help') {
         
        res.writeHead(200, {'Content-Type': 'text/x-markdown; charset=UTF-8'} );
   
        var fileStream = fs.createReadStream('README.md');
        fileStream.pipe(res);
    } else {
        uri = url.parse(req.url);
        proxy.web(req, res, { target: uri.href });
    }
});

console.log("listening on port " + port)
server.listen(port);

var localPortNumber = 10001;

server.on('connect', function(req, socket, head) {
    console.log("got url: " + req.url);
    console.log("got method: " + req.method);
    console.log("got header: " + util.inspect(req.headers));
    
    var proxySocket = null;
    
    if (!host || req.url.indexOf(host) != -1) {
        //
        // for each new "connect" request, we create a new internal https server
        // to serve the TLS negoatation. Once the TLS connection is made, the https
        // server will act as a proxy to the destionation server
        //
    	console.log('creating mitm proxy to: ' + req.url);
        createMITMHttpsServer(localPortNumber);

        // create a local socket connection to the new interceptor https server we just created
        proxySocket = net.connect({port: localPortNumber, host: '127.0.0.1'},  function() { 

            // Connection Successful
            console.log('mitm proxySocket connected...');

            proxyConnectedToTarget('mitm');
        });

        localPortNumber++;    	

    } else {
    	console.log("creating forward proxy to: " + req.url);
    	proxySocket = net.connect({port: 443, host: req.headers['host']}, function() {
            // Connection Successful
            console.log('forward proxySocket connected...');

            proxyConnectedToTarget('forward');
    	});
    }
    
    function proxyConnectedToTarget(ptype) {
        proxySocket.on('end', function() { 
	           //console.log(ptype + ' proxySocket end');
        });
	
	    proxySocket.on('error', function(e) {
	         console.log(ptype + ' proxySocket error: ' + e);
	    });

        // tell the client to continue
        socket.write("HTTP/1.0 200 Connection established\r\n" +
            "Proxy-agent: Netscape-Proxy/1.1\r\n\r\n");

        //
        // create a bi-directional pipe between the two sockets: one from the client, one to the
        // internal intercepting https server
        //
        socket.pipe(proxySocket).pipe(socket);
        
    }

});


//
// use thse options to start our local https server
//
var options = {
    key: fs.readFileSync('./awmdm-key.pem'),
    cert: fs.readFileSync('./awmdm-cert.pem')
};

function setupProxyToTarget(req, res, target) {
    // proxy this request	
    proxy.web(req, res, { target: target });

    // log request
    req.on("data", function(part) {
        if (verbose) {
            console.log("got request: " + part.toString('hex'));
            parseAndPrintwbXml(part);
        }
    });

    //
    // we accumulate parts of data and parse it only when 'end' is seen
    //
    res.oldend = res.end;
    res.end = function(data) {
        var length = 0;
        if (res.savedBuffer) length = res.savedBuffer.length;
        console.log('got ' + length + ' bytes response <<<<<<');
        res.oldend.apply(this, arguments);

        if (res.savedBuffer && res.savedBuffer.length < 10000) {
            console.log('saved buffer size: ' + res.savedBuffer.length);
            switch (res.savedEncoding) {
                case 'gzip':
                case 'deflate':
                    zlib.unzip(res.savedBuffer, function(err, unzipData) {
                        if (err) console.log('got err unzip data');
                        else if (verbose) {
                            console.log('got zipped response: ' + unzipData.toString('hex'));
                            parseAndPrintwbXml(unzipData);
                        }
                    });

                    break;

                default:
                    if (verbose) {
                        console.log('got unzipped response: ' + res.savedBuffer.toString());
//                        parseAndPrintwbXml(res.savedBuffer);
                    }

                    break;
            }
        }
    };

    res.oldwrite = res.write;
    res.write = function (data) {
        console.log('got response data >>>>>>');
        res.oldwrite.apply(this, arguments);
        if (res._headers && res._headers['content-encoding']) {
            res.savedEncoding = res._headers['content-encoding'];
        }
        if (!res.savedBuffer) {
            res.savedBuffer = data;
        } else {
            res.savedBuffer = Buffer.concat([res.savedBuffer, data]);
        }
    }
}

//
// create a https server and watch all the requests coming in,
// for our own api, process it, otherwise pass to the proxy
//
function createMITMHttpsServer(port) {
    console.log('create local https server on port: ' + port);
    https.createServer(options, function (req, res) {
        uri = url.parse(req.url);
        console.log("got uri path: " + uri.path);
        console.log("got method: " + req.method);
        console.log("got header: " + util.inspect(req.headers));

        var target = "https://" + req.headers.host + uri.path;
        console.log("forward target: " + target);

        if (pendingActions.length > 0) {
            processPendingActions(req, res, target);

        } else {
            setupProxyToTarget(req, res, target);            
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

function return401Action(req, res) {
    console.log('fake a 401');
    res.writeHead(401, {
                  'Content-Type': 'text/plain'
                  });

    res.end('Token expired');

    return true;
}

function return500Action(req, res) {
    console.log('fake a 500');
    res.writeHead(500, {
                  'Content-Type': 'text/plain'
                  });

    res.end('Really bad things happened');

    return true;
}

function passthroughAction(req, res, target) {
    setupProxyToTarget(req, res, target);

    return true;
}

function droprequestAction(req, res) {

    return true;
}

function longtimeoutAction(req, res, target) {
    setTimeout(function() {
        setupProxyToTarget(req, res, target);
    }, 75000);

    return true;
}

function invalidSyncKeyAction(req, res, target) {
    if (req.url.indexOf('Cmd=Sync') < 0) {
        return false;
    } else {
        var responseHex = "03016a00455c4f4b0330000152033500014e03330001010101";
        console.log('API return invalid sync key');
        res.writeHead(200, {
            'Content-Type': 'application/vnd.ms-sync.wbxml'
        });

        res.end(responseHex);
        return true;
    }
}


function folderSyncErrorAction(req, res, target) {
    if (req.url.indexOf('Cmd=FolderSync') < 0) {
        return false;
    } else {
        console.log('API return 500 for FolderSync');
        res.writeHead(500, {
            'Content-Type': 'text/plain'
        });

        res.end('Really bad things happened');

       return true;
    }
}

function protocolErrorAction(req, res) {
    return true;
}

// api end point action table
var actionTable = {return401 : return401Action,
    return500 : return500Action,
    passthrough : passthroughAction,
    droprequest : droprequestAction,
    longtimeout : longtimeoutAction,
    invalidsynckey : invalidSyncKeyAction,
    foldersyncerror : folderSyncErrorAction,
    protocolerror : protocolErrorAction
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
        if (Object.keys(actionTable).indexOf(property) < 0) {
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
function processPendingActions(req, res, target) {
    var action = pendingActions.shift();
    console.log(util.inspect(action));

    if (action.callback(req, res, target)) {
        action.count--;
        if (action.count > 0) {
            pendingActions.unshift(action);
        }
    } else {
        pendingActions.unshift(action);
        setupProxyToTarget(req, res, target);
    }
}

/**
 * @param data is a binary Buffer contains wbXml
 * @returns
 */
function parseAndPrintwbXml(data) {
    /*
    var shellCommand = 'echo "'  + data.toString('hex') + '" | runner';
    var child = exec(shellCommand, function(err, stdout, stderr) {
        if (err) throw err;
        else console.log(stdout + stderr);
    });
    */
    if (data.length > 20000) {
        console.log(data.length + ' bytes of data is too large to print');
        return;
    }

    var filename = './testdata.hex';
    fs.writeFile(filename, data.toString('hex'), function(err) {
        if(err) {
            console.log(err);
        } else {
            var shellCommand = 'cat ' + filename + ' | runner';
            var child = exec(shellCommand, function(err, stdout, stderr) {
                if (err) {
                    console.log(err);
                }
                else console.log(stdout + stderr);
                
                fs.unlink(filename, function (err) {
                    if (err) {
                        console.log(err);
                    }
                });

            });
        }
    });
}
