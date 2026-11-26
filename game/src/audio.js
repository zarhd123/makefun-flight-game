// Procedural sound, no audio files: a WebAudio engine drone whose pitch follows
// the throttle, wind noise that grows with speed, a chime for each ring, a
// thud for landing and a crunch for a crash. Starts on the first user gesture.
export function createAudio() {
  let ctx = null;
  let engineOsc = null;
  let engineOsc2 = null;
  let engineGain = null;
  let windSrc = null;
  let windGain = null;
  let windFilter = null;
  let started = false;

  function ensure() {
    if (started) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      return;
    }
    started = true;
    // Engine: two detuned sawtooths through a low-pass filter.
    engineOsc = ctx.createOscillator();
    engineOsc.type = 'sawtooth';
    engineOsc.frequency.value = 55;
    engineOsc2 = ctx.createOscillator();
    engineOsc2.type = 'sawtooth';
    engineOsc2.frequency.value = 55.7;
    const engineFilter = ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 420;
    engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    engineOsc.connect(engineFilter);
    engineOsc2.connect(engineFilter);
    engineFilter.connect(engineGain);
    engineGain.connect(ctx.destination);
    engineOsc.start();
    engineOsc2.start();
    // Wind: looped white noise through a band-pass filter.
    const len = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    windSrc = ctx.createBufferSource();
    windSrc.buffer = buffer;
    windSrc.loop = true;
    windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 600;
    windFilter.Q.value = 0.6;
    windGain = ctx.createGain();
    windGain.gain.value = 0;
    windSrc.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(ctx.destination);
    windSrc.start();
  }

  function blip(freq, dur, type, vol, when) {
    if (!ctx) return;
    const t = ctx.currentTime + (when || 0);
    const osc = ctx.createOscillator();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol || 0.2, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  return {
    ensure,
    /** Call every frame with the plane's state. */
    update(state) {
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume();
      const rpm = 40 + state.throttle * 90 + state.speed * 0.35;
      engineOsc.frequency.setTargetAtTime(rpm, ctx.currentTime, 0.08);
      engineOsc2.frequency.setTargetAtTime(rpm * 1.012, ctx.currentTime, 0.08);
      const flying = state.phase === 'flying';
      engineGain.gain.setTargetAtTime(flying ? 0.045 + state.throttle * 0.05 : 0.015, ctx.currentTime, 0.1);
      windGain.gain.setTargetAtTime(flying ? Math.min(0.14, state.speed * 0.0016) : 0, ctx.currentTime, 0.15);
      windFilter.frequency.setTargetAtTime(400 + state.speed * 9, ctx.currentTime, 0.15);
    },
    ring() {
      blip(880, 0.35, 'sine', 0.22);
      blip(1318, 0.5, 'sine', 0.18, 0.07);
    },
    land() {
      blip(140, 0.25, 'triangle', 0.3);
      blip(660, 0.4, 'sine', 0.2, 0.08);
      blip(990, 0.5, 'sine', 0.16, 0.16);
    },
    crash() {
      if (!ctx) return;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      const len = ctx.sampleRate * 0.4;
      const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      src.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.value = 0.5;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 300;
      src.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      src.start(t);
      blip(70, 0.6, 'sine', 0.35);
    },
    click() {
      blip(520, 0.08, 'square', 0.08);
    },
  };
}
