# e l e c t r o n

This is a browser-based waveform generator application that allows one person to control the generated waveforms while an arbitrary number of listeners can access the waveforms in real-time. The application also supports a "solo" mode for individual use.

Please note that this application was built many years ago and its coding practices are severely outdated.

This repository contains both the server (Node.js) and the client (HTML + JS). It makes use of the brilliant p5.js library for audio and visuals generation.

## Technical details

The application is built using Node.js, Express, and Socket.IO. It provides real-time communication between the driver and listeners through WebSockets. When a driver selects parameters for waveform generation, they are transmitted to all connected listeners via socket events. The server stores session information, authentication tokens for drivers, and the last waveform state in memory to keep everyone synchronized. This ensures that new listeners can join an ongoing session and receive the current waveform data immediately upon connection.

## Installation

To install and run the application, simply follow these steps:

1. Clone the repository
2. Run npm install to install the necessary dependencies
3. Start the server with `node index.js`

## Usage

Once the server is running, navigate to the application URL (e.g., http://localhost:5000) in your browser. You will be presented with options to create a session as a driver or join an existing session as a listener.

If you choose to create a session, you will be given a unique session ID that you can share with others who want to listen to the generated waveforms. Listeners can join a session by entering the provided session ID on electron's homepage.

In "solo" mode, users can experiment with waveform generation without sharing it with others. Simply select "play solo" from the homepage to begin.

There is also a feature that allows users to set up an automated session driven by a simple AI.

## Configuration

Copy `config.js-dist` to `config.js` and edit it to specify your site preferences.  Options are documented in the file.

## Upgrading

1. Check config.js-dist for any new settings that should be copied to your config.js file.
2. Run `npm install`

## Cloud deployment

See [DEPLOY.md](DEPLOY.md) for instructions.

## SmartStim4 file support

Electron now supports playback of SS4 files in limited fashion.

I had to add a second Amplitude Modulation section because SS4 has one.  Rather than only show it while playing an SS4 file, I've just let it be a new part of the interface which can be
enabled/disabled with the new "pro mode" button at the very top right of the interface.

If you want to update your electron but don't want to enable SmartStim support or the "pro mode" features, you can disable it by setting the "promode" feature flag to false at the top of index.js.

Based on the > 1000 example files I have from the Stimaddict archive, I've decided not to bother supporting certain features that it seems aren't widely used or would make the UI a mess:

  - Three scripts used a square wave and otherwise it's all sine, so I didn't worry about support for the sine/square hybrid or the uni- and bi-polar waveforms.

  - Volume ramp is supported, but no one ever sets Max or Min values, so I just set the ramp target to 0 or 100 based on whether the ramp rate is negative or positive.  It seems that it gates how far
    it ramps based on the length of time that step is playing.

  - SS4 supports ramping not only for volume but also for every other setting.  I played with supporting this, as you can see partly done in branch all_the_ramps, but it was way too much UI for a
    realtime driver, so I abandoned it.


## Automated Driver Feature

The application includes an Automated Driver feature that generates random changes in waveform parameters at specified intervals. This feature uses a configuration object to manage settings for the automated driver.

Here's an example of the configuration object, which can be found in `automatedDriverConfig.js`:

```javascript
const automatedDriverConfig = {
    startMaxVolumeChange: 2,
    endMaxVolumeChange: 5,
    noChangesProbability: 0.3,
    msBetweenUpdates: 15000,
    painMinShocks: 5,
    painMaxShocks: 15,
    painMinShockLength: 0.05,
    painMaxShockLength: 0.5,
    painMinTimeBetweenShocks: 0.2,
    painMaxTimeBetweenShocks: 1.0
};
```

The configuration parameters are as follows:

- `startMaxVolumeChange`: The maximum volume change that will be allowed at the start of a session. Maximum volume changes are interpolated between `startMaxVolumeChange` and `endMaxVolumeChange` throughout the session. (default: 2).
- `endMaxVolumeChange`: The maximum volume change that will be allowed at the end of a session. Maximum volume changes are interpolated between `startMaxVolumeChange` and `endMaxVolumeChange` throughout the session. (default: 5).
- `noChangesProbability`: The probability of no changes occurring in the waveform parameters during an update interval. (default: 0.3).
- `msBetweenUpdates`: The time in milliseconds between each update of the waveform parameters. (default: 15000).
- `painMinShocks` and `painMaxShocks`: How many shocks will be administered in one go when the optional pain feature kicks in.
- `painMinShockLength` and `painMaxShockLength`: Length of each individual shock when the optional pain feature kicks in.
- `painMinTimeBetweenShocks` and `painMaxTimeBetweenShocks`: Rest between each individual shock when the optional pain feature kicks in.

## Playlist Driver feature

This is an always-running drive that plays session files randomly from a specified directory.

See config.js-dist for config options.

# Emoji Responses feature

Enable `emojiResponses` in config.js to allow riders to set an emoji as their status, updated on the driver's screen.  Can be used in addition to or instead of the classic traffic lights response system.

# DG-Lab Coyote support

Enable `coyote` in config.js to support direct Bluetooth connection to DG-Lab Coyote devices in addition to audio output.

## License

This project is licensed under the MIT License. See the LICENSE file for details.

