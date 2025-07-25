
Electron now supports playback of ss4 files in limited fashion.

I had to add a second Amplitude Modulation section because SS4 has one.  Rather than only show it while playing
an ss4 file, I've just let it be a new part of the interface.

Based on the > 1000 example files I have from the Stimaddict archive, 
I've decided not to bother supporting certain features that it seems aren't
widely used:

  - Three scripts used a square wave and otherwise it's all sine, so I didn't worry about support for the 
    sine/square hybrid or the uni- and bi-polar waveforms.

  - Volume ramp is supported, but no one ever sets Max or Min values, so I just set the ramp target to 0 or 100
    based on whether the ramp rate is negative or positive.  It seems that it gates how far it ramps based on
    the length of time that step is playing.

  - Currently the volume On, Off, Target, and Offset numbers are ignored.  I plan to support those as they look
    widely used, I just haven't done it yet.

