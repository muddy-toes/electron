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

        // Frequency band
        const freqLow = document.getElementById('coyote-freq-low');
        const freqHigh = document.getElementById('coyote-freq-high');
        if (freqLow) freqLow.value = settings.freqBandLow;
        if (freqHigh) freqHigh.value = settings.freqBandHigh;

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

        // Update display
        if (setting === 'maxIntensityA') {
            document.getElementById('coyote-max-a-display').textContent = value + '%';
        } else if (setting === 'maxIntensityB') {
            document.getElementById('coyote-max-b-display').textContent = value + '%';
        }
    };
})();
