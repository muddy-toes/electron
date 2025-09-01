module.exports = {
    validateAutomatedDriverInput: function (req, res, next) {
        const minFrequency = parseInt(req.body['min-frequency']);
        const maxFrequency = parseInt(req.body['max-frequency']);
        const startFrequency = parseInt(req.body['start-frequency']);
        const startVolume = parseInt(req.body['start-volume']);
        const fmPreset = parseInt(req.body['fm-preset']);
        const amPreset = parseInt(req.body['am-preset']);
        const amPreset2 = parseInt(req.body['am2-preset']);
        const bottlePromptingRaw = req.body['bottle-prompting']?.split(/-/);
        if (bottlePromptingRaw === undefined)
            return res.status(400).send('Invalid input values');

        const bottlePromptingMin = bottlePromptingRaw[0] == '0' ? 0 : parseInt(bottlePromptingRaw[0]);
        const bottlePromptingMax = bottlePromptingRaw[0] == '0' ? 0 : parseInt(bottlePromptingRaw[1]);
        const sessionDuration = parseInt(req.body['session-duration']);
        const painProbability = parseInt(req.body['pain-probability']);
        const painIntensity = parseInt(req.body['pain-intensity']);

        if (isNaN(minFrequency) ||
            isNaN(maxFrequency) ||
            isNaN(startFrequency) ||
            isNaN(startVolume) ||
            isNaN(fmPreset) ||
            isNaN(amPreset) ||
            isNaN(amPreset2) ||
            isNaN(sessionDuration) ||
            isNaN(painProbability) ||
            isNaN(painIntensity) ||
            isNaN(bottlePromptingMin) ||
            isNaN(bottlePromptingMax) ||
            bottlePromptingMin > bottlePromptingMax ||
            (bottlePromptingMin > 0 && bottlePromptingMin < 240) ||
            (bottlePromptingMax > 0 && bottlePromptingMax < 480) ||
            minFrequency < 100 || minFrequency > 3000 ||
            maxFrequency < 100 || maxFrequency > 3000 ||
            startFrequency < 0 || startFrequency < minFrequency || startFrequency > maxFrequency ||
            startVolume < 0 ||
            fmPreset < 0 || fmPreset > 20 ||
            amPreset < 0 || amPreset > 20 ||
            amPreset2 < 0 || amPreset2 > 20 ||
            sessionDuration < 30 || sessionDuration > 60 ||
            painProbability < 0 || painProbability > 30 ||
            painIntensity < 4 || painIntensity > 15 ||
            minFrequency >= maxFrequency
        ) {
            return res.status(400).send('Invalid input values');
        }
        next();
    }
};
