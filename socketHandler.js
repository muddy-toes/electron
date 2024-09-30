const { generateToken } = require('./utils');

module.exports = function (electronState) {
    return function (socket) {
        console.log('User connected');

        const verbose = true;

        function updateRidersFlags(sessId) {
            const flags = electronState.getSessionFlags(sessId)
            electronState.getRiderSockets(sessId).forEach(function (s) {
                s.emit('updateFlags', flags);
            });
        }

        // ====== registerRider ======
        // a rider trying to join a session driven by someone else
        // (or an automated session)
        socket.on('registerRider', function (msg) {
            const sessId = msg.sessId;
            if (!electronState.driverTokenExists(sessId)) {
                // this session doesn't exist, apparently
                socket.emit('riderRejected');
                console.log('User REJECTED as rider for ' + sessId);
                return;
            }

            // store the socket for this new rider
            console.log('User APPROVED as rider for ' + sessId);
            electronState.addRiderSocket(sessId, socket);
        });

        // ====== requestLast ======
        // send the last status for the left & right channels so this new rider
        // is synchronized with the current status
        socket.on('requestLast', function (msg) {
            const sessId = msg.sessId;
            const lastLeft = electronState.getLastMessage(sessId, 'left');
            const lastRight = electronState.getLastMessage(sessId, 'right');
            // console.log("SID %s, sending lastLeft: %o", sessId, lastLeft);
            // console.log("SID %s, sending lastRight: %o", sessId, lastRight);
            if (lastLeft) {
                socket.emit('left', lastLeft.message);
            }
            if (lastRight) {
                socket.emit('right', lastRight.message);
            }
            socket.emit('updateFlags', electronState.getSessionFlags(sessId));
        });

        // ====== registerDriver ======
        // new driver, let's generate a new authentication token... unless someone
        // else is already driving this session!
        socket.on('registerDriver', function (msg) {
            const sessId = msg.sessId;
            console.log('User registered as driver for ' + sessId);
            if (!electronState.driverTokenExists(sessId)) {
                const token = generateToken();
                electronState.addDriverToken(sessId, token, socket);
                socket.emit('driverToken', token);
                console.log('User APPROVED as driver for ' + sessId);
                electronState.getRiderSockets(msg.sessId).forEach(function (s) {
                    s.emit('driverGained');
                });
            } else {
                socket.emit('driverRejected');
                console.log('User REJECTED as driver for ' + sessId);
            }
        });

        socket.on('getSessionMessages', function(msg) {
            if (!msg.sessId || !electronState.validateDriverToken(msg.sessId, msg.driverToken)) {
                return;
            }
            const sessId = msg.sessId;
            if (verbose) console.log("getSessionMessages, sessId=%s", sessId);
            socket.emit('sessionMessages', electronState.getSessionMessages(sessId));
        });

        socket.on('clearSessionMessages', function(msg) {
            if (!msg.sessId || !electronState.validateDriverToken(msg.sessId, msg.driverToken)) {
                return;
            }
            const sessId = msg.sessId;
            if (verbose) console.log("clearLastMessages, sessId=%s", sessId);
            electronState.clearLastMessages(sessId);
            socket.emit('sessionMessagesCleared', { status: 'ok' });
        });

        socket.on('setPublicSession', function(msg) {
            if (!msg.sessId || !electronState.validateDriverToken(msg.sessId, msg.driverToken)) {
                return;
            }
            if (verbose) console.log("publicSession=%o, sessId=%s", msg.publicSession, msg.sessId);
            electronState.setSessionFlag(msg.sessId, 'publicSession', msg.publicSession ? true : false);
        });

        socket.on('setBlindfoldRiders', function(msg) {
            if (!msg.sessId || !electronState.validateDriverToken(msg.sessId, msg.driverToken)) {
                return;
            }
            if (verbose) console.log("blindfoldRiders=%o, sessId=%s", msg.blindfoldRiders, msg.sessId);
            electronState.setSessionFlag(msg.sessId, 'blindfoldRiders', msg.blindfoldRiders ? true : false);
            
            updateRidersFlags(msg.sessId);
        });

        socket.on('setDriverName', function(msg) {
            if (!msg.sessId || !electronState.validateDriverToken(msg.sessId, msg.driverToken)) {
                return;
            }
            let name = msg.driverName;
            if (!name)
                name = ""
            else
                name = name.replace(/[^A-Za-z0-9' !@.\^\&\-]/, '');

            if (name === "")
              name = "Anonymous";

            if (verbose) console.log("setDriverName, raw=%o, processed=%o, sessId=%s", msg.driverName, name, msg.sessId);
            electronState.setSessionFlag(msg.sessId, 'driverName', name);
            updateRidersFlags(msg.sessId);
            socket.emit('updateFlags', electronState.getSessionFlags(msg.sessId));
        });

        socket.on('setCamUrl', function(msg) {
            if (!msg.sessId || !electronState.validateDriverToken(msg.sessId, msg.driverToken)) {
                return;
            }
            let url = msg.camUrl.slice(0, 100);
            // I want to try to protect riders from bad urls as much as I can but not break
            // it either.  At least we can make sure it's an http/https url...
            if (!url || !url.match(/^https?:\/\//i))
              url = '';

            if (verbose) console.log("setCamUrl, raw=%o, processed=%o, sessId=%s", msg.camUrl, url, msg.sessId);
            electronState.setSessionFlag(msg.sessId, 'camUrl', url);
            updateRidersFlags(msg.sessId);
            socket.emit('updateFlags', electronState.getSessionFlags(msg.sessId));
        });

        socket.on('setDriverComments', function(msg) {
            if (!msg.sessId || !electronState.validateDriverToken(msg.sessId, msg.driverToken)) {
                return;
            }
            let comments = msg.driverComments.slice(0, 100);

            if (verbose) console.log("setComments, raw=%o, processed=%o, sessId=%s", msg.driverComments, comments, msg.sessId);
            electronState.setSessionFlag(msg.sessId, 'driverComments', comments);
            updateRidersFlags(msg.sessId);
            socket.emit('updateFlags', electronState.getSessionFlags(msg.sessId));
        });

        socket.on('setFilePlaying', function(msg) {
            if (!msg.sessId || !electronState.validateDriverToken(msg.sessId, msg.driverToken)) {
                return;
            }
            let fileinfo = msg.filePlaying;
            if (!fileinfo)
                fileinfo = '';
            else
                fileinfo = fileinfo.replace(/[^A-Za-z0-9' !@.\^\&\-]/, '');

            let filedriver = msg.fileDriver;
            if (!filedriver)
                filedriver = '';
            else
                filedriver = filedriver.replace(/[^A-Za-z0-9' !@.\^\&\-]/, '');

            if (verbose)
                console.log("setFilePlaying, raw_fileinfo=%o, processed_fileinfo=%o, raw_filedriver=%o, processed_filedriver=%o, sessId=%s",
                            msg.filePlaying, fileinfo, msg.fileDriver, filedriver, msg.sessId);
            electronState.setSessionFlag(msg.sessId, 'filePlaying', fileinfo);
            electronState.setSessionFlag(msg.sessId, 'fileDriver', filedriver);
            updateRidersFlags(msg.sessId);
            socket.emit('updateFlags', electronState.getSessionFlags(msg.sessId));
        });


        // ====== left ======
        // left channel updates... send them over to all riders
        socket.on('left', function (msg) {
            if (!msg.sessId || !electronState.validateDriverToken(msg.sessId, msg.driverToken)) {
                return;
            }

            delete msg.driverToken;
            if (verbose) console.log("left, %o", JSON.stringify(msg));

            // store the current status of the left channel for the future
            electronState.storeLastMessage(msg.sessId, 'left', msg);
            // send real time updates to all riders
            electronState.getRiderSockets(msg.sessId).forEach(function (s) {
                s.emit('left', msg);
            });
        });

        // ====== right ======
        // right channel updates... send them over to all riders
        socket.on('right', function (msg) {
            if (!msg.sessId || !electronState.validateDriverToken(msg.sessId, msg.driverToken)) {
                return;
            }

            delete msg.driverToken;
            if (verbose) console.log("right, %o", JSON.stringify(msg));

            // store the current status of the right channel for the future
            electronState.storeLastMessage(msg.sessId, 'right', msg);
            // send real time updates to all riders
            electronState.getRiderSockets(msg.sessId).forEach(function (s) {
                s.emit('right', msg);
            });
        });

        // ====== pain-left ======
        // left pain tool updates... send them over to all riders
        socket.on('pain-left', function (msg) {
            if (electronState.validateDriverToken(msg.sessId, msg.driverToken)) {
                delete msg.driverToken;
                if (verbose) console.log("pain-left, %o", JSON.stringify(msg));
                electronState.storeLastMessage(msg.sessId, 'pain-left', msg);
                electronState.getRiderSockets(msg.sessId).forEach(function (s) {
                    s.emit('pain-left', msg);
                });
            }
        });

        // ====== pain-right ======
        // right pain tool updates... send them over to all riders
        socket.on('pain-right', function (msg) {
            if (electronState.validateDriverToken(msg.sessId, msg.driverToken)) {
                delete msg.driverToken;
                if (verbose) console.log("pain-left, %o", JSON.stringify(msg));
                electronState.storeLastMessage(msg.sessId, 'pain-right', msg);
                electronState.getRiderSockets(msg.sessId).forEach(function (s) {
                    s.emit('pain-right', msg);
                });
            }
        });

        socket.on('triggerBottle', function (msg) {
            if (!msg.sessId || !electronState.validateDriverToken(msg.sessId, msg.driverToken))
                return;

            delete msg.driverToken;

            let secs = msg.bottleDuration;
            if (!secs || isNaN(parseInt(secs)))
              secs = '5';

            console.log("triggerBottle, raw_duration=%o, processed_duration=%o, sessId=%s", msg.bottleDuration, secs, msg.sessId);
            // store the current status of the right channel for the future
            electronState.storeLastMessage(msg.sessId, 'bottle', { bottleDuration: secs });
            // send real time updates to all riders
            electronState.getRiderSockets(msg.sessId).forEach(function (s) {
                s.emit('bottle', { bottleDuration: secs });
            });
          
        });

        // ====== getRiderCount ======
        // returns how many riders are currently connected to this session
        // and how many are there in each possible traffic light status
        // (green, yellow, red)
        socket.on('getRiderCount', function (msg) {
            if (electronState.validateDriverToken(msg.sessId, msg.driverToken)) {
                const riderData = electronState.getRiderData(msg.sessId);
                socket.emit('riderCount', riderData);
            }
        });

        // ====== trafficLight ======
        // handles the red / yellow / green traffic light system that riders
        // use to inform drivers about how they are doing
        socket.on('trafficLight', function (msg) {
            electronState.setRiderTrafficLight(msg.sessId, socket, msg.color);
            const riderData = electronState.getRiderData(msg.sessId);
            const driverSocket = electronState.getDriverSocket(msg.sessId);
            if (driverSocket) {
                driverSocket.emit('riderCount', riderData);
            }
        });

        // ====== disconnect ======
        // remove person from list of riders if they close the connection
        socket.on('disconnect', function () {
            console.log('User disconnected');
            electronState.onDisconnect(socket);
        });
    };
};
