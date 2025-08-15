// code that handles most of the UI and also takes care of creating the
// waveforms according to the parameters selected by the user
$(document).ready(function () {

    let currentPainToolChannel;
    let painInProgress;
    const tAtt = { left: 0.1, right: 0.1 };
    const tOn = { left: 0.1, right: 0.1 };
    const tOff = { left: 0.0, right: 0.0 };
    const onOffTimeouts = { left: null, right: null };

    const rampAffectsMap = {
        'vol-ramp': {
            target: 'vol-target',
            affects: 'volume',
            apply: function(channelName, newval) { (channelName == 'left' ? leftOsc : rightOsc).amp(newval * 0.01) }
        },
        'freq-ramp': {
            target: 'freq-target',
            affects: 'frequency',
            apply: function(channelName, newval) { (channelName == 'left' ? leftOsc : rightOsc).freq(newval) }
        },
        'am-depth-ramp': {
            target: 'am-depth-target',
            affects: 'am-depth',
            apply: function(channelName, newval) { (channelName == 'left' ? modL : modR).amp(newval * 0.01) }
        },
        'am-frequency-ramp': {
            target: 'am-frequency-target',
            affects: 'am-frequency',
            apply: function(channelName, newval) { (channelName == 'left' ? modL : modR).freq(newval) }
        },
        'am2-depth-ramp': {
            target: 'am2-depth-target',
            affects: 'am2-depth',
            apply: function(channelName, newval) { (channelName == 'left' ? modL2 : modR2).amp(newval * 0.01) }
        },
        'am2-frequency-ramp': {
            target: 'am2-frequency-target',
            affects: 'am2-frequency',
            apply: function(channelName, newval) { (channelName == 'left' ? modL2 : modR2).freq(newval) }
        },
        'fm-depth-ramp': {
            target: 'fm-depth-target',
            affects: 'fm-depth',
            apply: function(channelName, newval) { (channelName == 'left' ? fModL : fModR).amp(newval * 0.01) }
        },
        'fm-frequency-ramp': {
            target: 'fm-frequency-target',
            affects: 'fm-frequency',
            apply: function(channelName, newval) { (channelName == 'left' ? fModL : fModR).freq(newval) }
        }
    };
    window.rampAffectsMap = rampAffectsMap;

    // object to store the latest ramp information that was applied
    const rampInfo = { left: {}, right: {} };
    ['left', 'right'].forEach(function(channelName) {
        Object.keys(rampAffectsMap).forEach(function(rampkey){
            const targetkey = rampAffectsMap[rampkey]['target'];
            rampInfo[channelName][rampkey] = 0;
            rampInfo[channelName][targetkey] = parseFloat($(`#${channelName}-channel-column input[name="${targetkey}"]`).val());
        });
    });

    // UI initialization (make the right channel UI a clone of the left one)
    $('#right-channel-column').append($('#left-channel-column .content').clone());

    // init all the different UI elements
    initSpinners();
    initSliders();
    initStopButtons();
    $('select').selectmenu();

    loadPromode();

    // This equalizes the two instances of vol-ramp/vol-target in the promode/classicmode blocks when either changes
    $('input[name="vol-ramp"],input[name="vol-target"]').on('change', function(e) { 
        const $tgt = $(e.currentTarget);
        $tgt.parents('.channel-column').first().find(`input[name="${$tgt.attr('name')}"]`).val($tgt.val());
    });

    // register UI events
    addListenerToApply('left', leftOsc, modL, fModL, modL2);
    addListenerToApply('right', rightOsc, modR, fModR, modR2);

    initPainTool('left');
    initPainTool('right');

    $('body').on('keyup', function(e) {
        if (e.keyCode === 27)
            $('.stop-btn').click();
        else if (e.keyCode === 13)
            $('.apply-btn').click();
    });


    if (feature_promode) {
        $('.cancel-ramp').on('click', function(e) {
            const $tgt = $(e.currentTarget);
            const $rampSpinner = $tgt.prev();
            if (! $rampSpinner.is('.ui-spinner')) return;
            $rampSpinner.find('input').val('0.00');
            $tgt.parents('.channel-column').first().find('.apply-btn').click();
        });
    }

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
        const chSelector = '#' + channelName + '-channel-column ';
        $(chSelector + '.apply-btn').click(function () {
            applyChanges(channelName, osc, ampModulator, freqModulator, ampModulator2);
            // send event to communication module can capture it
            $(window).trigger('applied-' + channelName);
        });

        $(chSelector + ' input').keydown(function (e) {
            if (e.keyCode == 13) {
                // return key was pressed
                applyChanges(channelName, osc, ampModulator, freqModulator, ampModulator2);
                // send event to communication module can capture it
                $(window).trigger('applied-' + channelName);
            } else if (e.keyCode == 27) {
                // escape key was pressed
                stopChannel(channelName);
                // send event to communication module can capture it
                $(window).trigger('stopped-' + channelName);
            }
        });
    }


    function applyChanges(channelName, osc, ampModulator, freqModulator, ampModulator2) {
        const $chControls = $(`#${channelName}-channel-column`);

        // NOTE: If you change any of these ranges, also change it in in the socket.on in public/js/communication.js
        validateRange($chControls.find('input[name="frequency"]'), 10, 3000);
        validateRange($chControls.find('input[name="volume"]'), 0, 100);
        validateRange($chControls.find('input[name="am-depth"]'), 0, 100);
        validateRange($chControls.find('input[name="am-frequency"]'), 0, 100);
        validateRange($chControls.find('input[name="am2-depth"]'), 0, 100);
        validateRange($chControls.find('input[name="am2-frequency"]'), 0, 100);
        validateRange($chControls.find('input[name="fm-depth"]'), 0, 1000);
        validateRange($chControls.find('input[name="fm-frequency"]'), 0, 100);
        validateRange($chControls.find('input[name="vol-ramp"]'), 0, 10);
        validateRange($chControls.find('input[name="vol-target"]'), 0, 100);
        validateRange($chControls.find('input[name="toff"]'), 0, 60);
        validateRange($chControls.find('input[name="ton"]'), 0, 60);
        tOn[channelName] = parseFloat($chControls.find('input[name=ton]').val());
        validateRange($chControls.find('input[name="tatt"]'), 0, tOn[channelName]);

        tAtt[channelName] = parseFloat($chControls.find('input[name=tatt]').val());
        tOff[channelName] = parseFloat($chControls.find('input[name=toff]').val());

        const frequency = parseFloat($chControls.find('input[name="frequency"]').val());
        const volume = 0.01 * parseFloat($chControls.find('input[name="volume"]').val());

        const amDepth = 0.01 * parseFloat($chControls.find('input[name="am-depth"]').val());
        const amFrequency = parseFloat($chControls.find('input[name="am-frequency"]').val());
        const amType = $chControls.find('select[name="am-type"]').val();
        const amDepth2 = 0.01 * parseFloat($chControls.find('input[name="am2-depth"]').val());
        const amFrequency2 = parseFloat($chControls.find('input[name="am2-frequency"]').val());
        const amType2 = $chControls.find('select[name="am2-type"]').val();

        const fmDepth = parseFloat($chControls.find('input[name="fm-depth"]').val());
        const fmFrequency = parseFloat($chControls.find('input[name="fm-frequency"]').val());
        const fmType = $chControls.find('select[name="fm-type"]').val();

        Object.keys(rampAffectsMap).forEach(function(rampkey){
            const targetkey = rampAffectsMap[rampkey]['target'];
            rampInfo[channelName][rampkey] = parseFloat($chControls.find(`input[name="${rampkey}"]`).val());
            rampInfo[channelName][targetkey] = parseFloat($chControls.find(`input[name="${targetkey}"]`).val());
            // console.log("Applied channel %s ramp %s=%o target %s=%o", channelName, rampkey, rampInfo[channelName][rampkey], targetkey, rampInfo[channelName][targetkey]);
        });

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
        const $col = $('#' + ch + '-channel-column');
        const osc = ch == 'left' ? leftOsc : rightOsc;
        if (tOff[ch] > 0) {
            osc.amp(0);
        }
        clearTimeout(onOffTimeouts[ch]);
        onOffTimeouts[ch] = setTimeout(function(){ onOffCycle_On(ch) }, tOff[ch] * 1000);
    }

    function validateRange(field, min, max) {
        field.each(function(i, el) {
            const $el = $(el);
            const value = parseFloat($el.val());
            if (value < min) {
                $el.val(min);
            } else if (value > max) {
                $el.val(max);
            }
        });
    }

    function initSpinners() {
        $('.spinner-volume').spinner(electronConfig.dataTypes['volume']);
        $('.spinner-frequency').spinner(electronConfig.dataTypes['frequency']);
        $('.spinner-change-rate').spinner(electronConfig.dataTypes['change-rate']);
        $('.spinner-ramp').spinner(electronConfig.dataTypes['spinner-ramp']);
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

    window.rampstatus = {};
    // monitor ramps every 100 ms
    setInterval(function () {
        ['left', 'right'].forEach(function (channelName) {
            const $chCol = $(`#${channelName}-channel-column`);

            Object.keys(rampAffectsMap).forEach(function(rampkey) {
                if ($('body').is('.classicmode') && key != 'vol-ramp') return;

                const targetkey = rampAffectsMap[rampkey]['target']; 
                const affects = rampAffectsMap[rampkey]['affects'];
                const rampval = rampInfo[channelName][rampkey];
                const targetval = rampInfo[channelName][targetkey];
                const curval = parseFloat($chCol.find(`input[name="${affects}"]`).val());
                window.rampstatus[rampkey] = `affects ${affects} rampval ${rampval} targetval ${targetval} curval ${curval}`;

                if (isNaN(targetval) || isNaN(rampval) || isNaN(curval)) return; // Don't try to ramp with a NaN value.  Something has gone wrong.

                if (curval == targetval) return; // target reached

                let newval = curval + rampval;
                if (newval > targetval && rampval > 0 || newval < targetval && rampval < 0)
                  newval = targetval;

                const places = parseFloat(newval.toFixed(2)) == parseFloat(newval.toFixed(3)) ? 2 : 3;
                $chCol.find(`input[name="${affects}"]`).val(newval.toFixed(places));

                rampAffectsMap[rampkey]['apply'](channelName, newval);
            });
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
            rampInfo.left['vol-ramp'] = 0;
        } else if (channelName == 'right') {
            rightOsc.stop();
            clearTimeout(onOffTimeouts['right']);
            rampInfo.right['vol-ramp'] = 0;
        }
    };


    // quick and dirty function that handles the generation of the shocks for
    // the pain tool
    window.executePain = function (channelName, parameters) {
        if (painInProgress) {
            return;
        }

        let osc;
        if (channelName == 'left') {
            osc = leftOsc;
            rampInfo.left['vol-ramp'] = 0;
        } else if (channelName == 'right') {
            osc = rightOsc;
            rampInfo.left['vol-ramp'] = 0;
        }

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
