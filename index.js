const config = {
    // if true, log all actions to console instead of just join/part sessions
    verbose: true,

    // Feature flags.  Set to false to disable.  Accessible in player.ejs via features['name'] and in client js via feature_name
    features: {
        promode: true
    },

    promodeKeys: [
        'amType2', 'amDepth2', 'amFreq2', 'tOn', 'tOff', 'tAtt'
    ],

    playlistSession: {
        sessId: 'goon_drive', // Must be 10 characters exactly
        directory: './session_files',
        public: true,
        driverName: 'GoonDriver',
        driverComments: 'The files never stop, so you never have to.  No pain tools.',
        channels: ['left', 'right', 'bottle']
    }
};

const express = require('express');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const ElectronState = require('./electronState');
const automatedDriverConfig = require('./automatedDriverConfig');
const inputValidationMiddleware = require('./inputValidation');
const socketHandler = require('./socketHandler');
const { generateAutomatedSessId } = require('./utils');

const PORT = process.env.PORT || 5000;
const electronState = new ElectronState(config);
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const { logger } = require('./utils');

function remote_ip(req) {
  return req.header('x-forwarded-for') || req.socket.remoteAddress;
}

// middleware we need for form submission
app.use(express.urlencoded({ extended: false }));

// set template engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// home page
app.get('/', function (req, res) {
    logger("[] %s GET /", remote_ip(req));
    res.render('index', { publicSessions: electronState.getPublicSessions() });
});

// actually start new automated driver
app.use('/start-automated-driver', inputValidationMiddleware.validateAutomatedDriverInput);
app.post('/start-automated-driver', function (req, res) {
    logger("[] %s GET /start-automated-driver", remote_ip(req));
    const minFrequency = parseInt(req.body['min-frequency']);
    const maxFrequency = parseInt(req.body['max-frequency']);
    const startFrequency = parseInt(req.body['start-frequency']);
    const startVolume = parseInt(req.body['start-volume']);
    const fmPreset = parseInt(req.body['fm-preset']);
    const amPreset = parseInt(req.body['am-preset']);
    const amPreset2 = parseInt(req.body['am2-preset']);
    const sessionDuration = parseInt(req.body['session-duration']);
    const painProbability = parseInt(req.body['pain-probability']);
    const painIntensity = parseInt(req.body['pain-intensity']);
    const bottlePromptingRaw = req.body['bottle-prompting'].split(/-/);
    const bottlePromptingMin = bottlePromptingRaw[0] == '0' ? 0 : parseInt(bottlePromptingRaw[0]);
    const bottlePromptingMax = bottlePromptingRaw[0] == '0' ? 0 : parseInt(bottlePromptingRaw[1]);
    const sessId = generateAutomatedSessId();

    const painProbDesc = {
        5: 'Low',
        10: 'Medium',
        20: 'High',
        30: 'Very High'
    };
    const painLevelDesc = {
        4: 'Low',
        8: 'Medium',
        10: 'High',
        15: 'Very High'
    };
    let driverComments = `${sessionDuration}m session. `;
    driverComments += painProbability == 0 ? 'No pain tools. ' : `Pain tools ${painProbDesc[painProbability]} probability at a ${painLevelDesc[painIntensity]} level. `;
    driverComments += bottlePromptingMax == 0 ? 'No bottle prompting. ' : 'Bottle prompting used. '

    const sessionConfig = {
        ...automatedDriverConfig,
        verbose: config.verbose,
        bottlePromptingMin: bottlePromptingMin,
        bottlePromptingMax: bottlePromptingMax,
        sessionDuration: sessionDuration,
        minFMDepth: fmPreset,
        maxFMDepth: fmPreset * 3,
        minAMDepth: amPreset,
        maxAMDepth: amPreset * 3,
        minAMDepth2: amPreset2,
        maxAMDepth2: amPreset2 * 3,
        minFrequency: minFrequency,
        maxFrequency: maxFrequency,
        initialFrequency: startFrequency,
        startVolume: startVolume,
        painProbability: painProbability,
        painIntensity: painIntensity,
        proMode: (amPreset2 != 0),
        driverComments: driverComments
    };

    if (config.verbose) logger("[%s] Starting AutomatedDriver with config: %o", sessId, sessionConfig);
    if (electronState.startAutomatedDriver(sessId, sessionConfig)) {
        res.render('automated', { sessId: sessId, sessDuration: sessionConfig.sessionDuration });
    } else {
        res.status(500).send('Failed to start automated driver');
    }
});

// set parameters for new automated driver
app.get('/config-automated-driver', function (req, res) {
    logger('[] %s GET /config-automated-driver', remote_ip(req));
    res.render('cfgautomated');
});

// player page
app.get('/player/:mode/:sessId', function (req, res) {
    const mode = req.params.mode;
    const sessId = req.params.sessId;
    logger('[%s] %s GET /player/%s/%s', sessId, remote_ip(req), mode, sessId);
    if ((mode === 'play' || mode === 'drive') && sessId.length === 10) {
        // joining or driving a session
        const flags = electronState.getSessionFlags(sessId) || { driverName: 'Anonymous' };
        res.render('player', { flags: flags, features: config.features, playlistSession: (config.playlistSession !== undefined && config.playlistSession.sessId == sessId) });
    } else if (mode === 'play' && sessId === 'solo') {
        logger('[] User playing solo');
        // solo play
        res.render('player', { flags: { driverName: 'Yourself' }, features: config.features });
    } else {
        // something went wrong -> 404!
        res.status(404);
        res.send('Not found');
    }
});

// assign callbacks to handle sockets, which is the core
// of the remote driving functionality
io.on('connection', socketHandler(electronState));

// init the server!
app.use(express.static('public'));
server.listen(PORT, () => logger('[] e l e c t r o n initialized and server now listening on port %d', PORT));

if (config.playlistSession !== undefined) {
    logger('[] Starting playlistSession with %o', config.playlistSession);
    electronState.startPlaylistDriver(config.playlistSession);
}

