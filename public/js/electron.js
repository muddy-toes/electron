// code that handles most of the UI and also takes care of creating the
// waveforms according to the parameters selected by the user
$(document).ready(function () {

    let currentPainToolChannel;
    let painInProgress;
    const tAtt = { left: 0.1, right: 0.1 };
    const tOn = { left: 0.1, right: 0.1 };
    const tOff = { left: 0.0, right: 0.0 };
    const onOffTimeouts = { left: null, right: null };
    const onOffPhase = { left: 'on', right: 'on' };

    // init all the different UI elements
    initSpinners();
    initSliders();
    initStopButtons();
    $('select.selectmenu').selectmenu();

    loadPromode();

    // register UI events
    addListenerToApply('left', leftOsc, modL, fModL, modL2);
    addListenerToApply('right', rightOsc, modR, fModR, modR2);

    initPainTool('left');
    initPainTool('right');

    $('#clear-steps-help').on('click', function() {
        const dialog = $('#clear-steps-help-dialog').dialog({
            autoOpen: true,
            width: 600,
            modal: true,
            buttons: {
                Close: function () {
                    dialog.dialog('close');
                }
            }
        });
    });

    function addListenerToApply(channelName, osc, ampModulator, freqModulator, ampModulator2) {
        const $channelCol = $(`#${channelName}-channel-column`);

        $channelCol.find('.apply-btn').click(function () {
            applyChanges(channelName, osc, ampModulator, freqModulator, ampModulator2);
            // send event to communication module can capture it
            $(window).trigger('applied-' + channelName);
        });

        $('body').on('keyup', function(e) {
            if (e.keyCode === 27)
                $channelCol.find(' .stop-btn').click();
            else if (e.keyCode === 13)
                $channelCol.find(' .apply-btn').click();
        });
    }

    function applyChanges(channelName, osc, ampModulator, freqModulator, ampModulator2) {
        const $channelCol = $(`#${channelName}-channel-column`);

        // NOTE: If you change any of these ranges, also change it in in the socket.on in public/js/communication.js
        validateRange($channelCol.find('input[name="frequency"]'), 10, 3000);
        validateRange($channelCol.find('input[name="volume"]'), 0, 100);
        validateRange($channelCol.find('input[name="am-depth"]'), 0, 100);
        validateRange($channelCol.find('input[name="am-frequency"]'), 0, 100);
        validateRange($channelCol.find('input[name="am2-depth"]'), 0, 100);
        validateRange($channelCol.find('input[name="am2-frequency"]'), 0, 100);
        validateRange($channelCol.find('input[name="fm-depth"]'), 0, 1000);
        validateRange($channelCol.find('input[name="fm-frequency"]'), 0, 100);
        validateRange($channelCol.find('input[name="ramp-rate"]'), 0, 10);
        validateRange($channelCol.find('input[name="ramp-target"]'), 0, 100);
        validateRange($channelCol.find('input[name="freq-ramp-rate"]'), -40, 40);
        validateRange($channelCol.find('input[name="toff"]'), 0, 60);
        validateRange($channelCol.find('input[name="ton"]'), 0, 60);
        tOn[channelName] = parseFloat($channelCol.find('input[name=ton]').val());
        validateRange($channelCol.find('input[name="tatt"]'), 0, tOn[channelName]);

        tAtt[channelName] = parseFloat($channelCol.find('input[name=tatt]').val());
        tOff[channelName] = parseFloat($channelCol.find('input[name=toff]').val());

        const frequency = parseFloat($channelCol.find('input[name="frequency"]').val());
        const volume = 0.01 * parseFloat($channelCol.find('input[name="volume"]').val());

        const amDepth = 0.01 * parseFloat($channelCol.find('input[name="am-depth"]').val());
        const amFrequency = parseFloat($channelCol.find('input[name="am-frequency"]').val());
        const amType = $channelCol.find('select[name="am-type"]').val();
        const amDepth2 = 0.01 * parseFloat($channelCol.find('input[name="am2-depth"]').val());
        const amFrequency2 = parseFloat($channelCol.find('input[name="am2-frequency"]').val());
        const amType2 = $channelCol.find('select[name="am2-type"]').val();

        const fmDepth = parseFloat($channelCol.find('input[name="fm-depth"]').val());
        const fmFrequency = parseFloat($channelCol.find('input[name="fm-frequency"]').val());
        const fmType = $channelCol.find('select[name="fm-type"]').val();

        rampInfo[channelName].rate = parseFloat($channelCol.find('input[name="ramp-rate"]').val());
        rampInfo[channelName].target = parseFloat($channelCol.find('input[name="ramp-target"]').val());

        freqRampInfo[channelName].rate = parseFloat($channelCol.find('input[name="freq-ramp-rate"]').val());

        // handle A.M.
        if (amFrequency > 0 && amDepth > 0 && amType != 'none') {
            // A.M. is on
            ampModulator.freq(amFrequency);
            ampModulator.amp(amDepth);
            ampModulator.setType(amType);
            // ampModulator.phase(0); // This does not appear to reset the phase, possibly a bug in p5.Oscillator.
            // Restart the oscillator. Will stop the oscillator first if already started.
            // This restart allows the driver to reset the phase by clicking Apply, even if no changes were made.
            // If Apply button is eventually removed, it would still be nice to have phase reset button(s) for amplitude and frequency modulators.
            ampModulator.start();
            osc.amp(volume, 0.5);
            osc.amp(ampModulator);
        } else {
            // A.M. is off
            osc.amp(volume, 0.5);
            ampModulator.amp(0);
        }

        // second A.M.
        if (amFrequency2 > 0 && amDepth2 > 0 && amType2 != 'none') {
            // A.M. is on
            ampModulator2.freq(amFrequency2);
            ampModulator2.amp(amDepth2);
            ampModulator2.setType(amType2);
            // ampModulator.phase(0); // This does not appear to reset the phase, possibly a bug in p5.Oscillator.
            // Restart the oscillator. Will stop the oscillator first if already started.
            // This restart allows the driver to reset the phase by clicking Apply, even if no changes were made.
            // If Apply button is eventually removed, it would still be nice to have phase reset button(s) for amplitude and frequency modulators.
            ampModulator2.start();
            osc.amp(volume, 0.5);
            osc.amp(ampModulator2);
        } else {
            // A.M. is off
            osc.amp(volume, 0.5);
            ampModulator2.amp(0);
        }


        // handle F.M.
        if (fmFrequency > 0 && fmDepth > 0 && fmType != 'none') {
            // F.M. is on
            freqModulator.freq(fmFrequency);
            freqModulator.amp(fmDepth);
            freqModulator.setType(fmType);
            freqModulator.start(); // See comments regarding ampModulator.start() above.
            osc.freq(frequency);
            osc.freq(freqModulator);
        } else {
            // F.M. is off
            osc.freq(frequency);
            freqModulator.amp(0);
        }

        osc.start();
        onOffCycle_On(channelName);
    }

    function onOffCycle_On(ch) {
        onOffPhase[ch] = 'on';
        const $col = $('#' + ch + '-channel-column');
        const osc = ch == 'left' ? leftOsc : rightOsc;
        if (tOn[ch] > 0) {
            const vol_current = parseFloat($col.find('input[name=volume]').val()) / 100;
            osc.amp(vol_current, tAtt[ch]);
        }
        clearTimeout(onOffTimeouts[ch]);
        onOffTimeouts[ch] = setTimeout(function(){ onOffCycle_Off(ch) }, tOn[ch] * 1000);
    }

    function onOffCycle_Off(ch) {
        onOffPhase[ch] = 'off';
        const $col = $('#' + ch + '-channel-column');
        const osc = ch == 'left' ? leftOsc : rightOsc;
        if (tOff[ch] > 0) {
            osc.amp(0, 0.005);  // 5ms fade-out for snappy response
        }
        clearTimeout(onOffTimeouts[ch]);
        onOffTimeouts[ch] = setTimeout(function(){ onOffCycle_On(ch) }, tOff[ch] * 1000);
    }

    function validateRange(field, min, max) {
        const value = parseFloat(field.val());
        if (value < min) {
            field.val(min);
        } else if (value > max) {
            field.val(max);
        }
    }


    function initSpinners() {
        $('.spinner-volume').spinner(electronConfig.dataTypes['volume']);
        $('.spinner-frequency').spinner(electronConfig.dataTypes['frequency']);
        $('.spinner-change-rate').spinner(electronConfig.dataTypes['change-rate']);
        $('.spinner-on-off').spinner(electronConfig.dataTypes['on-off']);

        $('input[name=tatt], input[name=ton]').change(function (e) {
            const $tgt = $(e.currentTarget);
            const $col = $tgt.parents('.channel-column').first();
            if (window.console) console.log("target %o col %o", $tgt, $col);
            const ch = $col.attr('id').match(/left/) ? 'left' : 'right';
            const ton_val = parseFloat($col.find('input[name=ton]').val());
            const $tatt = $col.find('input[name=tatt]');
            let tatt_val = parseFloat($tatt.val());
            if (tatt_val > ton_val) {
                $tatt.val(ton_val);
                tatt_val = ton_val;
            }
        });

        $('.ui-spinner-button').click(function () {
            $(this).siblings('input').change();
        });
    }

    function initSliders() {
        $('.slider-wrapper').each(function () {
            const targetFieldName = $(this).data('target-field');
            const sliderType = $(this).data('slider-type');
            const targetField = $(this).parent().parent().find('input[name="' + targetFieldName + '"]');
            const sliderOptions = jQuery.extend(
                electronConfig.dataTypes[sliderType],
                {
                    value: targetField.val(),
                    slide: function (event, ui) {
                        targetField.val(ui.value);
                    }
                }
            );

            const currentSlider = $(this).slider(sliderOptions);

            targetField.change(function () {
                currentSlider.slider('value', targetField.val());
            });
        });
    }


    function initStopButtons() {
        $('#left-channel-column .stop-btn').click(function () {
            stopChannel('left');
            // send event to communication module can capture it
            $(window).trigger('stopped-left');
        });

        $('#right-channel-column .stop-btn').click(function () {
            stopChannel('right');
            // send event to communication module can capture it
            $(window).trigger('stopped-right');
        });
    }


    function initPainTool(channelName) {
        const dialog = $('#pain-dialog').dialog({
            autoOpen: false,
            width: 600,
            modal: true,
            buttons: {
                'Start Shocks': function () {
                    executePain(currentPainToolChannel, {
                        volume: 0.01 * parseFloat($('input[name="pain-volume"]').val()),
                        frequency: parseFloat($('input[name="pain-frequency"]').val()),
                        timeBetweenShocks: parseFloat($('input[name="pain-time-between"]').val()),
                        shockDuration: parseFloat($('input[name="pain-duration"]').val()),
                        numberOfShocks: parseInt($('input[name="pain-number"]').val())
                    });
                    $(window).trigger('pain-' + currentPainToolChannel);
                    dialog.dialog('close');
                },
                Cancel: function () {
                    dialog.dialog('close');
                }
            }
        });

        $('#' + channelName + '-channel-column .pain-btn').click(function () {
            dialog.dialog('open');
            currentPainToolChannel = channelName;
        });
    }


    // object to store the latest ramp information that was applied
    let rampInfo = {
        left: {
            target: 50,
            rate: 0
        },
        right: {
            target: 50,
            rate: 0
        }
    };

    let freqRampInfo = {
        left: {
            rate: 0
        },
        right: {
            rate: 0
        }
    };

    // monitor volume ramps every 100 ms
    setInterval(function () {
        ['left', 'right'].forEach(function (channelName) {
            const osc = channelName == 'left' ? leftOsc : rightOsc;
            const $channelCol = $(`#${channelName}-channel-column`);

            const rampRate = rampInfo[channelName].rate;
            if (rampRate > 0) {
                const rampTarget = rampInfo[channelName].target;
                let volume = parseFloat($channelCol.find('input[name="volume"]').val());
                if (rampTarget > volume) {
                    volume = volume + rampRate / 10; // 10 times every second
                    volume = Math.min(rampTarget, volume);
                } else {
                    volume = volume - rampRate / 10; // 10 times every second
                    volume = Math.max(rampTarget, volume);
                }

                volume = volume.toFixed(3);
                $channelCol.find('input[name="volume"]').val(volume);
                $channelCol.find('input[name="volume"]').change();

                if (volume == rampTarget) {
                    // ramp finished executing
                    $channelCol.find('input[name="ramp-rate"]').val(0);
                    rampInfo[channelName].rate = 0;
                }

                // Only update oscillator directly if tOn/tOff cycle is disabled
                // When tOn > 0, the cycle manages amplitude (with proper fades) and reads from UI
                if (tOn[channelName] === 0) {
                    osc.amp(volume / 100);
                }
            }

            const freqRampRate = freqRampInfo[channelName].rate;
            if (! isNaN(freqRampRate) && freqRampRate != 0) {
                let freq = parseFloat($channelCol.find('input[name="frequency"]').val());
                freq = freq + freqRampRate;
                freq = Math.min(electronConfig.dataTypes.frequency.max, freq);

                $channelCol.find('input[name="frequency"]').val(freq.toFixed(1));
                $channelCol.find('input[name="frequency"]').change();

                if (! isNaN(freq)) {
                    osc.freq(freq);
                    const fmFrequency = parseFloat($channelCol.find('input[name=fm-frequency]').val());
                    const fmDepth = parseFloat($channelCol.find('input[name=fm-depth]').val());
                    const fmType = $channelCol.find('select[name=fm-type]').val();
                    if (fmFrequency > 0 && fmDepth > 0 && fmType != 'none')
                        osc.freq(freqModulator);
                }
            }

        });
    }, 100);


    // couple of global functions that get executed
    // when clicking buttons or pressing return or escape
    window.applyChanges = function (channelName) {
        if (channelName == 'left') {
            applyChanges('left', leftOsc, modL, fModL, modL2);
        } else if (channelName == 'right') {
            applyChanges('right', rightOsc, modR, fModR, modR2);
        }
    };


    window.stopChannel = function (channelName) {
        if (channelName == 'left') {
            leftOsc.stop();
            clearTimeout(onOffTimeouts['left']);
            rampInfo.left.rate = 0;
            freqRampInfo.left.rate = 0;
        } else if (channelName == 'right') {
            rightOsc.stop();
            clearTimeout(onOffTimeouts['right']);
            rampInfo.right.rate = 0;
            freqRampInfo.right.rate = 0;
        }
    };


    // quick and dirty function that handles the generation of the shocks for
    // the pain tool
    window.executePain = function (channelName, parameters) {
        if (painInProgress) {
            return;
        }

        // Save tOn/tOff state before clearing it
        const savedState = {
            tOnOffActive: onOffTimeouts[channelName] !== null
        };

        let osc;
        if (channelName == 'left') {
            osc = leftOsc;
            rampInfo.left.rate = 0;
        } else if (channelName == 'right') {
            osc = rightOsc;
            rampInfo.right.rate = 0;
        }

        // Clear tOn/tOff timeout to prevent interference during pain
        clearTimeout(onOffTimeouts[channelName]);
        onOffTimeouts[channelName] = null;

        const wasRunning = osc.started;

        osc.amp(0, 0);
        osc.freq(parameters.frequency);
        osc.start();
        painInProgress = true;

        let timer = 0;

        // for each shock we set a timeout increasing the volume to the specified value
        // and then another one setting it to 0, in order to create the sharp shock
        // effect
        for (let i = 0; i < parameters.numberOfShocks; i++) {
            timer += parameters.timeBetweenShocks * 1000;
            setTimeout(() => { osc.amp(parameters.volume, 0); }, timer);
            timer += parameters.shockDuration * 1000;
            if (i == parameters.numberOfShocks - 1) {
                // last shock, let's restore the previous parameters
                setTimeout(() => {
                    painInProgress = false;
                    if (wasRunning) {
                        window.applyChanges(channelName);

                        // Only restore tOn/tOff if it was running before pain
                        if (!savedState.tOnOffActive) {
                            clearTimeout(onOffTimeouts[channelName]);
                            onOffTimeouts[channelName] = null;
                        }
                    } else {
                        osc.stop();
                    }
                }, timer);
            } else {
                setTimeout(() => { osc.amp(0, 0); }, timer);
            }
        }
    };

});
