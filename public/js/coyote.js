// Coyote Device Management
// Handles Web Bluetooth connection and command sending

class CoyoteDevice {
    constructor() {
        this.device = null;
        this.server = null;
        this.service = null;
        this.version = null;  // 'v2' or 'v3'
        this.connected = false;
        this.eStopped = false;  // E-stop state - when true, send loop outputs zero

        // Protocol handlers
        this.v2Protocol = new CoyoteV2Protocol();
        this.v3Protocol = new CoyoteV3Protocol();

        // V2 characteristics
        this.charIntensity = null;
        this.charWaveA = null;
        this.charWaveB = null;

        // V3 characteristics
        this.charWrite = null;

        // Send loop
        this.sendInterval = null;

        // Soft ramp state
        this.ramping = false;
        this.rampStartTime = 0;
        this.rampDuration = 5000;  // 5 seconds default

        // Current intensity (for ramping)
        this.currentIntensityA = 0;
        this.currentIntensityB = 0;

        // Load settings
        this.settings = this.loadSettings();
        // Always start with zero intensity for safety - user must explicitly raise it
        this.settings.maxIntensityA = 0;
        this.settings.maxIntensityB = 0;

        // Callbacks
        this.onStatusChange = null;
        this.onError = null;
    }

    // Default settings
    static get defaultSettings() {
        return {
            maxIntensityA: 0,        // 0-100 percentage
            maxIntensityB: 0,
            freqBandLow: 300,         // Hz
            freqBandHigh: 700,        // Hz
            freqMappingMode: 'fixed', // 'fixed' or 'centered'
            freqCenterWidth: 200,     // Hz (total width, so +/- half this from center)
            softRampEnabled: true,
            softRampDuration: 5000,   // ms
            panelCollapsed: true
        };
    }

    loadSettings() {
        try {
            const saved = localStorage.getItem('coyoteSettings');
            if (saved) {
                return { ...CoyoteDevice.defaultSettings, ...JSON.parse(saved) };
            }
        } catch (e) {
            console.warn('Failed to load coyote settings:', e);
        }
        return { ...CoyoteDevice.defaultSettings };
    }

    saveSettings() {
        try {
            localStorage.setItem('coyoteSettings', JSON.stringify(this.settings));
        } catch (e) {
            console.warn('Failed to save coyote settings:', e);
        }
    }

    // Check if Web Bluetooth is supported
    static isSupported() {
        return typeof navigator !== 'undefined' &&
               typeof navigator.bluetooth !== 'undefined';
    }

    // Scan for V2 devices
    async scanV2() {
        return this.scan('v2');
    }

    // Scan for V3 devices
    async scanV3() {
        return this.scan('v3');
    }

    // Scan for devices
    async scan(version) {
        if (!CoyoteDevice.isSupported()) {
            throw new Error('Web Bluetooth is not supported in this browser');
        }

        if (this.connected) {
            throw new Error('Already connected. Disconnect first.');
        }

        const config = version === 'v2' ? COYOTE_V2 : COYOTE_V3;

        this.updateStatus('scanning');

        try {
            this.device = await navigator.bluetooth.requestDevice({
                filters: [{ namePrefix: config.NAME_PREFIX }],
                optionalServices: [config.SERVICE_UUID]
            });

            this.device.addEventListener('gattserverdisconnected', () => this.handleDisconnect());

            await this.connect(version);

        } catch (e) {
            this.updateStatus('disconnected');
            if (e.name === 'NotFoundError') {
                throw new Error('No device selected');
            }
            throw e;
        }
    }

    // Connect to discovered device
    async connect(version) {
        if (!this.device) {
            throw new Error('No device to connect to');
        }

        this.version = version;
        const config = version === 'v2' ? COYOTE_V2 : COYOTE_V3;

        this.updateStatus('connecting');

        try {
            this.server = await this.device.gatt.connect();
            this.service = await this.server.getPrimaryService(config.SERVICE_UUID);

            if (version === 'v2') {
                this.charIntensity = await this.service.getCharacteristic(config.CHAR_INTENSITY);
                this.charWaveA = await this.service.getCharacteristic(config.CHAR_WAVE_A);
                this.charWaveB = await this.service.getCharacteristic(config.CHAR_WAVE_B);
            } else {
                this.charWrite = await this.service.getCharacteristic(config.CHAR_WRITE);

                // Send BF initialization command
                const bfCmd = this.v3Protocol.encodeBFCommand(
                    this.settings.maxIntensityA * 2,  // Scale 0-100 to 0-200
                    this.settings.maxIntensityB * 2,
                    160, 160,  // Frequency balance (XToys defaults)
                    0, 0       // Intensity balance
                );
                await this.charWrite.writeValue(bfCmd);
            }

            this.connected = true;
            this.updateStatus('connected');

            // Start soft ramp if enabled
            if (this.settings.softRampEnabled) {
                this.startSoftRamp();
            }

            // Start send loop
            this.startSendLoop();

        } catch (e) {
            this.handleDisconnect();
            throw e;
        }
    }

    // Disconnect from device
    async disconnect() {
        // Send zero intensity before disconnecting
        if (this.connected) {
            try {
                await this.sendZero();
            } catch (e) {
                console.warn('Failed to send zero on disconnect:', e);
            }
        }

        this.stopSendLoop();

        if (this.server && this.server.connected) {
            this.server.disconnect();
        }

        this.handleDisconnect();
    }

    // Handle disconnection
    handleDisconnect() {
        this.connected = false;
        this.device = null;
        this.server = null;
        this.service = null;
        this.charIntensity = null;
        this.charWaveA = null;
        this.charWaveB = null;
        this.charWrite = null;
        this.ramping = false;
        this.currentIntensityA = 0;
        this.currentIntensityB = 0;
        this.stopSendLoop();
        this.updateStatus('disconnected');
    }

    // Emergency stop - immediately zero intensity and stay zeroed
    async emergencyStop() {
        this.eStopped = true;
        this.ramping = false;
        this.currentIntensityA = 0;
        this.currentIntensityB = 0;

        if (this.connected) {
            try {
                await this.sendZero();
            } catch (e) {
                console.error('Emergency stop failed:', e);
            }
        }
    }

    // Clear e-stop state and start soft ramp
    clearEmergencyStop() {
        this.eStopped = false;
        this.startSoftRamp();
    }

    // Re-send BF command to update V3 device intensity limits
    async updateV3Limits() {
        if (!this.connected || this.version !== 'v3' || !this.charWrite) return;
        const bfCmd = this.v3Protocol.encodeBFCommand(
            this.settings.maxIntensityA * 2,
            this.settings.maxIntensityB * 2,
            160, 160, 0, 0
        );
        await this.charWrite.writeValue(bfCmd);
    }

    // Send zero intensity
    async sendZero() {
        if (this.version === 'v2') {
            await this.sendV2Commands(0, 0, 50, 50);
        } else {
            await this.sendV3Command(0, 0, 50, 50);
        }
    }

    // Start soft ramp
    startSoftRamp() {
        this.eStopped = false;  // Clear e-stop when starting ramp
        this.ramping = true;
        this.rampStartTime = Date.now();
        this.rampDuration = this.settings.softRampDuration;
        this.currentIntensityA = 0;
        this.currentIntensityB = 0;
    }

    // Start the send loop
    startSendLoop() {
        if (this.sendInterval) {
            clearInterval(this.sendInterval);
        }
        this.sendInterval = setInterval(() => this.sendLoop(), 100);
    }

    // Stop the send loop
    stopSendLoop() {
        if (this.sendInterval) {
            clearInterval(this.sendInterval);
            this.sendInterval = null;
        }
    }

    // Main send loop - runs every 100ms
    sendLoop() {
        if (!this.connected) return;

        // If e-stopped, just keep sending zero
        if (this.eStopped) {
            this.sendZero();
            return;
        }

        // Get effective amplitude with all AM modulations (from VU meter pattern)
        let leftAmp = 0;
        let rightAmp = 0;
        let leftFreq = 200;
        let rightFreq = 200;

        // Check if oscillators exist and are started
        if (typeof leftOsc !== 'undefined' && leftOsc.started) {
            const amplL = typeof wavLa !== 'undefined' ? wavLa.waveform()[0] : 0;
            const amplL2 = typeof wavLa2 !== 'undefined' ? wavLa2.waveform()[0] : 0;
            leftAmp = Math.min(Math.abs(leftOsc.getAmp() + amplL + amplL2), 1);

            const freqL = typeof wavLf !== 'undefined' ? wavLf.waveform('float')[0] : 0;
            leftFreq = leftOsc.getFreq() + freqL;
        }

        if (typeof rightOsc !== 'undefined' && rightOsc.started) {
            const amplR = typeof wavRa !== 'undefined' ? wavRa.waveform()[0] : 0;
            const amplR2 = typeof wavRa2 !== 'undefined' ? wavRa2.waveform()[0] : 0;
            rightAmp = Math.min(Math.abs(rightOsc.getAmp() + amplR + amplR2), 1);

            const freqR = typeof wavRf !== 'undefined' ? wavRf.waveform('float')[0] : 0;
            rightFreq = rightOsc.getFreq() + freqR;
        }

        // Map to device parameters
        const deviceMax = this.version === 'v2' ? COYOTE_V2.MAX_INTENSITY : COYOTE_V3.MAX_INTENSITY;

        let targetA = mapAmplitudeToIntensity(leftAmp, this.settings.maxIntensityA, deviceMax);
        let targetB = mapAmplitudeToIntensity(rightAmp, this.settings.maxIntensityB, deviceMax);

        // Calculate frequency bands based on mapping mode
        let bandLowA, bandHighA, bandLowB, bandHighB;

        if (this.settings.freqMappingMode === 'centered') {
            // Centered mode: band follows each channel's base frequency
            const halfWidth = this.settings.freqCenterWidth / 2;
            const baseFreqL = typeof leftOsc !== 'undefined' && leftOsc.started ? leftOsc.getFreq() : 200;
            const baseFreqR = typeof rightOsc !== 'undefined' && rightOsc.started ? rightOsc.getFreq() : 200;

            bandLowA = Math.max(10, baseFreqL - halfWidth);
            bandHighA = baseFreqL + halfWidth;
            bandLowB = Math.max(10, baseFreqR - halfWidth);
            bandHighB = baseFreqR + halfWidth;
        } else {
            // Fixed mode: use static frequency band
            bandLowA = bandLowB = this.settings.freqBandLow;
            bandHighA = bandHighB = this.settings.freqBandHigh;
        }

        const periodA = mapFrequencyToPeriod(leftFreq, bandLowA, bandHighA);
        const periodB = mapFrequencyToPeriod(rightFreq, bandLowB, bandHighB);

        // Apply soft ramp if active
        if (this.ramping) {
            const elapsed = Date.now() - this.rampStartTime;
            if (elapsed >= this.rampDuration) {
                this.ramping = false;
            } else {
                const rampFactor = elapsed / this.rampDuration;
                targetA = Math.round(targetA * rampFactor);
                targetB = Math.round(targetB * rampFactor);
            }
        }

        // Smooth transitions: instant decrease, gradual increase
        if (targetA < this.currentIntensityA) {
            this.currentIntensityA = targetA;
        } else {
            // Gradual increase (about 20% of remaining distance per 100ms)
            this.currentIntensityA += Math.ceil((targetA - this.currentIntensityA) * 0.2);
        }

        if (targetB < this.currentIntensityB) {
            this.currentIntensityB = targetB;
        } else {
            this.currentIntensityB += Math.ceil((targetB - this.currentIntensityB) * 0.2);
        }

        // Send to device
        try {
            if (this.version === 'v2') {
                this.sendV2Commands(this.currentIntensityA, this.currentIntensityB, periodA, periodB);
            } else {
                this.sendV3Command(this.currentIntensityA, this.currentIntensityB, periodA, periodB);
            }
        } catch (e) {
            console.error('Coyote send error:', e);
            if (this.onError) this.onError(e);
        }
    }

    // Send V2 commands
    async sendV2Commands(intensityA, intensityB, periodA, periodB) {
        if (!this.charIntensity || !this.charWaveA || !this.charWaveB) return;

        const intensityBytes = this.v2Protocol.encodeIntensity(intensityA, intensityB);
        const waveABytes = this.v2Protocol.getWaveformBytes(periodA);
        const waveBBytes = this.v2Protocol.getWaveformBytes(periodB);

        // Write all three characteristics
        // Note: Writing in parallel can cause issues, so we sequence them
        await this.charIntensity.writeValueWithoutResponse(intensityBytes);
        await this.charWaveA.writeValueWithoutResponse(waveABytes);
        await this.charWaveB.writeValueWithoutResponse(waveBBytes);
    }

    // Send V3 command
    async sendV3Command(intensityA, intensityB, periodA, periodB) {
        if (!this.charWrite) return;

        const cmd = this.v3Protocol.encodeSimpleB0(intensityA, intensityB, periodA, periodB);
        await this.charWrite.writeValueWithoutResponse(cmd);
    }

    // Update status and notify callback
    updateStatus(status) {
        if (this.onStatusChange) {
            this.onStatusChange(status, this.device ? this.device.name : null);
        }
    }

    // Get current state for UI display
    getState() {
        return {
            connected: this.connected,
            version: this.version,
            deviceName: this.device ? this.device.name : null,
            intensityA: this.currentIntensityA,
            intensityB: this.currentIntensityB,
            maxA: this.version === 'v2' ? COYOTE_V2.MAX_INTENSITY : COYOTE_V3.MAX_INTENSITY,
            ramping: this.ramping
        };
    }
}

// Global instance
if (typeof window !== 'undefined') {
    window.CoyoteDevice = CoyoteDevice;
    window.coyoteDevice = new CoyoteDevice();
}
