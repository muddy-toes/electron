// places to store the current state of the application
// Now using SQLite for persistence so driver can reconnect and resume
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const AutomatedDriver = require('./automatedDriver');
const PlaylistDriver = require('./playlistDriver');
const { logger } = require('./utils');

const channels = ['left', 'right', 'pain-left', 'pain-right', 'bottle'];

class ElectronState {
    constructor(config={}) {
        this.config = config;
        
        // Initialize SQLite database
        const dbPath = path.resolve(config.dbPath || './electron-state.sqlite3');
        this.db = new Database(dbPath); // , { verbose: logger });
        this.db.pragma('journal_mode = WAL'); // Better concurrent access
        
        // Create tables if they don't exist
        this.initDatabase();
        
        // In-memory caches for performance (sockets can't be serialized)
        this.driverSockets = {};        // stores sockets for people driving sessions
        this.riders = {};               // stores all sockets for people riding each session
        this.automatedDrivers = {};     // stores automated drivers by their session ids
        this.trafficLights = {};        // dictionary binding sockets to red / yellow / green traffic lights
        
        logger('[] startup');
        if (this.config.verbose) logger('[] verbose logging enabled');
        if (this.config.memoryMonitor) logger('[] memoryMonitor logging enabled');
        
        this.loadActiveSessions();
    }

    initDatabase() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS sessions (
                sess_id TEXT PRIMARY KEY,
                driver_token TEXT,
                session_start_time INTEGER DEFAULT 0,
                created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
                updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
            )
        `);

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS session_flags (
                sess_id TEXT,
                flag_name TEXT,
                flag_value TEXT,
                PRIMARY KEY (sess_id, flag_name),
                FOREIGN KEY (sess_id) REFERENCES sessions(sess_id) ON DELETE CASCADE
            )
        `);

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sess_id TEXT,
                channel TEXT,
                stamp INTEGER,
                message TEXT,
                created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
                FOREIGN KEY (sess_id) REFERENCES sessions(sess_id) ON DELETE CASCADE
            )
        `);
        
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_messages_session_channel 
            ON messages(sess_id, channel)
        `);

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS message_stamps (
                sess_id TEXT,
                channel TEXT,
                stamp INTEGER,
                PRIMARY KEY (sess_id, channel),
                FOREIGN KEY (sess_id) REFERENCES sessions(sess_id) ON DELETE CASCADE
            )
        `);

        logger('[] Database initialized');
    }

    loadActiveSessions() {
        const sessions = this.db.prepare('SELECT sess_id FROM sessions').all();
        logger('[] Loaded %d active sessions from database', sessions.length);
        // Driver sockets and rider sockets will need to reconnect
    }

    getCamUrlList() {
        return this.config.camUrlList;
    }

    getVerbose() {
        return this.config.verbose;
    }

    initSessionData(sessId) {
        const now = Date.now();

        // Check if session exists
        const existing = this.db.prepare('SELECT sess_id FROM sessions WHERE sess_id = ?').get(sessId);

        if (! existing) {
            // Create new session
            this.db.prepare(`
                INSERT INTO sessions (sess_id, session_start_time) 
                VALUES (?, 0)
            `).run(sessId);
            
            // Initialize message stamps
            const insertStamp = this.db.prepare(`
                INSERT OR REPLACE INTO message_stamps (sess_id, channel, stamp) 
                VALUES (?, ?, ?)
            `);
            
            for (const channel of channels) {
                insertStamp.run(sessId, channel, now);
            }
        }

        // Set default flags for new driver
        this.setSessionFlag(sessId, 'driverName', 'Anonymous');

        if (this.config.camUrlList && this.config.camUrlList.length > 0) {
            const defaultItem = this.config.camUrlList.filter((item) => item.default)[0];
            if (defaultItem !== undefined) {
                this.setSessionFlag(sessId, 'camUrl', defaultItem.name);
            }
        }
        
        // Remove certain flags
        this.db.prepare('DELETE FROM session_flags WHERE sess_id = ? AND flag_name IN (?, ?)').run(
            sessId, 'filePlaying', 'fileDriver'
        );

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
        if (! sessId) return;
        if (this.config.savedSessionsPath && ! this.automatedDrivers[sessId]) {
            try {
                const sessionMessages = this.getSessionMessages(sessId);
                if (sessionMessages !== 'No messages stored') {
                    const savedSessionsDir = path.resolve(this.config.savedSessionsPath);
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

        // Delete from database (cascades to related tables)
        this.db.prepare('DELETE FROM sessions WHERE sess_id = ?').run(sessId);
        
        // Clean up in-memory data
        delete this.driverSockets[sessId];
        delete this.riders[sessId];
        
        logger("[%s] End session", sessId);

        logger("[] Stale session cleanup...");
        const sessions = this.db.prepare('SELECT sess_id from sessions').all();
        for (const session of sessions) {
          if (session.sess_id === sessId) continue;
          if (!this.driverSockets[session.sess_id] && !this.automatedDrivers[session.sess_id] && 
                 (!this.riders[session.sess_id] || (Array.isArray(this.riders[session.sess_id]) && !this.riders[session.sess_id].length))) {
              this.cleanupSessionData(session.sess_id);
          }
        }

        logger("[] Active sessions: %d", this.db.prepare('SELECT COUNT(*) as count FROM sessions').get().count);
        if (this.config.memoryMonitor) logger("[%s] memoryMonitor: cleanupSessionData %o", sessId, process.memoryUsage());
    }

    setSessionFlag(sessId, flagname, flagval) {
        this.db.prepare(`
            INSERT OR REPLACE INTO session_flags (sess_id, flag_name, flag_value) 
            VALUES (?, ?, ?)
        `).run(sessId, flagname, JSON.stringify(flagval));
    }

    getSessionFlags(sessId) {
        const flags = this.db.prepare(`
            SELECT flag_name, flag_value 
            FROM session_flags 
            WHERE sess_id = ?
        `).all(sessId);
        
        const result = {};
        for (const flag of flags) {
            try {
                result[flag.flag_name] = JSON.parse(flag.flag_value);
            } catch (e) {
                result[flag.flag_name] = flag.flag_value;
            }
        }
        return result;
    }

    getPublicSessions() {
        const publicSessions = this.db.prepare(`
            SELECT s.sess_id, sf.flag_value as driver_name
            FROM sessions s
            LEFT JOIN session_flags sf ON s.sess_id = sf.sess_id AND sf.flag_name = 'driverName'
            WHERE EXISTS (
                SELECT 1 FROM session_flags 
                WHERE sess_id = s.sess_id 
                AND flag_name = 'publicSession' 
                AND flag_value = 'true'
            )
        `).all();
        
        return publicSessions.map(session => {
            const sessId = session.sess_id;
            const ridercount = this.riders[sessId]?.length || 0;
            let name = sessId;
            try {
                name = session.driver_name ? JSON.parse(session.driver_name) : sessId;
            } catch (e) {
                name = session.driver_name || sessId;
            }
            return { sessId: sessId, name: name, riders: ridercount };
        });
    }

    setDriverSocket(sessId, socket) {
        this.driverSockets[sessId] = socket;
    }

    addDriverToken(sessId, token, socket) {
        // Don't turn this into an INSERT OR REPLACE or it'll blow away the FK records prematurely
        const existing = this.db.prepare('SELECT sess_id FROM sessions WHERE sess_id = ?').get(sessId);
        if (existing) {
            this.db.prepare('UPDATE sessions set driver_token=?, updated_at=? where sess_id=?').run(token, Date.now(), sessId);
        } else {
            this.db.prepare('INSERT INTO sessions (sess_id, driver_token, updated_at) VALUES (?, ?, ?)').run(sessId, token, Date.now());
        }
        
        this.setDriverSocket(sessId, socket);
        this.initSessionData(sessId);
    }

    driverTokenExists(sessId) {
        if (sessId in this.automatedDrivers) return true;
        
        const result = this.db.prepare('SELECT driver_token FROM sessions WHERE sess_id = ?').get(sessId);
        return result !== undefined && result.driver_token;
    }

    validateDriverToken(sessId, driverToken) {
        const result = this.db.prepare('SELECT sess_id, driver_token FROM sessions WHERE sess_id = ?').get(sessId);
        if (! result) return false;
        return result.driver_token === driverToken;
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
            return this.riders[sessId].includes(socket);
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
        // Ensure session exists
        const session = this.db.prepare('SELECT session_start_time FROM sessions WHERE sess_id = ?').get(sessId);
        if (! session) return;
        
        const now = Date.now();
        
        // Update session start time if needed
        if (session.session_start_time === 0) {
            this.db.prepare('UPDATE sessions SET session_start_time = ? WHERE sess_id = ?').run(now, sessId);
        }
        
        // Get previous stamp
        const stampRow = this.db.prepare('SELECT stamp FROM message_stamps WHERE sess_id = ? AND channel = ?').get(sessId, channel);
        const previousStamp = stampRow ? stampRow.stamp : now;
        const stamp_offset = now - previousStamp;
        
        // Update stamp
        this.db.prepare('INSERT OR REPLACE INTO message_stamps (sess_id, channel, stamp) VALUES (?, ?, ?)').run(sessId, channel, now);
        
        // Filter out promode keys if needed
        let m = {...message};
        if (! this.config?.features?.promode) {
            this.config?.promodeKeys?.forEach(function(key) { delete m[key]; });
        }
        
        // Store message
        this.db.prepare(`
            INSERT INTO messages (sess_id, channel, stamp, message) 
            VALUES (?, ?, ?, ?)
        `).run(sessId, channel, stamp_offset, JSON.stringify(m));
        
        if (this.config.memoryMonitor) logger("[%s] memoryMonitor: storeLastMessage %o", sessId, process.memoryUsage());
    }

    clearLastMessages(sessId) {
        const now = Date.now();
        
        // Delete all messages for this session
        this.db.prepare('DELETE FROM messages WHERE sess_id = ?').run(sessId);
        
        // Reset session start time
        this.db.prepare('UPDATE sessions SET session_start_time = ? WHERE sess_id = ?').run(now, sessId);
        
        // Reset all message stamps
        const updateStamp = this.db.prepare('INSERT OR REPLACE INTO message_stamps (sess_id, channel, stamp) VALUES (?, ?, ?)');
        
        for (const channel of channels) {
            updateStamp.run(sessId, channel, now);
        }
        
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
        const result = this.db.prepare(`
            SELECT stamp, message 
            FROM messages 
            WHERE sess_id = ? AND channel = ? 
            ORDER BY id DESC 
            LIMIT 1
        `).get(sessId, channel);
        
        if (! result) return null;
        
        return {
            stamp: result.stamp,
            message: JSON.parse(result.message)
        };
    }

    getSessionMessages(sessId) {
        const sessionFlags = this.getSessionFlags(sessId);
        
        // Get all messages for this session grouped by channel
        const messages = this.db.prepare(`
            SELECT channel, stamp, message 
            FROM messages 
            WHERE sess_id = ? 
            ORDER BY id ASC
        `).all(sessId);
        
        if (messages.length === 0) {
            return 'No messages stored';
        }
        
        let data_to_return = {
            'meta': { 
                driverName: sessionFlags['driverName'], 
                driverComments: sessionFlags['driverComments'], 
                version: 1, 
                fileType: 'e l e c t r o n script' 
            }
        };
        
        // Group messages by channel
        for (const channel of channels) {
            const channelMessages = messages
                .filter(m => m.channel === channel)
                .map(m => {
                    const msg = JSON.parse(m.message);
                    delete msg.sessId;
                    delete msg.driverToken;
                    return { stamp: m.stamp, message: msg };
                });
            
            if (channelMessages.length > 0) {
                data_to_return[channel] = channelMessages;
            }
        }
        
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
                    const self = this;
                    setTimeout(function() {
                        if (self.driverSockets[sessId]) return;

                        self.db.prepare('UPDATE sessions SET driver_token = NULL WHERE sess_id = ?').run(sessId);
                        if (self.riders[sessId] && self.riders[sessId].length > 0) {
                            self.riders[sessId].forEach(function(s) {
                                const rider_ip = s.handshake.headers['x-forwarded-for'] || s.handshake.address;
                                logger('[%s] Send driverLost to rider at %s', sessId, rider_ip);
                                s.emit('driverLost');
                            });
                            if (self.config.memoryMonitor) logger("[%s] memoryMonitor: onDisconnect-driver-lost %o", sessId, process.memoryUsage());
                        } else {
                            logger('[%s] Driver left, no riders present, ending session', sessId);
                            self.cleanupSessionData(sessId);
                        }
                    }, 5000); // Give the driver time to reconnect before opening it up
                }
            }
        }
    }

    startAutomatedDriver(sessId, automatedDriverConfig) {
        if (this.driverTokenExists(sessId)) {
            return false;
        }

        if (! this.automatedDrivers[sessId]) {
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
        if (! fs.lstatSync(dir).isDirectory()) {
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
    
    close() {
        // Graceful shutdown
        this.db.close();
        logger("[] Database connection closed");
    }
}

module.exports = ElectronState;
