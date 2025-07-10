// functions that handle sending and receiving stuff to/from the server via
// a socket and updating the UI accordingly
$(function () {
    // helper function to keep values in the correct ranges
    function clamp(a, b, c) {
        return Math.max(b, Math.min(c, a));
    }

    const PAUSE_RAMP_SECS = 5;
    const RESUME_RAMP_SECS = 5;

    const path = window.location.pathname;
    const pathParts = path.split('/');
    const mode = pathParts[2];
    const sessId = pathParts[3];
    const socket = io();
    const channels = ['left', 'right', 'pain-left', 'pain-right', 'bottle'];
    const scriptInterval = 250; // ms
    const spinnersteps = ['\\', '|', '/', '&mdash;']

    let driverToken = '';
    let script = {};
    let authorizedPlaying = false;
    let scriptDuration = 0;
    let scriptVersion = 0;
    let spinnerstep = 0;
    let transient_idx = 1;
    let firstStepStamp = 0;
    let scriptTimer = 0;
    let applysteps = true;
    let channel_pos = {};
    resetChannelPositions();

    let position_dragging = false;

    function resetChannelPositions() {
        channel_pos = {};
        channels.forEach((ch) => channel_pos[ch] = 0);
    }

    function startScriptPlaying(ramp_up=true) {
        if (window.script_player_interval === undefined) {
            $('#playPauseButton').attr('title', 'Pause');
            resumeScriptVolume();
            if (ramp_up) applysteps = false;
            setTimeout(function() { applysteps = true }, RESUME_RAMP_SECS * 1000);
            window.script_player_interval = setInterval(script_increment_and_run, scriptInterval);
        }
    }

    function resumeScriptVolume() {
        ['left', 'right'].forEach(function(ch) {
            let message = { ...script[ch][channel_pos[ch]]['message'] };
            const current_vol = $(`#${ch}-channel-column input[name=volume]`).val();
            if (message['volume'] == current_vol) return;
            message['rampTarget'] = message['volume'];
            message['rampRate'] = 100 / PAUSE_RAMP_SECS;
            message['volume'] = current_vol;
            apply_step(ch, message);
        });
    }

    function stopScriptPlaying(ramp_down=true) {
        if (window.script_player_interval !== undefined) {
            clearInterval(window.script_player_interval);
            window.script_player_interval = undefined;
            $('#playPauseButton').attr('title', 'Play');

            if (ramp_down) {
                $("input[name=ramp-target]").val(0);
                $("input[name=ramp-rate]").val(100 / PAUSE_RAMP_SECS);
                $(".apply-btn").click();
            }
        }
    }

    function formatTime(seconds) {
        const minutes = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${minutes}:${secs < 10 ? '0' : ''}${secs}`;
    }

    function updateScriptTimes() {
        const currentTime = parseInt(scriptTimer / 1000) - firstStepStamp / 1000;
        const remainingTime = scriptDuration / 1000 - currentTime;
        // if (window.console) console.log("timer/first/duration %d/%d/%d current/remain: %d/%d", scriptTimer, firstStepStamp, scriptDuration, currentTime, remainingTime);
        $('#time-info').text(`${formatTime(currentTime)} / ${formatTime(remainingTime)}`);
    }

    function resumeAtPosition(msecs, ramp_up=true) {
        stopScriptPlaying(false);
        channels.forEach(function(ch) {
            if (script[ch] === undefined)
                return;

            channel_pos[ch] = 0;
            for (let ch_pos = 0; script[ch][ch_pos] !== undefined; ch_pos++) {
                if (window.console) console.log("ch_pos=%d, channel=%s, step=%o, msecs=%d", ch_pos, ch, script[ch][ch_pos], msecs);
                if (script[ch][ch_pos]['stamp'] !== undefined && script[ch][ch_pos]['stamp'] <= msecs)
                    channel_pos[ch] = ch_pos;
                else
                    break;
            }

            // We only want left & right to start with the previous step, the rest should start with the next future step:
            if (ch != 'left' && ch != 'right')
              channel_pos[ch]++;

            if (window.console) try { console.log("Channel %s at %d.  Position %d, next stamp %d", ch, msecs, channel_pos[ch], script[ch][channel_pos[ch]]['stamp']); } catch(e) {}
        });
        scriptTimer = msecs;
        startScriptPlaying(ramp_up);
    }

    function script_increment_and_run() {
        if ( ! script ) {
          return;
        }
        scriptTimer += scriptInterval;
        if (applysteps) {
            channels.forEach(function(ch) {
                const ch_pos = channel_pos[ch];
                if (script[ch] !== undefined && script[ch][ch_pos] !== undefined && script[ch][ch_pos]['stamp'] !== undefined && script[ch][ch_pos]['stamp'] <= scriptTimer) {
                    const step = script[ch][ch_pos];
                    channel_pos[ch]++;
                    apply_step(ch, step['message']);
                }
            });
        }
        const percent = ((scriptTimer - firstStepStamp) / scriptDuration * 100).toFixed(0);
        if (percent >= 100) {
            $('.show-not-playing').show();
            $('.show-playing').hide();
            $('#progressBar').css('width', '0%');
            $('#progressHandle').css('left', '0%');
            stopScriptPlaying();
            socket.emit('setFilePlaying', { sessId: sessId, driverToken: driverToken, filePlaying: '', fileDriver: '', duration: 0 });
        } else {
            $('#progressBar').css('width', `${percent}%`);
            $('#progressHandle').css('left', `${percent}%`);
        }
        updateScriptTimes();
    }

    function apply_step(channel, step) {
        if (window.console) console.log("Step %s: %o", channel, step);
        if (channel.match(/^pain-/)) {
            if (window.console) console.log("EMIT %s, %o", channel, step); // dbg
            step['sessId'] = sessId;
            step['driverToken'] = driverToken;
            socket.emit(channel, step);
        } else if (channel == 'bottle' && step['bottleDuration']) {
          const secs = parseInt(step['bottleDuration']) || 0;
          socket.emit('triggerBottle', { sessId: sessId, driverToken: driverToken, bottleDuration: secs });
          bottle_countdown(secs);
        } else {
            const channelSel = '#' + channel + '-channel-column ';
            $(channelSel + 'input[name="volume"]').val(step['volume']);
            $(channelSel + 'input[name="frequency"]').val(step['freq']);
            $(channelSel + 'select[name="am-type"]').val(step['amType']);
            $(channelSel + 'input[name="am-depth"]').val(step['amDepth']);
            $(channelSel + 'input[name="am-frequency"]').val(step['amFreq']);
            $(channelSel + 'select[name="fm-type"]').val(step['fmType']);
            $(channelSel + 'input[name="fm-depth"]').val(step['fmDepth']);
            $(channelSel + 'input[name="fm-frequency"]').val(step['fmFreq']);
            $(channelSel + 'input[name="ramp-target"]').val(step['rampTarget']);
            $(channelSel + 'input[name="ramp-rate"]').val(step['rampRate']);
            $(channelSel + '.apply-btn').click();
          }
    }

    function bottle_countdown(secs) {
        if (!secs)
            secs = 0;
        if (secs === 0) {
            $('#trigger-bottle-prompt').prop('disabled', false); // re-enable the trigger button
            $('.bottle-countdown, #rider-bottle-countdown').fadeOut(); // hide the blocker and driver's display
            return false;
        }
        /* Most of this is positioning the bottle and digits.  I set their
         * opacities to 0.01 and show them to get their width, since you can't get
         * the width of a display:none object, then set the opacity to 1 to show it.
         *
         * The rider display is #rider-bottle-countdown which contains a .bottle-countdown and the
         * driver's display is just a .bottle-countdown because it's much simpler.
         */
        const center_line_px = $('#ride-info').offset().left + $('#ride-info').width() / 2;
        const bottle_img = $('#rider-bottle-countdown img');
        bottle_img.css('opacity', '0.01');
        $('#rider-bottle-countdown').show(); // the modal background blocker
        const img_width = bottle_img.width();
        bottle_img.css('left', `${center_line_px - img_width / 2}px`).css('opacity', '1');
        $('#trigger-bottle-prompt').prop('disabled', true); // disable the trigger button while we're counting
        $('.bottle-countdown .seconds').text(secs.toString());
        const rider_seconds_div = $('#rider-bottle-countdown .seconds');
        rider_seconds_div.css('opacity', '0.01')
        $('.bottle-countdown').show();
        rider_seconds_div.css('left', `${500 + $('#ride-info').offset().left - (rider_seconds_div.width() / 2)}px`).css('opacity', '1');
        $(".bottle-countdown").fadeOut(1000, function() {
            if (secs > 0) {
                bottle_countdown(secs - 1);
            }
        });
    }

    function initSaveLoadScript() {
        initLoadScriptOnly();

        $('#clear-steps').on('click', function() {
            if (confirm('Clear Steps - Are you sure?'))
                socket.emit('clearSessionMessages', { sessId: sessId, driverToken: driverToken });
        });

        $('#save-session-messages').on('click', function() {
            socket.emit('getSessionMessages', { sessId: sessId, driverToken: driverToken });
        });
        $('#save-session-messages').show();

        socket.on('sessionMessages', function(msg) {
            if (window.File && window.FileReader && window.FileList && window.Blob) {
                let element = document.createElement('a');
                element.setAttribute('href', 'data:application/json;charset=utf-8,' + encodeURIComponent(msg));
                element.setAttribute('download', `${sessId}.json`);
                element.style.display = 'none';
                document.body.appendChild(element);
                element.click();
                document.body.removeChild(element);
            } else {
                $('#messages-target').text(msg);
                $('#status-message').append('<p>The File APIs are not fully supported by your browser.</p>');
            }
        });
    }

    function transient_message(msg) {
        const tidx = transient_idx++;
        $('#status-message').append(`<p class="transient" id="transient${tidx}">${msg}</p>`);
        setTimeout(function() { $(`#transient${tidx}`).slideUp(1000, function() { $(this).remove() }) }, 5000);
    }

    function initLoadScriptOnly() {
        $('.save-load-bar').show();

        $('#cancel-script').on('click', function() {
            try {
                stopScriptPlaying();
                script = {};
                $('.show-not-playing').show();
                $('.show-playing').hide();
                transient_message('Cancelled script');
                socket.emit('setFilePlaying', { sessId: sessId, driverToken: driverToken, filePlaying: '', fileDriver: '', duration: 0 });
            } catch(e) {
                $('#status-message').append(`<p>Error cancelling script: ${e}</p>`);
            };
        });

        $("#load-file-picker").change(function(){
            if (this.files && this.files[0]) {
                const filename = this.files[0].name;
                const reader = new FileReader();
                reader.onload = function (e) {
                    try {
                        script = JSON.parse(e.target.result);

                        let fileDriver = '';
                        if (script['meta']) {
                            if (script['meta']['version']) {
                                scriptVersion = parseInt(script['meta']['version']) || 1;
                            }
                            if (script['meta']['driverName']) {
                                fileDriver = script['meta']['driverName'].replace(/[^A-Za-z0-9' !@.\^\&\-]/, '');
                                transient_message(`Loaded file is by driver "${fileDriver}"`);
                            }
                            if (script['meta']['driverComments']) {
                                transient_message(`File comments: ${script['meta']['driverComments'].slice(0, 100)}`);
                            }
                            delete script['meta'];
                        }

                        // Upgrade script version
                        if (scriptVersion > 2) {
                          $('#status-message').append(`<p>Cannot load version ${scriptVersion} script.</p>`);
                          return false;
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
                            if (window.console) console.log("firstStepStamp=%d, scriptDuration=%d", firstStepStamp, scriptDuration);
                        } catch(e) {
                            if (window.console) console.log("Failed to adjust first step start times: %o", e);
                        }
                          
                        window.dbgscript = script;
                        socket.emit('setFilePlaying', { sessId: sessId, driverToken: driverToken, filePlaying: filename, fileDriver: fileDriver, duration: scriptDuration });
                        $('.show-not-playing').hide();
                        $('.show-playing').show();
                        resetChannelPositions();
                        startScriptPlaying(false);
                    } catch(e) {
                        if (window.console) console.log("Parse error: %o", e);
                        $('#status-message').append(`<p>Error parsing script file: ${e}</p>`);
                    }
                };
                reader.readAsText(this.files[0]);
            };
        });

        $('#playPauseButton').on('click', function() {
            if (window.script_player_interval !== undefined) { // is playing
              stopScriptPlaying();
            } else {
              startScriptPlaying();
            }
        });

        $('#progressHandle').on('mousedown', function() {
            position_dragging = true;
            stopScriptPlaying(false);
        });

        $(document).on('mousemove', function(e) {
            if (! position_dragging) return;

            const containerRect = $('.progress-container')[0].getBoundingClientRect();
            let newX = e.clientX - containerRect.left;
            newX = Math.max(0, Math.min(newX, containerRect.width)); // Clamp within container

            const percent = (newX / containerRect.width) * 100;
            $('#progressBar').css('width', `${percent}%`);
            $('#progressHandle').css('left', `${percent}%`);

            // Update time display while dragging
            if (!isNaN(scriptDuration)) {
                scriptTimer = (newX / containerRect.width) * scriptDuration;
                updateScriptTimes();
            }
        });

        $(document).on('mouseup', function() {
            if (!position_dragging) return;
            position_dragging = false;
            resumeAtPosition(scriptTimer);
        });
    }


    ['left', 'right'].forEach(function (channel) {
        socket.on(channel, function (msg) {
            // if (window.console) console.log("UPD %s, %s, %o, %o, %o, %o", channel, mode, authorizedPlaying, msg, msg.volume, msg['volume']);
            if (!authorizedPlaying && mode == 'play') return;

            const $channelCol = $(`#${channel}-channel-column`);
            // if (window.console) console.log("SET %s volume=%o, clamped to %o", channelSel, msg.volume, clamp(msg.volume, 0, 100));
            // NOTE: If you change any of these ranges, also change it in applyChanges in public/js/electron.js
            $channelCol.find('input[name="volume"]').val(clamp(msg.volume, 0, 100));
            $channelCol.find('input[name="frequency"]').val(clamp(msg.freq, 10, 3000));
            $channelCol.find('select[name="am-type"]').val(msg.amType).selectmenu('refresh');
            $channelCol.find('input[name="am-depth"]').val(clamp(msg.amDepth, 0, 100));
            $channelCol.find('input[name="am-frequency"]').val(clamp(msg.amFreq, 0, 100));
            $channelCol.find('select[name="fm-type"]').val(msg.fmType).selectmenu('refresh');
            $channelCol.find('input[name="fm-depth"]').val(clamp(msg.fmDepth, 0, 1000));
            $channelCol.find('input[name="fm-frequency"]').val(clamp(msg.fmFreq, 0, 100));
            $channelCol.find('input[name="ramp-rate"]').val(clamp(msg.rampRate, 0, 10));
            $channelCol.find('input[name="ramp-target"]').val(clamp(msg.rampTarget, 0, 100));
            if (msg.active) {
                applyChanges(channel);
            } else {
                stopChannel(channel);
            }
        });
    });


    if (mode == 'play') {
        if (sessId == 'solo') {
            initLoadScriptOnly();
            return;
        }

        // let the server know we want to join this session and display an error
        // message if it fails
        $('#status-message').html('<p>Joined session with Session ID ' + sessId + '. To start riding, click the button below.</p>');
        socket.emit('registerRider', { sessId: sessId });
        socket.on('riderRejected', function () {
            $('#status-message').html('<p>Could not join session ' + sessId + '. Please check the Session ID.</p>');
        });

        $('#initialize-audio').show();
        $('#initialize-audio a').click(function () {
            authorizedPlaying = true;
            socket.emit('requestLast', { sessId: sessId });
            $('#initialize-audio').hide();
            $('#status-message').html('<p>Have a good ride!</p>');
        });

        $('#ride-info').show();

        // show traffic light container
        $('#traffic-light').show();
        // event listeners for traffic light system
        $(window).on('traffic-light', function () {
            const data = {
                sessId: sessId,
                color: $('#traffic-light button.active').data('traffic-light')
            };
            socket.emit('trafficLight', data);
            return false;
        });

        function initialize_cam_url_warning_dismissal() {
          $('#cam-url .cam-url-link a').on('click', function() { $('#cam-url .cam-url-warning').slideUp() });
        }

        socket.on('driverLost', function() {
          $('#status-message').html(`<p>The driver has left.  Give this url to someone else and they can become the driver:<br/><b>${document.location.href.replace('/play/', '/drive/')}</b></p>`);
        });

        socket.on('driverGained', function() {
          $('#status-message').html('<p>A new driver has arrived!</p>');
        });

        // receive pain events
        ['pain-left', 'pain-right'].forEach(function (channel) {
            socket.on(channel, function (msg) {
                if (window.console) console.log("PAIN %o, %o", channel, msg);
                if (!authorizedPlaying) return;
                const channelName = channel == 'pain-left' ? 'left' : 'right';
                executePain(channelName, msg);
            });
        });

        socket.on('bottle', function(msg) {
          if (!authorizedPlaying) return;
          if (!msg || !msg.bottleDuration || isNaN(parseInt(msg.bottleDuration))) return;
          bottle_countdown(parseInt(msg.bottleDuration));
        });

        socket.on('updateFlags', function(msg) {
            if (msg['blindfoldRiders']) {
                $("#controls").slideUp();
                $("#nocontrols").fadeIn();
            } else if (msg['blindfoldRiders'] == false) {
                $("#nocontrols").fadeOut();
                $("#controls").slideDown();
            }

            const name = (msg['driverName'] || 'Anonymous').replace(/[^A-Za-z0-9' !@.\^\&\-]/, '');
            $("#driver-nametag .nametag").text(name);

            if (msg['camUrl']) {
                $('#cam-url .cam-url-link').html(`<a target="_blank" href="${msg['camUrl']}">${msg['camUrl']}</a>`);
                initialize_cam_url_warning_dismissal();
                $('#cam-url .cam-url-warning').show();
                $('#cam-url').fadeIn();
            } else {
                $('#cam-url').fadeOut();
            }

            if (msg['filePlaying']) {
                $('#file-playing .file-playing-info').text(msg['filePlaying']);
                $('#file-playing .file-driver-info').text(`by ${msg['fileDriver'] || 'Unknown'}`);
                $('#file-playing').fadeIn();
            } else {
                $('#file-playing').fadeOut();
            }

            if (msg['driverComments']) {
                $('#comments .message').text(msg['driverComments']);
                $('#comments').fadeIn();
            } else {
                $('#comments').fadeOut();
            }
        });

        initialize_cam_url_warning_dismissal() 
        $('button.apply-btn').remove();
        $('button.pain-btn').remove();
        $('button.stop-btn').remove();
        $('#drive-info').remove();
    } else {
        // ---DRIVER---
        $('#status-message').html('<p>Attempting to register as driver of Session ID ' + sessId + '.</p>');
        socket.emit('registerDriver', { sessId: sessId });

        socket.on('driverToken', function (msg) {
            driverToken = msg;
            const link = ('' + window.location).replace('/drive/', '/play/');
            const line1 = 'Registered successfully on the network! Driving session with Session ID ' + sessId + '.';
            const line2 = 'Send the following link to the people you want to drive:<br>' + '<strong>' + link + '</strong>';
            $('#status-message').html('<p>' + line1 + '<br>' + line2 + '</p>');

            $('#public-session').on('change', function(e) {
                const new_state = $(e.currentTarget).is(":checked");
                socket.emit('setPublicSession', { sessId: sessId, driverToken: driverToken, publicSession: new_state });
            });

            $('#blindfold-riders').on('change', function(e) {
                const new_state = $(e.currentTarget).is(":checked");
                socket.emit('setBlindfoldRiders', { sessId: sessId, driverToken: driverToken, blindfoldRiders: new_state });
            });

            $('.set-settings').on('click', function() {
                const name = $('#driver-name').val().replace(/[^A-Za-z0-9' !@.\^\&\-]/, '');
                const comments = $('#driver-comments').val().slice(0, 100);
                const url = $('#driver-cam-url').val();
                if (url && !url.match(/^https?:\/\//i)) {
                    $('#status-message').append("<p>Invalid Cam URL.  Has to be an HTTP/HTTPS URL.</p>");
                    return false;
                }
                socket.emit('setSettings', { sessId: sessId, driverToken: driverToken, driverName: name, camUrl: url, driverComments: comments });
            });

            $('#bottle-duration').on('input', function() {
              $('#bottle-duration-val').text($('#bottle-duration').val());
            });

            $('#trigger-bottle-prompt').on('click', function() {
              const secs = parseInt($('#bottle-duration').val()) || 0;
              socket.emit('triggerBottle', { sessId: sessId, driverToken: driverToken, bottleDuration: secs });
              bottle_countdown(secs);
            });

            $('#rider-bottle-countdown').remove();

            socket.on('updateFlags', function(msg) {
                // if (window.console) console.log("updateFlags %o", msg);
                $("#blindfold-riders").prop('checked',  msg['blindfoldRiders'] ? true : false);
                $("#public-session").prop('checked',  msg['publicSession'] ? true : false);
                $("#driver-name").val(msg['driverName']);
                $('#driver-cam-url').val(msg['camUrl']);
                $('#driver-comments').val(msg['driverComments']);
            });

            // initialize box that displays how many riders are connected and update it every 5 seconds
            $('#drive-info').show();
            socket.emit('getRiderCount', { sessId: sessId, driverToken: driverToken });
            socket.emit('requestLast', { sessId: sessId });
            setInterval(function () {
                socket.emit('getRiderCount', { sessId: sessId, driverToken: driverToken });
            }, 5000);

            socket.on('riderCount', function (msg) {
                // render traffic light bars, based on the status of the riders
                const total = msg.total;
                const bars = [
                    { colorClass: 'red', value: msg.R },
                    { colorClass: 'yellow', value: msg.Y },
                    { colorClass: 'green', value: msg.G },
                    { colorClass: 'none', value: msg.N }
                ];

                bars.forEach(function (bar) {
                    const element = document.querySelector(`.traffic-bar.${bar.colorClass}`);
                    element.style.width = `${total === 0 ? 0 : (bar.value / total) * 100}%`;
                });

                // update the rider count on the page
                $('#rider-count-number').text(total);
            });

            initSaveLoadScript();
            socket.on('sessionMessagesCleared', function() {
                transient_message('Steps Cleared');
            });

        });

        socket.on('driverRejected', function () {
            $('#status-message').append('<p>Someone else is already driving this session. Please create a new one.<br>Any changes you make will NOT be sent to riders.</p>');
        });

        // set listeners to send events to the server
        ['left', 'right'].forEach(function (channel) {
            const channelSel = '#' + channel + '-channel-column ';

            // helper function to assemble the data we want to send to the server,
            // including all signal generation parameters
            const getDataToSend = function () {
                return {
                    sessId: sessId,
                    driverToken: driverToken,
                    active: true,
                    volume: parseFloat($(channelSel + 'input[name="volume"]').val()),
                    freq: parseFloat($(channelSel + 'input[name="frequency"]').val()),
                    amType: $(channelSel + 'select[name="am-type"]').val(),
                    amDepth: parseFloat($(channelSel + 'input[name="am-depth"]').val()),
                    amFreq: parseFloat($(channelSel + 'input[name="am-frequency"]').val()),
                    fmType: $(channelSel + 'select[name="fm-type"]').val(),
                    fmDepth: parseFloat($(channelSel + 'input[name="fm-depth"]').val()),
                    fmFreq: parseFloat($(channelSel + 'input[name="fm-frequency"]').val()),
                    rampTarget: parseFloat($(channelSel + 'input[name="ramp-target"]').val()),
                    rampRate: parseFloat($(channelSel + 'input[name="ramp-rate"]').val())
                };
            };

            // helper function to assemble the pain function data to send it to the server
            const getPainDataToSend = function () {
                return {
                    sessId: sessId,
                    driverToken: driverToken,
                    volume: 0.01 * parseFloat($('input[name="pain-volume"]').val()),
                    frequency: parseFloat($('input[name="pain-frequency"]').val()),
                    shockDuration: parseFloat($('input[name="pain-duration"]').val()),
                    timeBetweenShocks: parseFloat($('input[name="pain-time-between"]').val()),
                    numberOfShocks: parseInt($('input[name="pain-number"]').val()),
                };
            };

            // register event listeners for applying changes, stopping a channel and using
            // the pain tool (total 6 events, 3 per channel)
            $(window).on('applied-' + channel, function () {
                const data = getDataToSend();
                data.active = true;
                socket.emit(channel, data);
                return false;
            });

            $(window).on('stopped-' + channel, function () {
                const data = getDataToSend();
                data.active = false;
                socket.emit(channel, data);
                return false;
            });

            $(window).on('pain-' + channel, function () {
                const data = getPainDataToSend();
                socket.emit('pain-' + channel, data);
                return false;
            });
        });
    }
});
