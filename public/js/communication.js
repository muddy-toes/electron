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
    let bottleSecs = 0;
    let channel_pos = {};
    resetChannelPositions();

    let position_dragging = false;

    const ss4TagMap = {
        volume: 'Vol',
        rampRate: 'VolC',
        freq: 'BF',
        amType: 'PAM_Pattern',
        amDepth: 'PAM_MD',
        amFreq: 'PAM_MF',
        amType2: 'SAM_Pattern',
        amDepth2: 'SAM_MD',
        amFreq2: 'SAM_MF',
        fmType: 'BFM_Pattern',
        fmDepth: 'BFM_MD',
        fmFreq: 'BFM_MF',
        tOn: 'tOn',
        tOff: 'tOff',
        tAtt: 'tAtt'
    };

    function getSubtrackValue(xml, tagName) {
        const tag = xml.getElementsByTagName(tagName)[0];
        if (tag === undefined) return;
        const val = tag.getAttribute('V');
        if (tagName.match(/_Pattern$/)) return tag.getAttribute('Type');
        if (val.match(/[0-9]/)) return parseFloat(val.replace(/,/, '.'));
        if (val.match(/True/)) return true;
        if (val.match(/False/)) return false;
    }

    function convertSS4Step(step) {
        let out = {};
        Object.keys(ss4TagMap).forEach(function(key) {
          let val = getSubtrackValue(step, ss4TagMap[key]);
          if (val === undefined)
              return;

          /* ss4 expresses volume as 0-1 */
          if (key == 'volume')
              val *= 100;

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
    function convertSS4ToElectron(xmlstring) {
        const parser = new DOMParser();
        const xml = parser.parseFromString(xmlstring, 'text/xml');
        let out = { meta: { version: 2 }, left: [], right: [] };
        let scriptTime = 0;

        const session = xml.getElementsByTagName('Session')[0];
        if (session !== undefined) {
            out['meta']['driverName'] = session.getAttribute('Creator')
            out['meta']['driverComments'] = session.getAttribute('Name') + " " + session.getAttribute('Description')
        }

        const tracks = xml.getElementsByTagName('Track');
        Array.from(tracks).forEach(function(track) {
            const trackTime = parseFloat(track.getAttribute('Time').replace(/,/g, '.')) * 1000;
            if (isNaN(trackTime)) return;
            const subtracks = track.getElementsByTagName('Subtrack')
            const left = subtracks[0];
            const leftstep = convertSS4Step(left);
            if (Object.keys(leftstep).length > 0)
                out['left'].push({ stamp: scriptTime, message: leftstep });

            const right = subtracks[1];
            const rightstep = convertSS4Step(right);
            if (Object.keys(rightstep).length > 0)
                out['right'].push({ stamp: scriptTime, message: rightstep });

            scriptTime += trackTime + 1000;
        });
        
        return out;
    }

    function resetChannelPositions() {
        channel_pos = {};
        channels.forEach((ch) => channel_pos[ch] = 0);
    }

    function startScriptPlaying(ramp_up=true) {
        if (window.script_player_interval === undefined) {
            $('#playPauseButton').attr('title', 'Pause');
            $('#rider-bottle-countdown-container').show();
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
            applyStep(ch, message);
        });
    }

    function stopScriptPlaying(ramp_down=true) {
        if (window.script_player_interval !== undefined) {
            clearInterval(window.script_player_interval);
            window.script_player_interval = undefined;
            $('#playPauseButton').attr('title', 'Play');
            $('#rider-bottle-countdown-container').hide();

            if (ramp_down) {
                $("input[name=ramp-target]").val(0);
                $("input[name=ramp-rate]").val(100 / PAUSE_RAMP_SECS);
                $(".apply-btn").click();
            }
        }
    }

    function formatTime(seconds) {
        let minutes = Math.floor(seconds / 60);
        let secs = Math.floor(seconds % 60);
        if (minutes < 0) minutes = 0;
        if (secs < 0) secs = 0;
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
                    applyStep(ch, step['message']);
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

    function applyStep(channel, step) {
        if (window.console) console.log("Step %s: %o", channel, step);
        if (channel.match(/^pain-/)) {
            step['sessId'] = sessId;
            step['driverToken'] = driverToken;
            socket.emit(channel, step);
        } else if (channel == 'bottle' && step['bottleDuration']) {
          const secs = parseInt(step['bottleDuration']) || 0;
          socket.emit('triggerBottle', { sessId: sessId, driverToken: driverToken, bottleDuration: secs });
          bottleCountdown(secs);
        } else {
            // These fields may not be in all json files.  If they're not there, set them to their inactive defaults:
            if (step['amType2'] === undefined) step['amType2'] = 'none';
            if (step['tOn'] === undefined) step['tOn'] = 0.1;
            if (step['tOff'] === undefined) step['tOff'] = 0;

            const $channelCol = $(`#${channel}-channel-column`);
            if (step['volume'] !== undefined) $channelCol.find('input[name="volume"]').val(step['volume']);
            if (step['freq'] !== undefined) $channelCol.find('input[name="frequency"]').val(step['freq']);
            if (step['amType'] !== undefined) $channelCol.find('select[name="am-type"]').val(step['amType']).selectmenu('refresh');
            if (step['amDepth'] !== undefined) $channelCol.find('input[name="am-depth"]').val(step['amDepth']);
            if (step['amFreq'] !== undefined) $channelCol.find('input[name="am-frequency"]').val(step['amFreq']);
            if (step['amType2'] !== undefined) $channelCol.find('select[name="am2-type"]').val(step['amType2']).selectmenu('refresh');
            if (step['amDepth2'] !== undefined) $channelCol.find('input[name="am2-depth"]').val(step['amDepth2']);
            if (step['amFreq2'] !== undefined) $channelCol.find('input[name="am2-frequency"]').val(step['amFreq2']);
            if (step['fmType'] !== undefined) $channelCol.find('select[name="fm-type"]').val(step['fmType']).selectmenu('refresh');
            if (step['fmDepth'] !== undefined) $channelCol.find('input[name="fm-depth"]').val(step['fmDepth']);
            if (step['fmFreq'] !== undefined) $channelCol.find('input[name="fm-frequency"]').val(step['fmFreq']);
            if (step['rampTarget'] !== undefined) $channelCol.find('input[name="ramp-target"]').val(step['rampTarget']);
            if (step['rampRate'] !== undefined) $channelCol.find('input[name="ramp-rate"]').val(step['rampRate']);
            if (step['tOn'] !== undefined) $channelCol.find('input[name="ton"]').val(step['tOn']);
            if (step['tOff'] !== undefined) $channelCol.find('input[name="toff"]').val(step['tOff']);
            if (step['tAtt'] !== undefined) $channelCol.find('input[name="tatt"]').val(step['tAtt']);
            $channelCol.find('.apply-btn').click();
          }
    }

    function bottleCountdown(secs=0) {
        if (secs > 0) bottleSecs = secs;
        if (bottleSecs === 0) {
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
        const center_line_px = $(window).width() / 2;
        const bottle_img = $('#rider-bottle-countdown img');
        bottle_img.css('opacity', '0.01');
        $('#rider-bottle-countdown').show(); // the modal background blocker
        const img_width = bottle_img.width();
        bottle_img.css('left', `${center_line_px - img_width / 2}px`).css('opacity', '1');
        $('#trigger-bottle-prompt').prop('disabled', true); // disable the trigger button while we're counting
        $('.bottle-countdown .seconds').text(bottleSecs.toString());
        const rider_seconds_div = $('#rider-bottle-countdown .seconds');
        rider_seconds_div.css('opacity', '0.01')
        $('.bottle-countdown').show();
        rider_seconds_div.css('left', `${center_line_px - (rider_seconds_div.width() / 2)}px`).css('opacity', '1');
        $('.bottle-countdown').fadeOut(800);
        setTimeout(function() {
            if (bottleSecs > 0) {
                bottleSecs--;
                bottleCountdown();
            }
        }, 1000);
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
                let filetype = 'electron';
                if (feature_promode && filename.match(/\.(SmrtStm4|ss4)$/)) {
                  filetype = 'ss4';
                }
                const reader = new FileReader();
                reader.onload = function (e) {
                    try {
                        switch (filetype) {
                          case 'ss4':
                            script = convertSS4ToElectron(e.target.result);
                            $('.promode').slideDown(); // Ensure SS4 controls are visible, but don't update user's promode setting
                            break;
                          case 'electron':
                            script = JSON.parse(e.target.result);
                            break;
                          default:
                            throw 'Invalid file type';
                        }
                        window.script = script // DEBUG

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
            $channelCol.find('select[name="am2-type"]').val(msg.amType2).selectmenu('refresh');
            $channelCol.find('input[name="am2-depth"]').val(clamp(msg.amDepth2, 0, 100));
            $channelCol.find('input[name="am2-frequency"]').val(clamp(msg.amFreq2, 0, 100));
            $channelCol.find('select[name="fm-type"]').val(msg.fmType).selectmenu('refresh');
            $channelCol.find('input[name="fm-depth"]').val(clamp(msg.fmDepth, 0, 1000));
            $channelCol.find('input[name="fm-frequency"]').val(clamp(msg.fmFreq, 0, 100));
            $channelCol.find('input[name="ramp-rate"]').val(clamp(msg.rampRate, 0, 10));
            $channelCol.find('input[name="ramp-target"]').val(clamp(msg.rampTarget, 0, 100));
            $channelCol.find('input[name="ton"]').val(clamp(msg.tOn, 0, 60));
            const ton_current = parseFloat($channelCol.find('input[name="ton"]').val());
            $channelCol.find('input[name="toff"]').val(clamp(msg.tOff, 0, 60));
            $channelCol.find('input[name="tatt"]').val(clamp(msg.tAtt, 0, ton_current));
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
        if (! sessId.match(/^AUTO\d+/) )
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
          bottleCountdown(parseInt(msg.bottleDuration));
        });

        // This is the rider updateFlags.  There is another for drivers
        socket.on('updateFlags', function(msg) {
            if (msg['blindfoldRiders']) {
                $("#controls").slideUp();
                $("#file-playing-blindfold").hide();
                $("#nocontrols").fadeIn();
            } else if (msg['blindfoldRiders'] == false) {
                $("#nocontrols").fadeOut();
                $("#file-playing-blindfold").show();
                $("#controls").slideDown();
            }

            if (msg['proMode'] !== undefined) {
                if (msg['proMode'])
                    $('.promode').slideDown();
                else
                    $('.promode').slideUp();
            }

            const name = (msg['driverName'] || 'Anonymous').replace(/[^A-Za-z0-9' !@.\^\&\-]/, '');
            $("#driver-nametag .nametag").text(name);

            if (msg['camUrl']) {
                if (camUrlList.length == 0) {
                    $('#cam-url .cam-url-link').html(`<a target="_blank" href="${msg['camUrl']}">${msg['camUrl']}</a>`);
                    initialize_cam_url_warning_dismissal();
                    $('#cam-url .cam-url-warning').show();
                } else {
                    const camlistItem = camUrlList.filter((item) => item.name == msg['camUrl'])[0];
                    if (camlistItem !== undefined) {
                        if (camlistItem['url'] === undefined && camlistItem['message'] !== undefined) {
                            $('#cam-url .cam-url-link').text(camlistItem['message']);
                        } else {
                            $('#cam-url .cam-url-link').html(`<a target="_blank" href="${camlistItem['url']}">${camlistItem['name']}</a>`);
                        }
                    }
                }
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
        $('#promode-toggler').remove();
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

            $(document).on('promode-off', function() {
                socket.emit('setPromode', { sessId: sessId, driverToken: driverToken, proMode: false });
            });
            $(document).on('promode-on', function() {
                socket.emit('setPromode', { sessId: sessId, driverToken: driverToken, proMode: true });
            });

            $('.set-settings').on('click', function() {
                const name = $('#driver-name').val().replace(/[^A-Za-z0-9' !@.\^\&\-]/, '');
                const comments = $('#driver-comments').val().slice(0, 100);
                const url = $('#driver-cam-url').val();
                if (camUrlList.length == 0) {
                    if (url && !url.match(/^https?:\/\//i)) {
                        $('#status-message').append("<p>Invalid Cam URL.  Has to be an HTTP/HTTPS URL.</p>");
                        return false;
                    }
                } else {
                    if (camUrlList.map((item) => item.name).filter((name) => name === url)[0] === undefined) {
                        $('#status-message').append("<p>Invalid Cam Selection.  Item not in list</p>");
                        return false;
                    }
                }
                socket.emit('setSettings', { sessId: sessId, driverToken: driverToken, driverName: name, camUrl: url, driverComments: comments });
            });

            $('#bottle-duration').on('input', function() {
              $('#bottle-duration-val').text($('#bottle-duration').val());
            });

            $('#trigger-bottle-prompt').on('click', function() {
              const secs = parseInt($('#bottle-duration').val()) || 0;
              socket.emit('triggerBottle', { sessId: sessId, driverToken: driverToken, bottleDuration: secs });
              bottleCountdown(secs);
            });

            $('#rider-bottle-countdown-container').hide();

            // This is the driver updateFlags, there is another for riders
            socket.on('updateFlags', function(msg) {
                $("#blindfold-riders").prop('checked',  msg['blindfoldRiders'] ? true : false);
                $("#public-session").prop('checked',  msg['publicSession'] ? true : false);
                $("#driver-name").val(msg['driverName']);
                $('#driver-cam-url').val(msg['camUrl']);
                $('#driver-comments').val(msg['driverComments']);
                if (msg['proMode'] !== undefined) {
                    if (msg['proMode'])
                        $('.promode').slideDown();
                    else
                        $('.promode').slideUp();
                }
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
                    amType2: $(channelSel + 'select[name="am2-type"]').val(),
                    amDepth2: parseFloat($(channelSel + 'input[name="am2-depth"]').val()),
                    amFreq2: parseFloat($(channelSel + 'input[name="am2-frequency"]').val()),
                    fmType: $(channelSel + 'select[name="fm-type"]').val(),
                    fmDepth: parseFloat($(channelSel + 'input[name="fm-depth"]').val()),
                    fmFreq: parseFloat($(channelSel + 'input[name="fm-frequency"]').val()),
                    rampTarget: parseFloat($(channelSel + 'input[name="ramp-target"]').val()),
                    rampRate: parseFloat($(channelSel + 'input[name="ramp-rate"]').val()),
                    tOn: parseFloat($(channelSel + 'input[name="ton"]').val()),
                    tOff: parseFloat($(channelSel + 'input[name="toff"]').val()),
                    tAtt: parseFloat($(channelSel + 'input[name="tatt"]').val())
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
