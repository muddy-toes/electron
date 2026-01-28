// Coyote V2/V3 Protocol Implementation
// Based on DG-LAB-OPENSOURCE documentation

// V2 Device Constants
const COYOTE_V2 = {
    NAME_PREFIX: 'D-LAB',
    SERVICE_UUID: '955a180b-0fe2-f5aa-a094-84b8d4f3e8ad',
    CHAR_INTENSITY: '955a1504-0fe2-f5aa-a094-84b8d4f3e8ad',  // PWM_AB2
    CHAR_WAVE_A: '955a1506-0fe2-f5aa-a094-84b8d4f3e8ad',     // PWM_A34 (note: docs have A/B swapped)
    CHAR_WAVE_B: '955a1505-0fe2-f5aa-a094-84b8d4f3e8ad',     // PWM_B34
    MAX_INTENSITY: 2047,
    SEND_INTERVAL: 100
};

// V3 Device Constants
const COYOTE_V3 = {
    NAME_PREFIX: '47',
    SERVICE_UUID: '0000180c-0000-1000-8000-00805f9b34fb',
    CHAR_WRITE: '0000150a-0000-1000-8000-00805f9b34fb',
    CHAR_NOTIFY: '0000150b-0000-1000-8000-00805f9b34fb',
    MAX_INTENSITY: 200,
    SEND_INTERVAL: 100
};

// V2 Protocol Encoding
class CoyoteV2Protocol {
    // Encode intensity for both channels into 3 bytes
    // Bits: [unused:2][Channel_A:11][Channel_B:11]
    // Little-endian transmission
    encodeIntensity(intensityA, intensityB) {
        const a = Math.round(Math.min(Math.max(intensityA, 0), COYOTE_V2.MAX_INTENSITY));
        const b = Math.round(Math.min(Math.max(intensityB, 0), COYOTE_V2.MAX_INTENSITY));

        // Pack into 24 bits: unused(2) + A(11) + B(11)
        const value = (a << 11) | b;

        // Little-endian: LSB first
        const bytes = new Uint8Array(3);
        bytes[0] = value & 0xFF;
        bytes[1] = (value >> 8) & 0xFF;
        bytes[2] = (value >> 16) & 0xFF;
        return bytes;
    }

    // Encode waveform parameters into 3 bytes
    // Bits: [unused:4][Z:5][Y:10][X:5]
    // X: consecutive pulses (0-31), Y: interval after X pulses (0-1023), Z: pulse width (0-31, * 5us)
    encodeWaveform(x, y, z) {
        const xVal = Math.round(Math.min(Math.max(x, 0), 31));
        const yVal = Math.round(Math.min(Math.max(y, 0), 1023));
        const zVal = Math.round(Math.min(Math.max(z, 0), 31));

        // Pack: unused(4) + Z(5) + Y(10) + X(5) = 24 bits
        const value = (zVal << 15) | (yVal << 5) | xVal;

        const bytes = new Uint8Array(3);
        bytes[0] = value & 0xFF;
        bytes[1] = (value >> 8) & 0xFF;
        bytes[2] = (value >> 16) & 0xFF;
        return bytes;
    }

    // Convert period (ms) to X, Y values
    // Formula: X = 15 * sqrt(period/1000), Y = period - X
    periodToXY(periodMs) {
        const period = Math.min(Math.max(periodMs, 10), 1000);
        const x = Math.round(15 * Math.sqrt(period / 1000));
        const y = Math.round(period - x);
        return { x: Math.min(x, 31), y: Math.min(y, 1023) };
    }

    // Get waveform bytes for a given period
    // Z = 20 gives 100us pulse width (default, good feeling)
    getWaveformBytes(periodMs, z = 20) {
        const { x, y } = this.periodToXY(periodMs);
        return this.encodeWaveform(x, y, z);
    }
}

// V3 Protocol Encoding
class CoyoteV3Protocol {
    constructor() {
        this.sequence = 0;
    }

    // Encode BF initialization command (7 bytes)
    // Sets soft limits and balance parameters
    encodeBFCommand(aLimit = 200, bLimit = 200, freqBalA = 160, freqBalB = 160, intBalA = 0, intBalB = 0) {
        const bytes = new Uint8Array(7);
        bytes[0] = 0xBF;
        bytes[1] = Math.min(Math.max(aLimit, 0), 200);
        bytes[2] = Math.min(Math.max(bLimit, 0), 200);
        bytes[3] = Math.min(Math.max(freqBalA, 0), 255);
        bytes[4] = Math.min(Math.max(freqBalB, 0), 255);
        bytes[5] = Math.min(Math.max(intBalA, 0), 255);
        bytes[6] = Math.min(Math.max(intBalB, 0), 255);
        return bytes;
    }

    // Encode B0 command (20 bytes)
    // intensityMode: 0b00=no change, 0b01=increase, 0b10=decrease, 0b11=absolute
    encodeB0Command(intensityA, intensityB, freqsA, waveIntA, freqsB, waveIntB, useAbsolute = true) {
        const bytes = new Uint8Array(20);

        // Byte 0: Header
        bytes[0] = 0xB0;

        // Byte 1: sequence (4 bits) + intensity mode (4 bits)
        // For simplicity, we always use absolute mode (0b11 for both channels)
        // and don't need responses, so sequence = 0
        const intensityMode = useAbsolute ? 0b1111 : 0b0000;
        bytes[1] = ((this.sequence & 0x0F) << 4) | intensityMode;

        // Bytes 2-3: Channel intensities (0-200)
        bytes[2] = Math.round(Math.min(Math.max(intensityA, 0), 200));
        bytes[3] = Math.round(Math.min(Math.max(intensityB, 0), 200));

        // Bytes 4-7: A channel frequencies (4 x 25ms segments)
        for (let i = 0; i < 4; i++) {
            bytes[4 + i] = this.encodeFrequency(freqsA[i] || freqsA[0] || 10);
        }

        // Bytes 8-11: A channel waveform intensities (4 segments, 0-100)
        for (let i = 0; i < 4; i++) {
            bytes[8 + i] = Math.round(Math.min(Math.max(waveIntA[i] !== undefined ? waveIntA[i] : 100, 0), 100));
        }

        // Bytes 12-15: B channel frequencies
        for (let i = 0; i < 4; i++) {
            bytes[12 + i] = this.encodeFrequency(freqsB[i] || freqsB[0] || 10);
        }

        // Bytes 16-19: B channel waveform intensities
        for (let i = 0; i < 4; i++) {
            bytes[16 + i] = Math.round(Math.min(Math.max(waveIntB[i] !== undefined ? waveIntB[i] : 100, 0), 100));
        }

        return bytes;
    }

    // Convert period (10-1000ms) to V3 frequency value (10-240)
    encodeFrequency(periodMs) {
        const period = Math.round(Math.min(Math.max(periodMs, 10), 1000));

        if (period <= 100) {
            return period;
        } else if (period <= 600) {
            return Math.round((period - 100) / 5 + 100);
        } else {
            return Math.round((period - 600) / 10 + 200);
        }
    }

    // Simple B0 command with same values for all 4 segments
    encodeSimpleB0(intensityA, intensityB, periodA, periodB, waveIntensity = 100) {
        const freqA = Array(4).fill(periodA);
        const freqB = Array(4).fill(periodB);
        const waveA = Array(4).fill(waveIntensity);
        const waveB = Array(4).fill(waveIntensity);
        return this.encodeB0Command(intensityA, intensityB, freqA, waveA, freqB, waveB);
    }

    // Increment sequence number (wraps 0-15)
    nextSequence() {
        this.sequence = (this.sequence + 1) & 0x0F;
        return this.sequence;
    }
}

// Mapping Functions

// Map audio amplitude (0-1) to device intensity
// maxPercent: user-configured max intensity (0-100)
// deviceMax: 2047 for V2, 200 for V3
function mapAmplitudeToIntensity(amplitude, maxPercent, deviceMax) {
    const clamped = Math.min(Math.max(amplitude, 0), 1);
    const max = Math.min(Math.max(maxPercent, 0), 100);
    return Math.round(clamped * (max / 100) * deviceMax);
}

// Map audio frequency to Coyote period (inverted: higher freq -> lower period -> faster pulses)
// bandLow, bandHigh: audio frequency range to map (e.g., 200-800 Hz)
// periodMin, periodMax: Coyote period range (10-100 ms)
function mapFrequencyToPeriod(audioFreq, bandLow = 200, bandHigh = 800, periodMin = 10, periodMax = 100) {
    const clamped = Math.min(Math.max(audioFreq, bandLow), bandHigh);
    const normalized = (clamped - bandLow) / (bandHigh - bandLow);
    // Inverted: higher audio freq -> lower period
    return periodMax - (normalized * (periodMax - periodMin));
}

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.COYOTE_V2 = COYOTE_V2;
    window.COYOTE_V3 = COYOTE_V3;
    window.CoyoteV2Protocol = CoyoteV2Protocol;
    window.CoyoteV3Protocol = CoyoteV3Protocol;
    window.mapAmplitudeToIntensity = mapAmplitudeToIntensity;
    window.mapFrequencyToPeriod = mapFrequencyToPeriod;
}
