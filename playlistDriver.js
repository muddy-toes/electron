const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { logger } = require('./utils');

const ss4TagMap = {
    volume: 'Vol',
    rampRate: 'VolC',
    freq: 'BF',
    freqRampRate: 'BFC',
    amType: 'PAM_Pattern',
    amDepth: 'PAM_MD',
    amFreq: 'PAM_MF',
    amType2: 'SAM_Pattern',
    amDepth2: 'SAM_MD',
    amFreq2: 'SAM_MF',
    fmType: 'BFM_Pattern',
    fmDepth: 'BFM_MD',
    fmFreq: 'BFM_MF',
    tOn: 'TOn',
    tOff: 'TOff',
    tAtt: 'TAtt'
};

const ss4DefaultStep = {
    active: true,
    rampRate: 0,
    freqRampRate: 0,
    amType: 'none',
    amFreq: 0,
    amDepth: 10,
    amType2: 'none',
    amFreq2: 0,
    amDepth2: 10,
    fmType: 'none',
    fmFreq: 0,
    fmDepth: 10,
    tOn: 0.1,
    tAtt: 0.1,
    tOff: 0
};

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
        this.filenames_joined = '';
        this.playlist = [];
        this.playlist_index = 0;

        // Don't repeat files from the playlist within the past N entries:
        this.lastNFiles = [];
        this.noRepeatNFiles = 10;
        this.shufflePlaylist();
    }

    shufflePlaylist(force=false) {
        try {
						const filenames = fs.readdirSync(path.resolve(this.directory));
            if (!force && this.filenames_joined === filenames.join()) {
                return;
            } else {
                console.log('Files in playlist directory changed, resetting playlist.');
                this.playlist_index = 0;
                this.filenames_joined = filenames.join();
                if (filenames.length === 0) {
                    console.log('The directory is empty.');
                    this.playlist = [];
                    return;
                }

                this.playlist = Array.from(Array(filenames.length).keys()).sort((a, b) => Math.random() - 0.5).map((i) => filenames[i]);
            }
        } catch (error) {
						logger('[] Error reading directory: %s', error);
						return;
        }
    }

    nextFile() {
        this.shufflePlaylist();
        this.playlist_index++;
        if (this.playlist_index >= this.playlist.length) this.playlist_index = 0;
        return path.join(this.directory, this.playlist[this.playlist_index]);
    }

    getSubtrackValue(xml, tagName) {
        const tag = xml.getElementsByTagName(tagName)[0];
        if (tag === undefined || tag.length === 0) return;
        const val = tag.getAttribute('V');
        if (tagName.match(/_Pattern$/)) return tag.getAttribute('Type');
        if (val.match(/[0-9]/)) return parseFloat(val.replace(/,/, '.'));
        if (val.match(/True/)) return true;
        if (val.match(/False/)) return false;
    }

    convertSS4Step(step) {
        const self = this;
        let out = {};
        Object.keys(ss4TagMap).forEach(function(key) {
          let val = self.getSubtrackValue(step, ss4TagMap[key]);
          if (val === undefined)
              return;

          /* ss4 expresses volume as 0-1 */
          if (key == 'volume')
              val *= 100;
          else if (key.match(/Depth$/) && typeof(val) == 'number' && val < 0)
              val = val * -1;

          out[key] = val;
        });

        if (Number.isFinite(out['rampRate']))
          if (out['rampRate'] > 0)
              out['rampTarget'] = 100;
          else
              out['rampTarget'] = 0;

        if (out['amType'] === undefined && out['amFreq'] !== 0 && out['amDepth'] !== 0)
            out['amType'] = 'sine';

        if (out['amType2'] === undefined && out['amFreq2'] !== 0 && out['amDepth2'] !== 0)
            out['amType2'] = 'sine';

        if (out['fmType'] === undefined && out['fmFreq'] !== 0 && out['fmDepth'] !== 0)
            out['fmType'] = 'sine';

        return out;
    }

    /* Compatibility Note:
     *   This does not support the SineSquare modulation types because
     *   in the > 1000 SmrtStim4 files I have, not one uses them.
     */
    convertSS4ToElectron(xmlstring) {
        const self = this;
        const dom = new JSDOM();
        const parser = new dom.window.DOMParser();
        const xml = parser.parseFromString(xmlstring, 'text/xml');
        let out = { meta: { version: 2 }, left: [], right: [] };
        let scriptTime = 0;

        const session = xml.getElementsByTagName('Session')[0];
        if (session !== undefined) {
            out['meta']['driverName'] = session.getAttribute('Creator')
            out['meta']['driverComments'] = session.getAttribute('Name') + " " + session.getAttribute('Description')
        }

        const tracks = xml.getElementsByTagName('Track');
        let firstStep = true;
        Array.from(tracks).forEach(function(track) {
            const trackTime = parseFloat(track.getAttribute('Time').replace(/,/g, '.')) * 1000;
            if (isNaN(trackTime)) return;
            const subtracks = track.getElementsByTagName('Subtrack')
            const left = subtracks[0];
            const leftstep = { ...ss4DefaultStep, ...self.convertSS4Step(left) };
            if (firstStep && leftstep['volume'] === undefined) leftstep['volume'] = 50;
            if (Object.keys(leftstep).length > 0)
                out['left'].push({ stamp: scriptTime, message: leftstep });

            const right = subtracks[1];
            const rightstep = { ...ss4DefaultStep, ...self.convertSS4Step(right) };
            if (firstStep && rightstep['volume'] === undefined) rightstep['volume'] = 50;
            if (Object.keys(rightstep).length > 0)
                out['right'].push({ stamp: scriptTime, message: rightstep });

            scriptTime += trackTime + 1000;
            firstStep = false;
        });
        
        return out;
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
        let playing = false;
        let stoppedPlayingAt = 0;

        this.intervalId = setInterval(() => {
            const riderCount = electronState.getRiderSockets(sessId).length;
            if (riderCount === 0) {
                if (playing) {
                    stoppedPlayingAt = Date.now();
                    if (electronState.getVerbose()) logger('Last rider left, stop playing at %s', (new Date()));
                }
                playing = false;
                return;
            } else if (riderCount > 0 && !playing) {
                playing = true;
                // If we were stopped for  more than a minute, start a new file
                if (Date.now() - stoppedPlayingAt > 60000) {
                    if (electronState.getVerbose()) logger('Starting new file for new rider, was stopped for %f mins', ((Date.now() - stoppedPlayingAt) / 60000).toFixed(1));
                    script = false;
                } else {
                    if (electronState.getVerbose()) logger('Resuming play for new rider');
                }
            }

            if (!script) {
                electronState.clearLastMessages(sessId);

                try {
                    filepath = self.nextFile();
                    const scriptRaw = fs.readFileSync(filepath);
                    if (filepath.match(/\.(SmrtStm4|ss4)$/)) {
                        script = self.convertSS4ToElectron(scriptRaw);
                    } else {
                        script = JSON.parse(scriptRaw);
                    }
                } catch (err) {
                    logger('[%s] Error parsing file %s: %s', sessId, filepath, err);
                    return;
                }
                self.lastNFiles.push(filepath)
                if (self.lastNFiles.length > self.noRepeatNFiles) self.lastNFiles.splice(0, 1)

                logger('[%s] Now playing: %s', sessId, filepath);
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
                  logger('[%s] Cannot load script version greater than 2 from file %s', sessId, filepath);
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
                    logger("[%s] Failed to adjust first step start times: %o", sessId, err);
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
                    if (ch == 'bottle' && step['bottleDuration']) {
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

        logger('[%s] Playlist driver has been initialized', sessId);
    }
}

module.exports = PlaylistDriver;
