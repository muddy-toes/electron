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
        this.publicSessions = {};       // stores public session list - {sessId: true}
    }

    setPublicSession(sessId, publicSession) {
      if (publicSession)
        this.publicSessions[sessId] = true;
      else
        delete this.publicSessions[sessId];
    }

    getPublicSessions() {
        return Object.keys(this.publicSessions);
    }

    addDriverToken(sessId, token, socket) {
        this.driverTokens[sessId] = token;
        this.driverSockets[sessId] = socket;
        this.previousMessageStamp[sessId] = { 'left': Date.now(), 'right': Date.now() };
        this.lastMessages[sessId] = {};
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
        for (const sessId in this.riders) {
            const index = this.riders[sessId].indexOf(socket);
            if (index > -1) {
                this.riders[sessId].splice(index, 1);
            }
        }
        delete this.trafficLights[socket.id];
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
    }

}

module.exports = ElectronState;
