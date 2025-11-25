// places to store the current state of the application
// as we don't use a database of any kind (it's all in memory!)
const fs = require('fs');
const AutomatedDriver = require('./automatedDriver');
const PlaylistDriver = require('./playlistDriver');
const { logger } = require('./utils');

class ElectronState {
    constructor(config={}) {
        this.config = config;
        this.driverTokens = {};         // stores the authentication tokens of drivers
        this.driverSockets = {};        // stores sockets for people driving sessions
        this.riders = {};               // stores all sockets for people riding each session
        this.previousMessageStamp = {}; // stores timestamp of previous message for calculating offsets
        this.lastMessages = {};         // storage of incoming messages (setting waveform parameters, pain tool, etc.)
        this.sessionStartTimes = {};    // storage of timestamps when each session starts
        this.automatedDrivers = {};     // stores automated drivers by their session ids
        this.trafficLights = {};        // dictionary binding sockets to red / yellow / green traffic lights
        this.sessionFlags = {};         // sessionFlags[sessId][flagname]
                                        // flagnames in use: blindfoldRiders, publicSession, driverName, proMode, camUrl, driverComments
        logger("[] startup");
        if (this.config.verbose) logger("[] verbose logging enabled");
        if (this.config.memoryMonitor) logger("[] memoryMonitor logging enabled");
    }

    getCamUrlList() {
      return this.config.camUrlList;
    }

    getVerbose() {
      return this.config.verbose;
    }

    initSessionData(sessId) {
        const now = Date.now();
        this.previousMessageStamp[sessId] ||= { 'left': now, 'right': now, 'pain-left': now, 'pain-right': now, 'bottle': now };
        this.lastMessages[sessId] ||= {};
        this.sessionStartTimes[sessId] = 0;
        this.sessionFlags[sessId] ||= {};

        // New driver, reset some settings...
        this.sessionFlags[sessId]['driverName'] = 'Anonymous';
        if (this.config.camUrlList && this.config.camUrlList.length > 0) {
            const defaultItem = this.config.camUrlList.filter((item) => item.default)[0];
            if (defaultItem !== undefined) {
                this.sessionFlags[sessId]['camUrl'] = defaultItem.name;
            }
        } else {
        }
        delete this.sessionFlags[sessId]['camUrl'];
        delete this.sessionFlags[sessId]['filePlaying'];
        delete this.sessionFlags[sessId]['fileDriver'];

        // Only update if we have a real driver, not automated
        if (this.driverSockets[sessId]) {
            const sessionflags = this.getSessionFlags(sessId);
            this.driverSockets[sessId].emit('updateFlags', sessionflags);
            if (this.riders[sessId]) {
                this.riders[sessId].forEach(function(s) {
                    s.emit('updateFlags', sessionflags);
                });
            }
        }

        if (this.config.memoryMonitor) logger("[%s] memoryMonitor: initSessionData %o", sessId, process.memoryUsage());
    }

    cleanupSessionData(sessId) {
        if (this.config.savedSessionsPath && ! this.automatedDrivers[sessId]) {
            try {
                const sessionMessages = this.getSessionMessages(sessId);
                if (sessionMessages !== 'No messages stored') {
                    const savedSessionsDir = path.resolve('./saved_sessions');
                    if (! fs.existsSync(savedSessionsDir)) {
                        fs.mkdirSync(savedSessionsDir, { recursive: true });
                    }
                    let filePath;
                    let i = 0;
                    do {
                        filePath = path.join(savedSessionsDir, `${sessId}${i > 0 ? ` (${i})` : ''}.json`);
                        i++;
                    } while (fs.existsSync(filePath));
                    fs.writeFileSync(filePath, sessionMessages, 'utf8');
                    logger("[%s] Session saved to %s", sessId, filePath);
                }
            } catch (err) {
                logger("[%s] Error saving session to file: %s", sessId, err.message);
            }

            // expire old saved sessions
            if (this.config.savedSessionsDays && this.config.savedSessionsDays > 0) {
                try {
                    const maxAgeMs = (this.config.savedSessionsDays || 3) * 86400000;
                    const now = Date.now();
                    const files = fs.readdirSync(path.resolve(this.config.savedSessionsPath));
                    for (const file of files) {
                        const filePath = path.join(this.config.savedSessionsPath, file);
                        const stat = fs.statSync(filePath);
                        if (stat.isFile() && now - stat.mtime.getTime() > maxAgeMs) {
                          fs.unlinkSync(filePath);
                          logger("[] Removed expired savedSession file %s", file);
                        }
                    }
                } catch (e) {
                    logger("[] Error deleting expired savedSession files: %s", e);
                }
            }
        }

        delete this.lastMessages[sessId];
        delete this.previousMessageStamp[sessId];
        delete this.sessionStartTimes[sessId];
        delete this.sessionFlags[sessId];
        delete this.driverTokens[sessId];
        delete this.driverSockets[sessId];
        delete this.riders[sessId];
        logger("[%s] End session", sessId);
        logger("[] Active sessions: %d", Object.keys(this.lastMessages).length);
        if (this.config.memoryMonitor) logger("[%s] memoryMonitor: cleanupSessionData %o", sessId, process.memoryUsage());
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
        const riders = this.riders;
        Object.keys(this.sessionFlags).forEach(function(sessId) {
          if (! sessionFlags[sessId])
            return;

          if (sessionFlags[sessId]['publicSession']) {
            const ridercount = riders[sessId]?.length || 0;
            publiclist.push({ sessId: sessId, name: sessionFlags[sessId]['driverName'] || sessId, riders: ridercount });
          }
        });
        return publiclist;
    }

    addDriverToken(sessId, token, socket) {
        this.driverTokens[sessId] = token;
        this.driverSockets[sessId] = socket;
        this.initSessionData(sessId);
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
        if (this.config.memoryMonitor) logger("[%s] memoryMonitor: addRiderSocket %o", sessId, process.memoryUsage());
    }

    validateRider(sessId, socket) {
        if (this.riders[sessId]) {
          return this.riders[sessId].includes(socket)
        } else {
          return false;
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

        if (this.sessionStartTimes[sessId] == 0) {
            this.sessionStartTimes[sessId] = Date.now();
        }
        const now = Date.now();
        this.previousMessageStamp[sessId] ||= {};
        this.previousMessageStamp[sessId][channel] ||= now;
        // const abs_stamp_offset = now - this.sessionStartTimes[sessId];
        const stamp_offset = now - this.previousMessageStamp[sessId][channel];
        this.previousMessageStamp[sessId][channel] = now;
        this.lastMessages[sessId][channel] ||= [];

        let m = {...message};
        if (! this.config?.features?.promode) this.config?.promodeKeys?.forEach(function(key) { delete m[key] });

        this.lastMessages[sessId][channel].push({ stamp: stamp_offset, message: m });
        if (this.config.memoryMonitor) logger("[%s] memoryMonitor: storeLastMessage %o", sessId, process.memoryUsage());
    }

    clearLastMessages(sessId) {
        const now = Date.now();
        this.lastMessages[sessId] = {};
        this.sessionStartTimes[sessId] = now;
        this.previousMessageStamp[sessId] = { 'left': now, 'right': now, 'pain-left': now, 'pain-right': now, 'bottle': now };
        if (this.config.memoryMonitor) logger("[%s] memoryMonitor: clearLastMessages %o", sessId, process.memoryUsage());
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
        if (!(sessId in this.lastMessages) || (!('left' in this.lastMessages[sessId]) && !('right' in this.lastMessages[sessId]))) {
            return "No messages stored";
        }
        const lastmessages = this.lastMessages;
        const sessionflags = this.sessionFlags;
        let data_to_return = {
            'meta': { driverName: sessionflags[sessId]['driverName'], driverComments: sessionflags[sessId]['driverComments'], version: 1, fileType: 'e l e c t r o n script' }
        };
        ['left', 'right', 'pain-left', 'pain-right', 'bottle'].forEach(function(channel) {
          if (lastmessages[sessId][channel])
            data_to_return[channel] = lastmessages[sessId][channel].filter(function(m) { delete m['message'].sessId ; delete m['message'].driverToken; return m; });
        });
        return JSON.stringify(data_to_return);
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
        const remote_ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;

        for (const sessId in this.riders) {
            const index = this.riders[sessId].indexOf(socket);
            if (index > -1) {
                found_rider = true;
                this.riders[sessId].splice(index, 1);
                delete this.trafficLights[socket.id];
                logger('[%s] Rider left from %s (session riders: %d)', sessId, remote_ip, this.riders[sessId]?.length || 0);
                if (! this.driverSockets[sessId] && ! this.automatedDrivers[sessId]) {
                    logger('[%s] Last rider left, no driver present, ending session', sessId);
                    this.cleanupSessionData(sessId);
                }
                if (this.config.memoryMonitor) logger("[%s] memoryMonitor: onDisconnect-rider-left %o", sessId, process.memoryUsage());
            }
        }

        if (! found_rider) {
            for (const sessId in this.driverSockets) {
                if (this.driverSockets[sessId] === socket) {
                    logger('[%s] Driver disconnected from %s (session riders: %d)', sessId, remote_ip, this.riders[sessId]?.length || 0);
                    delete this.driverSockets[sessId];
                    delete this.driverTokens[sessId];
                    if (this.riders[sessId] && this.riders[sessId].length > 0) {
                        this.riders[sessId].forEach(function(s) {
                            const rider_ip = s.handshake.headers['x-forwarded-for'] || s.handshake.address;
                            logger('[%s] Send driverLost to rider at %s', sessId, rider_ip);
                            s.emit('driverLost');
                        });
                        if (this.config.memoryMonitor) logger("[%s] memoryMonitor: onDisconnect-driver-lost %o", sessId, process.memoryUsage());
                    } else {
                        logger('[%s] Driver left, no riders present, ending session', sessId);
                        this.cleanupSessionData(sessId);
                    }
                }
            }
        }
    }

    startAutomatedDriver(sessId, automatedDriverConfig) {
        if (this.driverTokenExists(sessId)) {
            return false;
        }

        if (!this.automatedDrivers[sessId]) {
            this.automatedDrivers[sessId] = new AutomatedDriver(sessId, automatedDriverConfig);
            this.initSessionData(sessId);
            const driverNames = this.config.automatedSession?.driverNames || ['Autodriver'];
            const driverName = driverNames[Math.floor(Math.random() * driverNames.length)];
            this.setSessionFlag(sessId, 'driverName', driverName);
            this.setSessionFlag(sessId, 'publicSession', automatedDriverConfig['publicSession']);
            this.setSessionFlag(sessId, 'blindfoldRiders', false);
            this.setSessionFlag(sessId, 'proMode', automatedDriverConfig['proMode']);
            this.setSessionFlag(sessId, 'driverComments', automatedDriverConfig['driverComments']);
            this.automatedDrivers[sessId].run(this);
            return true;
        } else {
            return false;
        }
    }

    unregisterAutomatedDriver(sessId) {
        delete this.automatedDrivers[sessId];
        this.cleanupSessionData(sessId);
    }

    startPlaylistDriver(playlistConfig) {
        const sessId = playlistConfig.sessId;
        const dir = playlistConfig.directory;
        if( ! fs.lstatSync(dir).isDirectory() ) {
          logger('[] Configured playlist directory is not a directory: %s', dir);
          return false;
        }
        this.automatedDrivers[sessId] = new PlaylistDriver(sessId, playlistConfig);
        this.initSessionData(sessId);
        this.setSessionFlag(sessId, 'driverName', playlistConfig.driverName || 'Playlistdriver');
        this.setSessionFlag(sessId, 'publicSession', playlistConfig.public);
        this.setSessionFlag(sessId, 'blindfoldRiders', false);
        this.setSessionFlag(sessId, 'proMode', true);
        this.setSessionFlag(sessId, 'driverComments', playlistConfig.driverComments);
        this.setSessionFlag(sessId, 'camUrl', playlistConfig.camUrl);
        this.automatedDrivers[sessId].run(this);
        return true;

    }

}

module.exports = ElectronState;
