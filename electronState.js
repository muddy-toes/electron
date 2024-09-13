// places to store the current state of the application
// as we don't use a database of any kind (it's all in memory!)
const AutomatedDriver = require('./automatedDriver');

class ElectronState {
    constructor() {
        this.driverTokens = {};         // stores the authentication tokens of drivers
        this.driverSockets = {};        // stores sockets for people driving sessions
        this.riders = {};               // stores all sockets for people riding each session
        this.previousMessageStamp = {}; // stores timestamp of previous message for calculating offsets
        this.lastMessages = {};         // storage of incoming messages (setting waveform parameters, pain tool, etc.)
        this.automatedDrivers = {};     // stores automated drivers by their session ids
        this.trafficLights = {};        // dictionary binding sockets to red / yellow / green traffic lights
        console.log("start");
        this.sessionFlags = {};         // sessionFlags[sessId][flagname]
                                        // flagnames in use: blindfoldRiders, publicSession, driverName
    }

    setSessionFlag(sessId, flagname, flagval) {
      this.sessionFlags[sessId] ||= {};
      this.sessionFlags[sessId][flagname] = flagval;
    }

    getSessionFlags(sessId) {
      return this.sessionFlags[sessId];
    }

    getPublicSessions() {
        const publiclist = [];
        const sessionFlags = this.sessionFlags; // because 'this' changes inside the forEach
        Object.keys(this.sessionFlags).forEach(function(sessId) {
          if (! sessionFlags[sessId])
            return;

          if (sessionFlags[sessId]['publicSession'])
            publiclist.push({ sessId: sessId, name: sessionFlags[sessId]['driverName'] || sessId });
        });
        return publiclist;
    }

    addDriverToken(sessId, token, socket) {
        this.driverTokens[sessId] = token;
        this.driverSockets[sessId] = socket;
        this.previousMessageStamp[sessId] ||= { 'left': Date.now(), 'right': Date.now() };
        this.lastMessages[sessId] ||= {};
        this.sessionFlags[sessId] ||= {};
    }

    driverTokenExists(sessId) {
        return sessId in this.driverTokens || sessId in this.automatedDrivers;
    }

    validateDriverToken(sessId, driverToken) {
        if (!(sessId in this.driverTokens)) {
            return false;
        }
        return this.driverTokens[sessId] == driverToken;
    }

    addRiderSocket(sessId, socket) {
        if (this.riders[sessId]) {
            this.riders[sessId].push(socket);
        } else {
            this.riders[sessId] = [socket];
        }
    }

    getRiderSockets(sessId) {
        if (!(sessId in this.riders)) {
            return [];
        }
        return this.riders[sessId];
    }

    getDriverSocket(sessId) {
        return this.driverSockets[sessId];
    }

    storeLastMessage(sessId, channel, message) {
        if (!this.lastMessages[sessId]) {
            this.lastMessages[sessId] = {};
        }
        const now = Date.now();
        const stamp_offset = now - this.previousMessageStamp[sessId][channel];
        this.previousMessageStamp[sessId][channel] = now;
        this.lastMessages[sessId][channel] ||= [];
        this.lastMessages[sessId][channel].push({ stamp: stamp_offset, message: message });
    }

    setRiderTrafficLight(sessId, socket, color) {
        const sockets = this.getRiderSockets(sessId);
        const invalidColor = ['R', 'Y', 'G', 'N'].indexOf(color) === -1;
        if (sockets.indexOf(socket) === -1 || invalidColor) {
            return;
        }
        this.trafficLights[socket.id] = color;
    }

    getRiderTrafficLight(socket) {
        // valid values: R (red), Y (yellow), G (green), N (none)
        if (socket.id in this.trafficLights) {
            return this.trafficLights[socket.id];
        }
        return 'N';
    }

    getLastMessage(sessId, channel) {
        if (!(sessId in this.lastMessages) || !(channel in this.lastMessages[sessId]) || !(typeof(this.lastMessages[sessId][channel]) === 'object') || !(0 in this.lastMessages[sessId][channel])) {
            return null;
        }
        return this.lastMessages[sessId][channel].slice(-1)[0];
    }

    getSessionMessages(sessId) {
        if (!(sessId in this.lastMessages) || !('left' in this.lastMessages[sessId]) || !('right' in this.lastMessages[sessId])) {
            return "No messages stored";
        }
        return JSON.stringify({
            'left': this.lastMessages[sessId]['left'].filter(function(m) { delete m['message'].sessId ; delete m['message'].driverToken; return m; }),
            'right': this.lastMessages[sessId]['right'].filter(function(m) { delete m['message'].sessId ; delete m['message'].driverToken; return m; }),
        });
    }

    getRiderData(sessId) {
        const riderSockets = this.getRiderSockets(sessId);
        const self = this;
        let riderData = { 'G': 0, 'Y': 0, 'R': 0, 'N': 0, 'total': 0 };

        riderSockets.forEach(function (s) {
            const color = self.getRiderTrafficLight(s);
            riderData[color]++;
            riderData.total++;
        });
        return riderData;
    }

    onDisconnect(socket) {
        let found_rider = false;

        for (const sessId in this.riders) {
            const index = this.riders[sessId].indexOf(socket);
            if (index > -1) {
                found_rider = true;
                this.riders[sessId].splice(index, 1);
                delete this.trafficLights[socket.id];
            }
        }

        if (! found_rider) {
            for (const sessId in this.driverSockets) {
                if (this.driverSockets[sessId] === socket) {
                    console.log('Driver disconnected for ' + sessId);
                    delete this.driverSockets[sessId];
                    delete this.driverTokens[sessId];
                    if (this.riders[sessId]) {
                        this.riders[sessId].forEach(function(s) {
                            console.log('Send driverLost to rider socket id ' + s.id);
                            s.emit('driverLost');
                        });
                    }
                }
            }
        }

        // If everybody's gone, the session is over, so clean it up
        for (const sessId in this.riders) {
          if (sessId && this.riders[sessId].length == 0 && !this.driverSockets[sessId]) {
            console.log(`Session ended, ${sessId}`);
            delete this.lastMessages[sessId];
            delete this.previousMessageStamp[sessId];
            delete this.sessionFlags[sessId];
            delete this.driverTokens[sessId];
            delete this.previousMessageStamp[sessId];
            delete this.riders[sessId];
          }
        }
    }

    startAutomatedDriver(sessId, automatedDriverConfig) {
        if (this.driverTokenExists(sessId)) {
            return false;
        }

        if (!this.automatedDrivers[sessId]) {
            this.automatedDrivers[sessId] = new AutomatedDriver(sessId, automatedDriverConfig);
            this.automatedDrivers[sessId].run(this);
            return true;
        } else {
            return false;
        }
    }

    unregisterAutomatedDriver(sessId) {
        delete this.automatedDrivers[sessId];
        delete this.lastMessages[sessId];
        delete this.previousMessageStamp[sessId];
        delete this.sessionFlags[sessId];
    }

}

module.exports = ElectronState;
