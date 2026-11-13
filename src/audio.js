// All sound goes through the Web Audio API. Engine, truck, charging and
// impact sounds are synthesised, so the only audio files are the voice lines.
// If a voice file is missing the browser's speech synthesis stands in for it.

const BASE = import.meta.env.BASE_URL;

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.buffers = {};
    this.voiceEnd = 0;
    this.voiceSource = null;
    this.beepAt = 0;
    this.scrapeAt = 0;
  }

  // Must be called from a user gesture (browser autoplay policy).
  init(voiceManifest = {}) {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    const comp = ctx.createDynamicsCompressor();
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain(); // ducked while he is shouting
    this.sfx.connect(this.master);

    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = noise;

    // Electric motor: two detuned oscillators, pitch follows speed.
    this.motorA = this.osc('triangle', 100);
    this.motorB = this.osc('sawtooth', 150);
    this.motorFilter = ctx.createBiquadFilter();
    this.motorFilter.type = 'lowpass';
    this.motorFilter.frequency.value = 900;
    this.motorGain = this.gain(0);
    this.motorA.connect(this.motorFilter);
    const bGain = this.gain(0.25, this.motorFilter);
    this.motorB.connect(bGain);
    this.motorFilter.connect(this.motorGain).connect(this.sfx);

    // Road + wind noise.
    this.roadFilter = ctx.createBiquadFilter();
    this.roadFilter.type = 'bandpass';
    this.roadFilter.frequency.value = 500;
    this.roadFilter.Q.value = 0.4;
    this.roadGain = this.gain(0);
    this.loopNoise().connect(this.roadFilter).connect(this.roadGain).connect(this.sfx);

    // Rail scrape.
    const scrapeFilter = ctx.createBiquadFilter();
    scrapeFilter.type = 'highpass';
    scrapeFilter.frequency.value = 2200;
    this.scrapeGain = this.gain(0);
    this.loopNoise().connect(scrapeFilter).connect(this.scrapeGain).connect(this.sfx);

    // Old V8: saw + sub-octave square through a soft clipper, with a lumpy idle.
    this.truckA = this.osc('sawtooth', 50);
    this.truckB = this.osc('square', 25);
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) curve[i] = Math.tanh(((i / 255) * 2 - 1) * 3);
    shaper.curve = curve;
    const truckFilter = ctx.createBiquadFilter();
    truckFilter.type = 'lowpass';
    truckFilter.frequency.value = 420;
    this.truckLump = this.gain(1);
    this.truckLfo = this.osc('sine', 9);
    const lfoDepth = this.gain(0.35, this.truckLump.gain);
    this.truckLfo.connect(lfoDepth);
    this.truckGain = this.gain(0);
    this.truckPan = ctx.createStereoPanner ? ctx.createStereoPanner() : this.gain(1);
    this.truckA.connect(shaper);
    this.gain(0.6, shaper, this.truckB);
    shaper.connect(truckFilter).connect(this.truckLump).connect(this.truckGain).connect(this.truckPan).connect(this.sfx);

    // Charging hum that climbs with the battery level.
    this.chargeOsc = this.osc('sine', 220);
    this.chargeGain = this.gain(0);
    this.chargeOsc.connect(this.chargeGain).connect(this.sfx);

    this.voiceGain = this.gain(1.25);
    this.voiceGain.connect(this.master);
    this.loadVoices(voiceManifest);
  }

  osc(type, freq) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.start();
    return o;
  }

  gain(value, dest, src) {
    const g = this.ctx.createGain();
    g.gain.value = value;
    if (dest) g.connect(dest);
    if (src) src.connect(g);
    return g;
  }

  loopNoise() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.start();
    return s;
  }

  async loadVoices(manifest) {
    await Promise.all(
      Object.entries(manifest).map(async ([id, file]) => {
        if (!file) return;
        try {
          const res = await fetch(`${BASE}assets/${file}`);
          if (!res.ok) return;
          this.buffers[id] = await this.ctx.decodeAudioData(await res.arrayBuffer());
        } catch {
          /* missing or undecodable: speech synthesis is used instead */
        }
      }),
    );
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.9;
    if (m) window.speechSynthesis?.cancel();
  }

  set(param, value, time = 0.08) {
    param.setTargetAtTime(value, this.ctx.currentTime, time);
  }

  update(s) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const v = Math.abs(s.speed);
    const active = s.active ? 1 : 0;

    this.set(this.motorA.frequency, 90 + v * 17);
    this.set(this.motorB.frequency, (90 + v * 17) * 1.5);
    this.set(this.motorFilter.frequency, 500 + v * 40 + (s.boosting ? 1200 : 0));
    this.set(this.motorGain.gain, active * (0.03 + (s.throttle ? 0.06 : 0.02) * Math.min(1, v / 12) + (s.boosting ? 0.04 : 0)));
    this.set(this.roadFilter.frequency, 300 + v * 22);
    this.set(this.roadGain.gain, active * Math.min(0.2, v * 0.005));
    this.set(this.scrapeGain.gain, active && s.onRail ? 0.12 : 0, 0.03);

    // The truck gets louder as it closes in and pans to the side it is on.
    const near = 1 / (1 + Math.max(0, s.gap) / 22);
    const rpm = 42 + s.chaserSpeed * 1.5;
    this.set(this.truckA.frequency, rpm);
    this.set(this.truckB.frequency, rpm / 2);
    this.set(this.truckLfo.frequency, rpm / 5);
    this.set(this.truckGain.gain, active * (0.02 + 0.5 * near * near));
    if (this.truckPan.pan) this.set(this.truckPan.pan, Math.max(-0.8, Math.min(0.8, s.chaserDx * 0.2)));

    this.set(this.chargeOsc.frequency, 180 + s.battery * 520);
    this.set(this.chargeGain.gain, active && s.charging ? 0.07 + 0.03 * Math.sin(now * 14) : 0, 0.05);

    // Low battery warning blips.
    if (s.active && s.battery < s.lowWarning && !s.charging && now > this.beepAt) {
      this.blip(s.battery <= 0 ? 330 : 660, 0.09, 0.12);
      this.beepAt = now + (s.battery <= 0 ? 0.45 : 0.9);
    }

    this.set(this.sfx.gain, this.voiceBusy() ? 0.55 : 1, 0.15);
  }

  blip(freq, dur, vol, type = 'square') {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    o.connect(g).connect(this.sfx);
    o.start(now);
    o.stop(now + dur + 0.02);
  }

  // Short filtered noise burst plus a low thump.
  hit(kind, strength = 10) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (kind === 'scrape') {
      if (now < this.scrapeAt) return;
      this.scrapeAt = now + 0.25;
    }
    const big = kind === 'barrier' || kind === 'traffic' || kind === 'smash' || kind === 'caught';
    const vol = Math.min(1, (kind === 'smash' ? strength * 0.25 : 0.25 + strength / 45) * (big ? 1 : 0.5));
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(big ? 1800 : 3200, now);
    f.frequency.exponentialRampToValueAtTime(200, now + 0.3);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + (big ? 0.45 : 0.18));
    src.connect(f).connect(g).connect(this.sfx);
    src.start(now, Math.random());
    src.stop(now + 0.5);
    if (big) {
      const o = this.ctx.createOscillator();
      o.frequency.setValueAtTime(110, now);
      o.frequency.exponentialRampToValueAtTime(38, now + 0.25);
      const og = this.ctx.createGain();
      og.gain.setValueAtTime(vol * 0.9, now);
      og.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      o.connect(og).connect(this.sfx);
      o.start(now);
      o.stop(now + 0.32);
    }
  }

  horn() {
    this.blip(370, 0.5, 0.12, 'sawtooth');
    this.blip(466, 0.5, 0.12, 'sawtooth');
  }

  jingle(up = true) {
    const notes = up ? [523, 659, 784, 1047] : [392, 330, 262, 196];
    notes.forEach((f, i) => setTimeout(() => this.blip(f, 0.22, 0.12, 'triangle'), i * 130));
  }

  voiceBusy() {
    if (!this.ctx) return false;
    return this.ctx.currentTime < this.voiceEnd;
  }

  stopVoice() {
    try {
      this.voiceSource?.stop();
    } catch {
      /* already stopped */
    }
    this.voiceSource = null;
    this.voiceEnd = 0;
    window.speechSynthesis?.cancel();
  }

  // Returns how long the line will take, for the subtitle.
  playVoice(line, interrupt = false) {
    const estimate = 0.8 + line.text.length * 0.06;
    if (!this.ctx || this.muted) return estimate;
    if (interrupt) this.stopVoice();

    const buffer = this.buffers[line.id];
    if (buffer) {
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(this.voiceGain);
      src.start();
      this.voiceSource = src;
      this.voiceEnd = this.ctx.currentTime + buffer.duration;
      return buffer.duration + 0.3;
    }

    const synth = window.speechSynthesis;
    if (synth && window.SpeechSynthesisUtterance) {
      const u = new SpeechSynthesisUtterance(line.text);
      const voices = synth.getVoices().filter((v) => v.lang?.startsWith('en'));
      u.voice = voices.find((v) => /male|david|daniel|fred|george|guy/i.test(v.name) && !/female/i.test(v.name)) || voices[0] || null;
      u.lang = 'en-US';
      u.pitch = 0.35;
      u.rate = 1.05;
      u.volume = 1;
      synth.speak(u);
    }
    this.voiceEnd = this.ctx.currentTime + estimate;
    return estimate;
  }
}
