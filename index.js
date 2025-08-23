const config = {
    // if true, log all actions to console instead of just join/part sessions
    verbose: true,

    // Feature flags.  Set to false to disable.  Accessible in player.ejs via features['name'] and in client js via feature_name
    features: {
        promode: true
    },

    camUrlList: [
        { name: 'eStimStation Stimroom', url: 'https://discord.com/channels/786142403987505182/1309514473157165177', default: true },
        { name: 'eStimStation Sunday Drive', url: 'https://discord.com/channels/786142403987505182/1060818089547157555' },
        { name: 'eStimStation Hangout', url: 'https://discord.com/channels/786142403987505182/1124800414978674828' },
        { name: 'Ask your driver', message: 'Ask your driver' }
    ],

    promodeKeys: [
        'amType2', 'amDepth2', 'amFreq2', 'tOn', 'tOff', 'tAtt'
    ]
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
    logger("%s GET /", remote_ip(req));
    res.render('index', { publicSessions: electronState.getPublicSessions() });
});

// actually start new automated driver
app.use('/start-automated-driver', inputValidationMiddleware.validateAutomatedDriverInput);
app.post('/start-automated-driver', function (req, res) {
    logger("%s GET /start-automated-driver", remote_ip(req));
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

    if (config.verbose) logger("Starting AutomatedDriver with config: %o", sessionConfig);
    if (electronState.startAutomatedDriver(sessId, sessionConfig)) {
        res.render('automated', { sessId: sessId, sessDuration: sessionConfig.sessionDuration });
    } else {
        res.status(500).send('Failed to start automated driver');
    }
});

// set parameters for new automated driver
app.get('/config-automated-driver', function (req, res) {
    logger('%s GET /config-automated-driver', remote_ip(req));
    res.render('cfgautomated');
});

// player page
app.get('/player/:mode/:sessId', function (req, res) {
    const mode = req.params.mode;
    const sessId = req.params.sessId;
    logger('%s GET /player/%s/%s', remote_ip(req), mode, sessId);
    if ((mode === 'play' || mode === 'drive') && sessId.length === 10) {
        // joining or driving a session
        const flags = electronState.getSessionFlags(sessId) || { driverName: 'Anonymous' };
        res.render('player', { flags: flags, features: config.features, camUrlList: config.camUrlList });
    } else if (mode === 'play' && sessId === 'solo') {
        logger('User playing solo');
        // solo play
        res.render('player', { flags: { driverName: 'Yourself' }, features: config.features, camUrlList: [] });
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
server.listen(PORT, () => logger(`e l e c t r o n initialized and server now listening on port ${PORT}`));
