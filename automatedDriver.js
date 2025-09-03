const { logger } = require('./utils');

class AutomatedDriver {
    constructor(sessId, config) {
        this.verbose = false;

        // read all config values and transfer them as properties for this object
        Object.entries(config).forEach(([key, value]) => {
            this[key] = value;
        });

        this.next_bottle = 0;

        // set initial internal state
        this.inUse = false; // is anyone listening to this session?
        this.sessId = sessId;
        this.startTime = new Date();
        const defaultChannelState = {
            volume: this.startVolume,
            freq: this.initialFrequency,
            fmType: 'none',
            fmDepth: 0,
            fmFreq: 0,
            amType: 'none',
            amDepth: 0,
            amFreq: 0,
            amType2: 'none',
            amDepth2: 0,
            amFreq2: 0,
            tOn: 0.1,
            tAtt: 0.1,
            tOff: 0
        };

        this.leftChannel = { ...defaultChannelState };
        this.rightChannel = { ...defaultChannelState };
    }

    setNextBottle() {
        const now = Date.now();
        this.next_bottle = parseInt(now + (Math.random() * (this.bottlePromptingMax - this.bottlePromptingMin) + this.bottlePromptingMin) * 1000);
        if (this.verbose)
            logger("[%s] Automated driver setNextBottle min/max/next %o/%o/%o",
                   this.sessId, this.bottlePromptingMin, this.bottlePromptingMax, parseInt((this.next_bottle - now) / 1000));
    }

    updateVolume(channel, elapsedMinutes) {
        // Increase max value for dVolume over duration of session
        const d = this.endMaxVolumeChange - this.startMaxVolumeChange;
        const dVolumeMax = Math.min(this.startMaxVolumeChange + d * (elapsedMinutes / this.sessionDuration), this.endMaxVolumeChange);
        const dVolume = Math.random() * dVolumeMax;
        if (Math.random() < 0.7) {
            channel.volume += dVolume;
        } else {
            channel.volume -= dVolume;
        }

        // Safeguard: Linear function between startvol+10% at 0 minutes and 100% at the end
        const maxVolume = this.startVolume + 10 + Math.min((90 - this.startVolume) * (elapsedMinutes / this.sessionDuration), (90 - this.startVolume));
        channel.volume = Math.min(Math.max(channel.volume, this.startVolume), maxVolume);
        channel.volume = Math.round(channel.volume);
    }

    toggleFM(channel, elapsedMinutes) {
        // Randomly enable or disable FM
        if (channel.fmType !== 'none') {
            channel.fmType = 'none';
            channel.fmFreq = 0;
            channel.fmDepth = 0;
        } else {
            channel.fmType = this.getRandomAMType();
            // Increase max value from 2 to 10 over session
            const fmFreqMax = Math.min(2 + 8 * (elapsedMinutes / this.sessionDuration), 10);
            channel.fmFreq = parseFloat((Math.random() * fmFreqMax).toFixed(2));

            let fmDepth = this.minFMDepth + Math.random() * (this.maxFMDepth - this.minFMDepth);
            fmDepth = fmDepth * (channel.volume / 100.0); // make FM depth proportional to volume
            channel.fmDepth = parseFloat(fmDepth).toFixed(2);
        }
    }

    toggleAM(channel, elapsedMinutes) {
        // Randomly enable or disable AM
        if (channel.amType !== 'none') {
            channel.amType = 'none';
            channel.amFreq = 0;
            channel.amDepth = 0;
        } else {
            channel.amType = this.getRandomAMType();
            // Increase max value from 2 to 10 over session
            const amFreqMax = Math.min(2 + 8 * (elapsedMinutes / this.sessionDuration), 10);
            channel.amFreq = parseFloat((Math.random() * amFreqMax).toFixed(2));

            let amDepth = this.minAMDepth + Math.random() * (this.maxAMDepth - this.minAMDepth);
            amDepth = amDepth * (channel.volume / 100.0); // make AM depth proportional to volume
            channel.amDepth = parseFloat(amDepth).toFixed(2);
        }
    }

    toggleAM2(channel, elapsedMinutes) {
        // Randomly enable or disable AM2
        if (channel.amType2 !== 'none') {
            channel.amType2 = 'none';
            channel.amFreq2 = 0;
            channel.amDepth2 = 0;
        } else {
            channel.amType2 = this.getRandomAMType();
            // Increase max value from 2 to 10 over session
            const amFreqMax = Math.min(2 + 8 * (elapsedMinutes / this.sessionDuration), 10);
            channel.amFreq2 = parseFloat((Math.random() * amFreqMax).toFixed(2));

            let amDepth = this.minAMDepth2 + Math.random() * (this.maxAMDepth2 - this.minAMDepth2);
            amDepth = amDepth * (channel.volume / 100.0); // make AM depth proportional to volume
            channel.amDepth2 = parseFloat(amDepth).toFixed(2);
        }
    }

    getRandomAMType() {
        const probabilityConfig = this.amTypes;
        let probabilitySum = 0;

        // Add all probabilities together in order to determine a cutoff point later
        const waveformProbabilities = probabilityConfig.waveforms.map((waveform, index) => {
            probabilitySum += probabilityConfig.probabilities[index];
            return { waveform, probability: probabilitySum };
        });

        // Find the randomly selected waveform based on a random number
        const randomNum = Math.random();
        const selectedWaveform = waveformProbabilities.find(waveform => randomNum < waveform.probability);
        return selectedWaveform.waveform;
    }

    varyFrequency(channel, otherChannelFreq) {
        // Vary the frequencies using a random walk with reflective boundaries
        // Limit the step size to be the lesser of 50 Hz or the min-to-max frequency span
        const variation = (Math.random() * 2 - 1) * Math.min(50, this.maxFrequency - this.minFrequency);
        let newFreq = channel.freq + variation;
        if (newFreq < this.minFrequency) {
            newFreq = 2 * this.minFrequency - newFreq;
        } else if (newFreq > this.maxFrequency) {
            newFreq = 2 * this.maxFrequency - newFreq;
        }
        // Round frequency to the nearest 0.1 Hz
        newFreq = Math.round(newFreq * 10) / 10;
        if (newFreq != otherChannelFreq) {
            channel.freq = newFreq;
        }
        // Do not change frequency if it is the same as other channel's frequency,
        // because in triphase configuration channels can cancel or add too strongly.
        // Instead keep the same frequency and wait for the next update.
    }

    emitToRiders(channel, channelName, electronState) {
        const msg = {
            volume: channel.volume,
            freq: channel.freq,
            fmType: channel.fmType,
            fmDepth: channel.fmDepth,
            fmFreq: channel.fmFreq,
            amType: channel.amType,
            amDepth: channel.amDepth,
            amFreq: channel.amFreq,
            amType2: channel.amType2,
            amDepth2: channel.amDepth2,
            amFreq2: channel.amFreq2,
            tOn: 0.1,
            tAtt: 0.1,
            tOff: 0,
            active: true,
            rampTarget: channel.volume,
            rampRate: 0
        };

        electronState.getRiderSockets(this.sessId).forEach(function (s) {
            s.emit(channelName, msg);
        });
        electronState.storeLastMessage(this.sessId, channelName, msg);
    }

    emitEndOfSession(channel, channelName, electronState) {
        const msg = {
            volume: channel.volume,
            freq: channel.freq,
            fmType: 'none',
            fmDepth: channel.fmDepth,
            fmFreq: channel.fmFreq,
            amType: 'none',
            amDepth: channel.amDepth,
            amFreq: channel.amFreq,
            amType2: 'none',
            amDepth2: channel.amDepth2,
            amFreq2: channel.amFreq2,
            active: true,
            fmType: 'none',
            fmDepth: 10,
            fmFreq: 0,
            rampTarget: 0,
            rampRate: 1
        };

        electronState.getRiderSockets(this.sessId).forEach(function (s) {
            s.emit(channelName, msg);
        });
        electronState.storeLastMessage(this.sessId, channelName, msg);
    }

    processChannel(channel, channelName, otherChannel, elapsedMinutes, electronState) {
        // first, we consider the possibility of pain!
        if (Math.random() < (this.painProbability * 0.01) && elapsedMinutes > 0) {
            if (electronState.getVerbose()) logger('[%s] Automated driver is sending PAIN signal to the %s channel', this.sessId, channelName.toUpperCase());
            this.processPain(channel, channelName, electronState);
            return;
        }

        this.updateVolume(channel, elapsedMinutes);
        if (Math.random() < 0.3 && this.minFMDepth > 0) {
            // 30% chance of making changes to the FM
            this.toggleFM(channel, elapsedMinutes);
        }
        if (Math.random() < 0.3 && this.minAMDepth > 0) {
            // 30% chance of making changes to the AM
            this.toggleAM(channel, elapsedMinutes);
        }
        if (Math.random() < 0.3 && this.minAMDepth2 > 0) {
            // 30% chance of making changes to the AM
            this.toggleAM2(channel, elapsedMinutes);
        }

        this.varyFrequency(channel, otherChannel.freq);
        this.emitToRiders(channel, channelName, electronState);
        if (electronState.getVerbose()) logger('[%s] Automated driver made changes to the %s channel. Elapsed minutes: %f', this.sessId, channelName.toUpperCase(), elapsedMinutes.toFixed(2));
    }

    processPain(channel, channelName, electronState) {
        const msg = {
            volume: Math.min(1.0, (channel.volume + this.painIntensity) * 0.01),
            frequency: channel.freq,
            shockDuration: Math.random(this.painMinShockLength, this.painMaxShockLength),
            timeBetweenShocks: Math.random(this.painMinTimeBetweenShocks, this.painMaxTimeBetweenShocks),
            numberOfShocks: Math.round(this.painMinShocks + Math.random() * (this.painMaxShocks - this.painMinShocks))
        };

        electronState.getRiderSockets(this.sessId).forEach(function (s) {
            s.emit('pain-' + channelName, msg);
        });
    }

    runActionsOnChannels(elapsedMinutes, electronState) {
        if (this.bottlePromptingMin > 0 && Math.random() < this.bottlePromptingProbability && Date.now() > this.next_bottle) {
            const duration = parseInt(Math.random() * 5 + 5);
            this.setNextBottle();
            if (electronState.getVerbose()) logger('[%s] Automated driver %s sending bottle prompt for %ds.  Next eligible in %ds.  Elapsed minutes: %f', this.sessId, duration, parseInt((this.next_bottle - Date.now()) / 1000), elapsedMinutes.toFixed(2));
            electronState.getRiderSockets(this.sessId).forEach(function (s) {
                s.emit('bottle', { bottleDuration: duration });
            });
        }

        if (Math.random() < 0.5 || elapsedMinutes === 0) {
            // 50% chance of making changes to the left channel
            this.processChannel(this.leftChannel, 'left', this.rightChannel, elapsedMinutes, electronState);
        }

        if (Math.random() < 0.5 || elapsedMinutes === 0) {
            // 50% chance of making changes to the right channel
            this.processChannel(this.rightChannel, 'right', this.leftChannel, elapsedMinutes, electronState);
        }
    }

    run(electronState) {
        this.verbose = electronState.getVerbose();
        this.setNextBottle();
        this.intervalId = setInterval(() => {
            const elapsedMinutes = (new Date() - this.startTime) / 60000;
            if (Math.random() >= this.noChangesProbability) {
                // there is a chance of not making any changes at all
                this.runActionsOnChannels(elapsedMinutes, electronState);
            }

            if (!this.inUse) {
                const riders = electronState.getRiderSockets(this.sessId);
                if (riders.length > 0) {
                    this.inUse = true;
                }
            }

            // if it has been more than 5 minutes and no one has joined, kill it
            if (elapsedMinutes >= 5 && !this.inUse) {
                logger('[%s] Automated driver has no riders', this.sessId);
                clearTimeout(this.stopTimeoutId);
                this.stop(electronState);
            }

        }, this.msBetweenUpdates);

        // stop session after the duration has elapsed
        this.stopTimeoutId = setTimeout(() => {
            this.emitEndOfSession(this.leftChannel, 'left', electronState);
            this.emitEndOfSession(this.rightChannel, 'right', electronState);
            this.stop(electronState);
        }, 60 * this.sessionDuration * 1000);

        logger('[%s] Automated driver has been initialized', this.sessId);
        this.runActionsOnChannels(0, electronState);
    }

    stop(electronState) {
        clearInterval(this.intervalId);
        electronState.unregisterAutomatedDriver(this.sessId);
        logger('[%s] Automated driver has been stopped', this.sessId);
    }
}

module.exports = AutomatedDriver;
