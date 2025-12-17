const { logger, generateToken } = require('./utils');

module.exports = function (electronState) {
    return function (socket) {
        if (electronState.getVerbose()) logger('[] Socket connected from %s', remote_ip());

        function remote_ip() {
            return socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
        }

        function updateRidersFlags(sessId) {
            const flags = electronState.getSessionFlags(sessId)
            if (electronState.getVerbose()) logger("[%s] updateRidersFlags, flags=%o", sessId, flags);

            electronState.getRiderSockets(sessId).forEach(function (s) {
                s.emit('updateFlags', flags);
            });
        }

        function sendLast(sessId, socket) {
            const lastLeft = electronState.getLastMessage(sessId, 'left');
            const lastRight = electronState.getLastMessage(sessId, 'right');

            if (lastLeft !== undefined && lastLeft !== null) {
                socket.emit('left', lastLeft.message);
            }

            if (lastRight !== undefined && lastRight !== null) {
                socket.emit('right', lastRight.message);
            }

            logger("[%s] sending updateFlags: %o", sessId, electronState.getSessionFlags(sessId));
            socket.emit('updateFlags', electronState.getSessionFlags(sessId));

            if (!electronState.driverTokenExists(sessId)) {
                socket.emit('driverLost');
            }
        }

        // Enable this to log every incoming websocket event for debugging...
        // socket.onAny((eventName, ...args) => {
        //     console.log('Received event:', eventName, 'with args:', args);
        // });

        // ====== registerRider ======
        // a rider trying to join a session driven by someone else
        // (or an automated session)
        socket.on('registerRider', function (msg) {
            const sessId = msg.sessId;
            if (!electronState.sessionActive(sessId)) {
                // this session doesn't exist, apparently
                socket.emit('riderRejected');
                logger('[%s] User REJECTED as rider from %s', sessId, remote_ip());
                return;
            }

            // store the socket for this new rider
            electronState.addRiderSocket(sessId, socket);
            logger('[%s] User APPROVED as rider from %s (session riders: %d)', sessId, remote_ip(), electronState.getRiderSockets(sessId).length);
        });

        // ====== requestLast ======
        // send the last status for the left & right channels so this new rider
        // is synchronized with the current status
        socket.on('requestLast', function (msg) {
            if (!msg.sessId || (!electronState.validateRider(msg.sessId, socket) && electronState.getDriverSocket(msg.sessId) !== socket)) {
                return;
            }
            sendLast(msg.sessId, socket);
        });

        // ====== registerDriver ======
        // new driver, let's generate a new authentication token... unless someone
        // else is already driving this session!
        socket.on('registerDriver', function (msg) {
            const sessId = msg.sessId;
            logger('[%s] User request to drive', sessId);

            if (sessId.match(/^AUTO/)) {
                socket.emit('driverRejected');
                logger('[%s] User REJECTED as driver from %s.  Cannot manually drive an AUTO session.', sessId, remote_ip());

            } else if( electronState.validateDriverToken(sessId, msg.driverToken) ) {
                electronState.setDriverSocket(msg.sessId, socket);
                socket.emit('driverToken', msg.driverToken);
                logger('[%s] User RECONNECTED as driver from %s (session riders: %d)', sessId, remote_ip(), electronState.getRiderSockets(msg.sessId).length);
                sendLast(msg.sessId, socket);
                electronState.getRiderSockets(msg.sessId).forEach(function (s) {
                    s.emit('driverReturned');
                });

            } else if (!electronState.driverTokenExists(sessId)) {
                const token = generateToken();
                electronState.addDriverToken(sessId, token, socket);
                socket.emit('driverToken', token);
                sendLast(msg.sessId, socket);
                logger('[%s] User APPROVED as driver from %s (session riders: %d)', sessId, remote_ip(), electronState.getRiderSockets(msg.sessId).length);
                electronState.getRiderSockets(msg.sessId).forEach(function (s) {
                    s.emit('driverGained');
                });
                socket.emit('updateFlags', electronState.getSessionFlags(msg.sessId));

            } else {
                socket.emit('driverRejected');
                logger('[%s] User REJECTED as driver from %s', sessId, remote_ip());
            }
        });

        // ====== getSessionMessages ======
        socket.on('getSessionMessages', function(msg) {
            if (!msg.sessId || !electronState.validateDriverToken(msg.sessId, msg.driverToken)) {
                return;
            }
            const sessId = msg.sessId;
            if (electronState.getVerbose()) logger("[%s] getSessionMessages", sessId);
            socket.emit('sessionMessages', electronState.getSessionMessages(sessId));
        });

        // ====== clearSessionMessages ======
        socket.on('clearSessionMessages', function(msg) {
            if (!msg.sessId || !electronState.validateDriverToken(msg.sessId, msg.driverToken)) {
                return;
            }
            if (electronState.getVerbose()) logger("[%s] clearLastMessages", msg.sessId);
            electronState.clearLastMessages(msg.sessId);
            socket.emit('sessionMessagesCleared', { status: 'ok' });
        });

        // ====== setPublicSession ======
        socket.on('setPublicSession', function(msg) {
            if (!msg.sessId || !electronState.validateDriverToken(msg.sessId, msg.driverToken)) {
                return;
            }
            if (electronState.getVerbose()) logger("[%s] publicSession=%o", msg.sessId, msg.publicSession);
            electronState.setSessionFlag(msg.sessId, 'publicSession', msg.publicSession ? true : false);
        });

        // ====== setBlindfoldRiders ======
        socket.on('setBlindfoldRiders', function(msg) {
            if (!msg.sessId || !electronState.validateDriverToken(msg.sessId, msg.driverToken)) {
                return;
            }
            if (electronState.getVerbose()) logger("[%s] blindfoldRiders=%o", msg.sessId, msg.blindfoldRiders);
            electronState.setSessionFlag(msg.sessId, 'blindfoldRiders', msg.blindfoldRiders ? true : false);
            
            updateRidersFlags(msg.sessId);
        });

        // ====== setPromode ======
        socket.on('setPromode', function(msg) {
            if (!msg.sessId || !electronState.validateDriverToken(msg.sessId, msg.driverToken)) {
                return;
            }
            if (electronState.getVerbose()) logger("[%s] setPromode=%o", msg.sessId, msg.proMode);
            electronState.setSessionFlag(msg.sessId, 'proMode', msg.proMode ? true : false);
            updateRidersFlags(msg.sessId);
        });

        // ====== setSettings ======
        socket.on('setSettings', function(msg) {
            if (!msg.sessId || !electronState.validateDriverToken(msg.sessId, msg.driverToken)) {
                return;
            }
            const currentFlags = electronState.getSessionFlags(msg.sessId);

            let name = msg.driverName;
            if (!name)
                name = ""
            else
                name = name.replace(/[^A-Za-z0-9' !@.\^\&\-]/g, '');

            if (name === "")
              name = "Anonymous";

            if (electronState.getVerbose() && currentFlags['driverName'] != name) logger("[%s] setSettings driverName, raw=%o, processed=%o", msg.sessId, msg.driverName, name);
            electronState.setSessionFlag(msg.sessId, 'driverName', name);

            let url = msg.camUrl.slice(0, 100);
            logger("Setting flags, got url=%s", url);

            // I want to try to protect riders from bad urls as much as I can but not break
            // it either.  At least we can make sure it's an http/https url...
            const camUrlList = electronState.getCamUrlList();
            logger("camlist: %o", camUrlList);
            if (!camUrlList || camUrlList.length == 0) {
                if (!url || !url.match(/^https?:\/\//i))
                    url = '';
            } else {
                if (camUrlList.map((item) => item.name).filter((name) => name === url)[0] === undefined)
                    url = '';
            }
            logger('Post check url=%s', url);

            if (electronState.getVerbose() && currentFlags['camUrl'] != url) logger("[%s] setSettings camUrl, raw=%o, processed=%o", msg.sessId, msg.camUrl, url);
            electronState.setSessionFlag(msg.sessId, 'camUrl', url);

            let comments = msg.driverComments.slice(0, 100);
            if (electronState.getVerbose() && currentFlags['driverComments'] != comments) logger("[%s] setSettings driverComments, raw=%o, processed=%o", msg.sessId, msg.driverComments, comments);
            electronState.setSessionFlag(msg.sessId, 'driverComments', comments);

            updateRidersFlags(msg.sessId);
            socket.emit('updateFlags', electronState.getSessionFlags(msg.sessId));
        });

        // ====== setFilePlaying ======
        socket.on('setFilePlaying', function(msg) {
            if (!msg.sessId || !electronState.validateDriverToken(msg.sessId, msg.driverToken)) {
                return;
            }

            let fileinfo = msg.filePlaying;
            if (!fileinfo)
                fileinfo = '';
            else
                fileinfo = fileinfo.replace(/[^A-Za-z0-9' !@.\^\&\-]/g, '');

            let filedriver = msg.fileDriver;
            if (!filedriver)
                filedriver = '';
            else
                filedriver = filedriver.replace(/[^A-Za-z0-9' !@.\^\&\-]/g, '');

            if (electronState.getVerbose())
                logger("[%s] setFilePlaying, raw_fileinfo=%o, processed_fileinfo=%o, raw_filedriver=%o, processed_filedriver=%o",
                            msg.sessId, msg.filePlaying, fileinfo, msg.fileDriver, filedriver);

            electronState.setSessionFlag(msg.sessId, 'filePlaying', fileinfo);
            electronState.setSessionFlag(msg.sessId, 'fileDriver', filedriver);
            updateRidersFlags(msg.sessId);
            socket.emit('updateFlags', electronState.getSessionFlags(msg.sessId));

            if (fileinfo == '') {
                if (electronState.getVerbose()) logger("[%s] clearLastMessages on setFilePlaying to blank", msg.sessId);
                electronState.clearLastMessages(msg.sessId);
            }
        });

        // ====== left ======
        // left channel updates... send them over to all riders
        socket.on('left', function (msg) {
            if (!msg.sessId || !electronState.validateDriverToken(msg.sessId, msg.driverToken)) {
                return;
            }

            delete msg.driverToken;
            if (electronState.getVerbose()) logger("[%s] left, %o", msg.sessId, JSON.stringify(msg));

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
            if (electronState.getVerbose()) logger("[%s] right, %o", msg.sessId, JSON.stringify(msg));

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
            if (!msg.sessId || !electronState.validateDriverToken(msg.sessId, msg.driverToken)) {
                return;
            }

            delete msg.driverToken;
            if (electronState.getVerbose()) logger("[%s] pain-left, %o", msg.sessId, JSON.stringify(msg));
            electronState.storeLastMessage(msg.sessId, 'pain-left', msg);
            electronState.getRiderSockets(msg.sessId).forEach(function (s) {
                s.emit('pain-left', msg);
            });
        });

        // ====== pain-right ======
        // right pain tool updates... send them over to all riders
        socket.on('pain-right', function (msg) {
            if (!msg.sessId || !electronState.validateDriverToken(msg.sessId, msg.driverToken)) {
                return;
            }

            delete msg.driverToken;
            if (electronState.getVerbose()) logger("[%s] pain-left, %o", msg.sessId, JSON.stringify(msg));
            electronState.storeLastMessage(msg.sessId, 'pain-right', msg);
            electronState.getRiderSockets(msg.sessId).forEach(function (s) {
                s.emit('pain-right', msg);
            });
        });

        // ====== triggerBottle ======
        socket.on('triggerBottle', function (msg) {
            if (!msg.sessId || !electronState.validateDriverToken(msg.sessId, msg.driverToken)) {
                return;
            }

            delete msg.driverToken;

            let secs = msg.bottleDuration;
            if (!secs || isNaN(parseInt(secs)))
              secs = '5';

            if (electronState.getVerbose()) logger("[%s] triggerBottle, raw_duration=%o, processed_duration=%o", msg.sessId, msg.bottleDuration, secs);
            electronState.storeLastMessage(msg.sessId, 'bottle', { bottleDuration: secs });
            electronState.getRiderSockets(msg.sessId).forEach(function (s) {
                s.emit('bottle', { bottleDuration: secs });
            });
          
        });

        // ====== getRiderCount ======
        // returns how many riders are currently connected to this session
        // and how many are there in each possible traffic light status
        // (green, yellow, red)
        socket.on('getRiderCount', function (msg) {
            if (!msg.sessId || !electronState.validateDriverToken(msg.sessId, msg.driverToken)) {
                return;
            }

            const riderData = electronState.getRiderData(msg.sessId);
            socket.emit('riderCount', riderData);
        });

        // ====== trafficLight ======
        // handles the red / yellow / green traffic light system that riders
        // use to inform drivers about how they are doing
        socket.on('trafficLight', function (msg) {
            if (!msg.sessId || !electronState.validateRider(msg.sessId, socket)) {
                return;
            }

            electronState.setRiderTrafficLight(msg.sessId, socket, msg.color);
            const riderData = electronState.getRiderData(msg.sessId);
            const driverSocket = electronState.getDriverSocket(msg.sessId);
            if (driverSocket) {
                driverSocket.emit('riderCount', riderData);
            }
        });

        // ====== disconnect ======
        socket.on('disconnect', function () {
            if (electronState.getVerbose()) logger('[] Socket disconnected from %s', remote_ip());
            electronState.onDisconnect(socket);
        });
    };
};
