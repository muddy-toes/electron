// Coyote UI Management
// Handles UI bindings and updates for Coyote panel

(function() {
    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initCoyoteUI);
    } else {
        initCoyoteUI();
    }

    function initCoyoteUI() {
        // Check if feature is enabled (feature_coyote is set by server-side template)
        if (typeof feature_coyote === 'undefined' || !feature_coyote) {
            return;
        }

        const panel = document.getElementById('coyote-panel');
        if (!panel) return;

        // Panel stays hidden until user clicks "Enable Coyote BT" button
        // Just set up callbacks and settings, don't show panel yet

        // Load saved settings into UI
        loadSettingsToUI();

        // Set up device callbacks
        if (window.coyoteDevice) {
            window.coyoteDevice.onStatusChange = updateStatusUI;
            window.coyoteDevice.onError = handleError;
        }

        // Start live value update loop
        setInterval(updateLiveValues, 200);
    }

    // Enable Coyote BT - called from button click
    window.enableCoyoteBT = function() {
        const panel = document.getElementById('coyote-panel');
        const button = document.getElementById('coyote-toggler');

        if (!panel) return;

        // Hide the enable button (can't turn it off)
        if (button) {
            button.style.display = 'none';
        }

        // Check browser support
        if (!CoyoteDevice.isSupported()) {
            panel.classList.remove('hidden');
            document.getElementById('coyote-browser-warning').style.display = 'block';
            document.getElementById('coyote-scan-buttons').style.display = 'none';
            document.querySelector('#coyote-panel .coyote-settings').style.display = 'none';
            return;
        }

        // Show panel
        panel.classList.remove('hidden');

        // Restore panel collapse state
        const settings = window.coyoteDevice ? window.coyoteDevice.settings : {};
        if (!settings.panelCollapsed) {
            expandPanel();
        }
    };

    function loadSettingsToUI() {
        if (!window.coyoteDevice) return;

        const settings = window.coyoteDevice.settings;

        // Max intensity sliders
        const sliderA = document.getElementById('coyote-max-a-slider');
        const sliderB = document.getElementById('coyote-max-b-slider');
        if (sliderA) {
            sliderA.value = settings.maxIntensityA;
            document.getElementById('coyote-max-a-display').textContent = settings.maxIntensityA + '%';
        }
        if (sliderB) {
            sliderB.value = settings.maxIntensityB;
            document.getElementById('coyote-max-b-display').textContent = settings.maxIntensityB + '%';
        }

        // Frequency band (fixed mode)
        const freqLow = document.getElementById('coyote-freq-low');
        const freqHigh = document.getElementById('coyote-freq-high');
        if (freqLow) freqLow.value = settings.freqBandLow;
        if (freqHigh) freqHigh.value = settings.freqBandHigh;

        // Frequency width (centered mode)
        const freqWidth = document.getElementById('coyote-freq-width');
        if (freqWidth) freqWidth.value = settings.freqCenterWidth;

        // Set active frequency mapping mode
        updateFreqMappingModeUI(settings.freqMappingMode || 'fixed');

        // Soft ramp checkbox
        const softRamp = document.getElementById('coyote-soft-ramp');
        if (softRamp) softRamp.checked = settings.softRampEnabled;
    }

    function updateStatusUI(status, deviceName) {
        const statusText = document.getElementById('coyote-status-text');
        const scanButtons = document.getElementById('coyote-scan-buttons');
        const disconnectButtons = document.getElementById('coyote-disconnect-buttons');
        const liveValues = document.getElementById('coyote-live-values');

        if (!statusText) return;

        // Remove old status classes
        statusText.classList.remove('connected', 'disconnected', 'scanning', 'connecting');
        statusText.classList.add(status);

        switch (status) {
            case 'disconnected':
                statusText.textContent = 'Status: Disconnected';
                scanButtons.style.display = 'flex';
                disconnectButtons.style.display = 'none';
                liveValues.style.display = 'none';
                enableScanButtons(true);
                updateResumeButton();
                // Reset intensity sliders to zero for safety
                var sliderA = document.getElementById('coyote-max-a-slider');
                var sliderB = document.getElementById('coyote-max-b-slider');
                if (sliderA) sliderA.value = 0;
                if (sliderB) sliderB.value = 0;
                document.getElementById('coyote-max-a-display').textContent = '0%';
                document.getElementById('coyote-max-b-display').textContent = '0%';
                break;
            case 'scanning':
                statusText.textContent = 'Status: Scanning...';
                enableScanButtons(false);
                break;
            case 'connecting':
                statusText.textContent = 'Status: Connecting...';
                break;
            case 'connected':
                statusText.textContent = 'Status: Connected to ' + (deviceName || 'device');
                scanButtons.style.display = 'none';
                disconnectButtons.style.display = 'flex';
                liveValues.style.display = 'block';
                updateMaxDisplay();
                break;
        }
    }

    function updateMaxDisplay() {
        if (!window.coyoteDevice) return;
        const state = window.coyoteDevice.getState();
        document.getElementById('coyote-max-a').textContent = state.maxA;
        document.getElementById('coyote-max-b').textContent = state.maxA;
    }

    function updateLiveValues() {
        if (!window.coyoteDevice || !window.coyoteDevice.connected) return;

        const state = window.coyoteDevice.getState();
        document.getElementById('coyote-val-a').textContent = state.intensityA;
        document.getElementById('coyote-val-b').textContent = state.intensityB;
    }

    function enableScanButtons(enabled) {
        const buttons = document.querySelectorAll('.coyote-scan-btn');
        buttons.forEach(btn => {
            btn.disabled = !enabled;
        });
    }

    function handleError(error) {
        console.error('Coyote error:', error);
        // Could add toast notification here
    }

    function expandPanel() {
        const content = document.querySelector('#coyote-panel .coyote-content');
        const icon = document.querySelector('#coyote-panel .toggle-icon');
        if (content) {
            content.classList.add('expanded');
        }
        if (icon) {
            icon.classList.add('expanded');
        }
    }

    function collapsePanel() {
        const content = document.querySelector('#coyote-panel .coyote-content');
        const icon = document.querySelector('#coyote-panel .toggle-icon');
        if (content) {
            content.classList.remove('expanded');
        }
        if (icon) {
            icon.classList.remove('expanded');
        }
    }

    // Global functions for onclick handlers
    window.toggleCoyotePanel = function() {
        const content = document.querySelector('#coyote-panel .coyote-content');
        if (!content) return;

        const isExpanded = content.classList.contains('expanded');
        if (isExpanded) {
            collapsePanel();
        } else {
            expandPanel();
        }

        // Save state
        if (window.coyoteDevice) {
            window.coyoteDevice.settings.panelCollapsed = !isExpanded;
            window.coyoteDevice.saveSettings();
        }
    };

    window.coyoteScan = async function(version) {
        if (!window.coyoteDevice) return;

        try {
            if (version === 'v2') {
                await window.coyoteDevice.scanV2();
            } else {
                await window.coyoteDevice.scanV3();
            }
        } catch (e) {
            console.error('Scan failed:', e);
            updateStatusUI('disconnected', null);
            if (e.message !== 'No device selected') {
                alert('Connection failed: ' + e.message);
            }
        }
    };

    window.coyoteDisconnect = async function() {
        if (!window.coyoteDevice) return;

        try {
            await window.coyoteDevice.disconnect();
        } catch (e) {
            console.error('Disconnect failed:', e);
        }
    };

    window.coyoteEmergencyStop = async function() {
        if (!window.coyoteDevice) return;

        try {
            await window.coyoteDevice.emergencyStop();
            updateResumeButton();
        } catch (e) {
            console.error('Emergency stop failed:', e);
        }
    };

    window.coyoteResume = function() {
        if (!window.coyoteDevice) return;

        window.coyoteDevice.clearEmergencyStop();
        updateResumeButton();
    };

    function updateResumeButton() {
        const resumeBtn = document.getElementById('coyote-resume-btn');
        if (!resumeBtn) return;

        if (window.coyoteDevice && window.coyoteDevice.connected && window.coyoteDevice.eStopped) {
            resumeBtn.style.display = 'inline-block';
        } else {
            resumeBtn.style.display = 'none';
        }
    }

    window.updateCoyoteSetting = function(setting, value) {
        if (!window.coyoteDevice) return;

        // Parse value appropriately
        if (setting === 'softRampEnabled') {
            window.coyoteDevice.settings[setting] = !!value;
        } else {
            window.coyoteDevice.settings[setting] = parseInt(value, 10);
        }

        window.coyoteDevice.saveSettings();

        // Push updated limits to V3 device
        if (setting === 'maxIntensityA' || setting === 'maxIntensityB') {
            window.coyoteDevice.updateV3Limits();
        }

        // Update display
        if (setting === 'maxIntensityA') {
            document.getElementById('coyote-max-a-display').textContent = value + '%';
        } else if (setting === 'maxIntensityB') {
            document.getElementById('coyote-max-b-display').textContent = value + '%';
        }
    };

    // Keyboard shortcuts for max intensity adjustment
    // V/B = Channel A down/up, N/M = Channel B down/up
    document.addEventListener('keydown', function(e) {
        // Skip if Coyote feature not enabled or panel not visible
        if (typeof feature_coyote === 'undefined' || !feature_coyote) return;
        const panel = document.getElementById('coyote-panel');
        if (!panel || panel.classList.contains('hidden')) return;

        const content = document.querySelector('#coyote-panel .coyote-content');
        if (!content) return;

        const isExpanded = content.classList.contains('expanded');
        if (!isExpanded) return;

        // Skip if focus is in an input/textarea/select
        const tag = document.activeElement.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

        if (!window.coyoteDevice) return;

        const key = e.key.toLowerCase();
        let setting = null;
        let delta = 0;

        switch (key) {
            case 'v': setting = 'maxIntensityA'; delta = -1; break;
            case 'b': setting = 'maxIntensityA'; delta = 1; break;
            case 'n': setting = 'maxIntensityB'; delta = -1; break;
            case 'm': setting = 'maxIntensityB'; delta = 1; break;
            default: return;
        }

        e.preventDefault();

        const current = window.coyoteDevice.settings[setting];
        const newVal = Math.max(0, Math.min(100, current + delta));
        window.updateCoyoteSetting(setting, newVal);

        // Also update the slider to match
        const sliderId = setting === 'maxIntensityA' ? 'coyote-max-a-slider' : 'coyote-max-b-slider';
        const slider = document.getElementById(sliderId);
        if (slider) slider.value = newVal;
    });

    // Frequency mapping mode toggle
    window.setFreqMappingMode = function(mode) {
        if (!window.coyoteDevice) return;

        window.coyoteDevice.settings.freqMappingMode = mode;
        window.coyoteDevice.saveSettings();
        updateFreqMappingModeUI(mode);
    };

    function updateFreqMappingModeUI(mode) {
        const fixedOption = document.getElementById('coyote-freq-fixed-option');
        const centeredOption = document.getElementById('coyote-freq-centered-option');
        const fixedCheck = document.getElementById('coyote-freq-fixed-check');
        const centeredCheck = document.getElementById('coyote-freq-centered-check');

        if (!fixedOption || !centeredOption) return;

        if (mode === 'centered') {
            fixedOption.classList.remove('active');
            fixedOption.classList.add('inactive');
            centeredOption.classList.add('active');
            centeredOption.classList.remove('inactive');
            if (fixedCheck) fixedCheck.checked = false;
            if (centeredCheck) centeredCheck.checked = true;
        } else {
            fixedOption.classList.add('active');
            fixedOption.classList.remove('inactive');
            centeredOption.classList.remove('active');
            centeredOption.classList.add('inactive');
            if (fixedCheck) fixedCheck.checked = true;
            if (centeredCheck) centeredCheck.checked = false;
        }
    }

    // Help tooltip toggle
    document.addEventListener('click', function(e) {
        const helpIcon = document.getElementById('coyote-freq-help');
        const helpTooltip = document.getElementById('coyote-freq-help-tooltip');

        if (!helpIcon || !helpTooltip) return;

        if (e.target === helpIcon) {
            helpTooltip.classList.toggle('visible');
        } else if (!helpTooltip.contains(e.target)) {
            helpTooltip.classList.remove('visible');
        }
    });
})();
