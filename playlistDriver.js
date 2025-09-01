const fs = require('fs');
const path = require('path');
const { logger } = require('./utils');

class PlaylistDriver {
    constructor(sessId, config) {
        this.verbose = false;

        // read all config values and transfer them as properties for this object
        Object.entries(config).forEach(([key, value]) => {
            this[key] = value;
        });

        // set initial internal state
        this.sessId = sessId;
        this.script = false;
        this.fileDriver = '';
        this.scriptVersion = 0;
        this.startTime = new Date();
        this.firstStepStamp = 0;
        this.scriptTimer = 0;
        this.scriptDuration = 0;
        this.channel_pos = {};

        // Don't repeat files from the playlist within the past N entries:
        this.lastNFiles = [];
        this.noRepeatNFiles = 10;
    }

    chooseFile() {
        // logger("chooseFile directory=%o", this.directory);
        try {
						const filenames = fs.readdirSync(path.resolve(this.directory));

						if (filenames.length === 0) {
								console.log('The directory is empty.');
								return null;
						}

						const randomIndex = Math.floor(Math.random() * filenames.length);
						const randomFilename = filenames[randomIndex];

						return path.join(this.directory, randomFilename);
        } catch (error) {
						logger('[] Error reading directory: %s', error);
						return null;
        }
    }

    run(electronState) {
        this.verbose = electronState.getVerbose();
        const self = this;
        let filepath;
        const sessId = this.sessId;
        const channels = this.channels;
        let channel_pos = this.channel_pos;
        let script = this.script;
        let fileDriver = this.fileDriver;
        let scriptVersion = this.scriptVersion;
        let firstStepStamp = this.firstStepStamp;
        let scriptDuration = this.scriptDuration;
        let scriptTimer = this.scriptTimer;

        this.intervalId = setInterval(() => {
            if (!script) {
                electronState.clearLastMessages(sessId);

                try {
                    let tries = 0;
                    while (tries < 5 && (filepath === undefined || self.lastNFiles.includes(filepath))) {
                        filepath = self.chooseFile();
                        tries++;
                    } 
                    const scriptRaw = fs.readFileSync(filepath);
                    if (filepath.match(/\.(SmrtStm4|ss4)$/)) {
                        script = convertSS4ToElectron(scriptRaw);
                    } else {
                        script = JSON.parse(scriptRaw);
                    }
                } catch (err) {
                    logger('[] Error parsing file %s: %s', filepath, err);
                    return;
                }
                self.lastNFiles.push(filepath)
                if (self.lastNFiles.length > self.noRepeatNFiles) self.lastNFiles.splice(0, 1)

                fileDriver = '';
                scriptVersion = 0;
                if (script['meta']) {
                    if (script['meta']['version']) {
                        scriptVersion = parseInt(script['meta']['version']) || 1;
                    }
                    if (script['meta']['driverName']) {
                        fileDriver = script['meta']['driverName'].replace(/[^A-Za-z0-9' !@.\^\&\-]/, '');
                    }
                    if (script['meta']['driverComments']) {
                    }
                    delete script['meta'];
                }

                // Upgrade script version
                if (scriptVersion > 2) {
                  logger('[] Cannot load script version great than 2 from file %s', filepath);
                  return;
                } else if (scriptVersion < 2) {
                    channels.forEach(function(ch) {
                        if (script[ch] !== undefined && script[ch][0] !== undefined && script[ch][0]['stamp'] !== undefined) {
                            let channelSum = 0;
                            for (var j = 0; j < script[ch].length; j++) {
                                channelSum += script[ch][j]['stamp'];
                                script[ch][j]['stamp'] = channelSum;
                            }
                        }
                    });
                    scriptVersion = 2;
                }

                // Set the script time to 1000ms prior to the first action, otherwise the thing could sit there for minutes after loading before
                // anything happens.
                try {
                    let firstStep = Number.MAX_SAFE_INTEGER;
                    let lastStep = 0;
                    channels.forEach(function(ch) {
                        if (script[ch] !== undefined && script[ch][0] !== undefined && script[ch][0]['stamp'] !== undefined ) {
                            script[ch].forEach(function(step) {
                                if (step['stamp'] < firstStep) {
                                    firstStep = step['stamp'];
                                }
                                if (step['stamp'] > lastStep) {
                                    lastStep = step['stamp'];
                                }
                            });
                        }
                    });
                    if (firstStep > 1000) {
                        scriptTimer = firstStep - 1000;
                    } else {
                      scriptTimer = 0;
                    }
                    firstStepStamp = scriptTimer;
                    scriptDuration = lastStep;
                    // if (electronState.getVerbose()) logger("firstStepStamp=%d, scriptDuration=%d", firstStepStamp, scriptDuration);
                } catch(err) {
                    logger("[] Failed to adjust first step start times: %o", err);
                }

                const fileinfo = path.basename(filepath).replace(/[^A-Za-z0-9' !@.\^\&\-]/, '');
                electronState.setSessionFlag(sessId, 'filePlaying', fileinfo);
                electronState.setSessionFlag(sessId, 'fileDriver', fileDriver);
                const flags = electronState.getSessionFlags(sessId)
                // if (electronState.getVerbose()) logger("[%s] updateRidersFlags, flags=%o", sessId, flags);
                electronState.getRiderSockets(sessId).forEach(function (s) {
                    s.emit('updateFlags', flags);
                });
                
                channels.forEach((ch) => channel_pos[ch] = 0);

                return;
            } /* end of loading new file */

            scriptTimer += 250;
            channels.forEach(function(ch) {
                const ch_pos = channel_pos[ch];
                if (script[ch] !== undefined && script[ch][ch_pos] !== undefined && script[ch][ch_pos]['stamp'] !== undefined && script[ch][ch_pos]['stamp'] <= scriptTimer) {
                    const step = script[ch][ch_pos];
                    channel_pos[ch]++;

                    // if (electronState.getVerbose()) logger("[%s] Step %s: %o", sessId, ch, step);
                    if (ch.match(/^pain-/)) {
                        // TODO
                    } else if (ch == 'bottle' && step['bottleDuration']) {
                        const secs = parseInt(step['bottleDuration']) || 0;
                        // if (electronState.getVerbose()) logger("[%s] triggerBottle, duration=%d", sessId, secs);
                        electronState.storeLastMessage(sessId, 'bottle', { bottleDuration: secs });
                        electronState.getRiderSockets(sessId).forEach(function (s) {
                            s.emit('bottle', { bottleDuration: secs });
                        });
                    } else {
                        electronState.storeLastMessage(sessId, ch, step['message']);
                        electronState.getRiderSockets(sessId).forEach(function (s) {
                            s.emit(ch, step['message']);
                        });
                    }
                }
            });

            const percent = ((scriptTimer - firstStepStamp) / scriptDuration * 100).toFixed(0);
            if (percent >= 100) {
                script = false;
            }
            /*
            const currentTime = parseInt(scriptTimer / 1000) - firstStepStamp / 1000;
            const remainingTime = scriptDuration / 1000 - currentTime;
            logger("[%s] Script playback %f / %f", self.sessId, currentTime, remainingTime);
            */
        }, 250);

        logger(`Playlist driver ${sessId} has been initialized`);
    }
}

module.exports = PlaylistDriver;
