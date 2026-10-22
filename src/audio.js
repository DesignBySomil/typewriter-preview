/**
 * Pure WebAudio procedural synthesizer for mechanical typewriter acoustics:
 * - Key clack (bandpass noise burst + low chassis thump)
 * - Typebar strike snap (metal slug on rubber platen + delayed escapement click)
 * - Carriage advance tick
 * - Inharmonic brass margin warning bell
 * - Carriage return zip + line-feed ratchet clicks
 */
export class TypewriterAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.noiseBuffer = null;
  }

  init() {
    // iOS fix: Safari/WebKit maps WebAudio to the "ambient" audio session,
    // which is silenced by the hardware mute switch and ringer volume.
    // Opt into the playback session (iOS 17+) so typing is audible like media.
    try {
      if (navigator.audioSession && navigator.audioSession.type !== 'playback') {
        navigator.audioSession.type = 'playback';
      }
    } catch (e) { /* older browsers without the Audio Session API */ }
    if (this.ctx) {
      if (this.ctx.state !== 'running') { try { this.ctx.resume(); } catch (e) { /* ignore */ } }
      return;
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    this.ctx = new AudioCtx();

    const sr = this.ctx.sampleRate;
    this.noiseBuffer = this.ctx.createBuffer(1, sr, sr);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < sr; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    // iOS/Android unlock: start a silent buffer inside the user gesture.
    try {
      const silent = this.ctx.createBuffer(1, 1, 22050);
      const src = this.ctx.createBufferSource();
      src.buffer = silent;
      src.connect(this.ctx.destination);
      src.start(0);
      if (this.ctx.state !== 'running') this.ctx.resume();
    } catch (e) { /* ignore */ }
  }

  toggleMute() {
    this.muted = !this.muted;
    return this.muted;
  }

  playKeyClack(pitchVariance = 1.0) {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;

    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1650 * pitchVariance, now);
    filter.Q.setValueAtTime(3.2, now);

    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(0.24, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.032);

    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(this.ctx.destination);
    noise.start(now);
    noise.stop(now + 0.035);

    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(135 * pitchVariance, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.045);

    const oGain = this.ctx.createGain();
    oGain.gain.setValueAtTime(0.26, now);
    oGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

    osc.connect(oGain);
    oGain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.055);
  }

  playStrikeImpact() {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;

    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;

    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(2600 + Math.random() * 400, now);

    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(0.36, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.022);

    noise.connect(hp);
    hp.connect(nGain);
    nGain.connect(this.ctx.destination);
    noise.start(now);
    noise.stop(now + 0.025);

    const metalOsc = this.ctx.createOscillator();
    metalOsc.type = 'sine';
    metalOsc.frequency.setValueAtTime(3400 + Math.random() * 350, now);
    metalOsc.frequency.exponentialRampToValueAtTime(1100, now + 0.018);

    const mGain = this.ctx.createGain();
    mGain.gain.setValueAtTime(0.13, now);
    mGain.gain.exponentialRampToValueAtTime(0.001, now + 0.02);

    metalOsc.connect(mGain);
    mGain.connect(this.ctx.destination);
    metalOsc.start(now);
    metalOsc.stop(now + 0.022);

    this.playCarriageAdvanceClick(0.024);
  }

  playCarriageAdvanceClick(delay = 0) {
    if (this.muted || !this.ctx) return;
    const t = this.ctx.currentTime + delay;

    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(920, t);
    osc.frequency.exponentialRampToValueAtTime(280, t + 0.015);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.08, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.016);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.018);
  }

  playMarginBell() {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;
    const partials = [2380, 4795, 6820, 9120];
    const amps = [0.24, 0.12, 0.06, 0.03];
    const decays = [0.85, 0.45, 0.25, 0.12];

    partials.forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(amps[i], now + 0.003);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + decays[i]);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + decays[i] + 0.02);
    });
  }

  playCarriageReturn(distanceRatio = 0.6) {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;
    const duration = Math.max(0.18, Math.min(0.45, distanceRatio * 0.42));

    // Line-feed platen ratchet clicks
    for (let i = 0; i < 3; i++) {
      const ct = now + i * 0.024;
      const rOsc = this.ctx.createOscillator();
      rOsc.type = 'sawtooth';
      rOsc.frequency.setValueAtTime(1400 + i * 180, ct);
      const rGain = this.ctx.createGain();
      rGain.gain.setValueAtTime(0.11, ct);
      rGain.gain.exponentialRampToValueAtTime(0.001, ct + 0.015);
      rOsc.connect(rGain);
      rGain.connect(this.ctx.destination);
      rOsc.start(ct);
      rOsc.stop(ct + 0.018);
    }

    // Sliding zip tooth train
    const steps = Math.max(5, Math.floor(duration * 38));
    for (let i = 0; i < steps; i++) {
      const st = now + (i / steps) * duration;
      const clickOsc = this.ctx.createOscillator();
      clickOsc.type = 'triangle';
      clickOsc.frequency.setValueAtTime(680 + (i / steps) * 520, st);

      const cGain = this.ctx.createGain();
      cGain.gain.setValueAtTime(0.05, st);
      cGain.gain.exponentialRampToValueAtTime(0.001, st + 0.01);

      clickOsc.connect(cGain);
      cGain.connect(this.ctx.destination);
      clickOsc.start(st);
      clickOsc.stop(st + 0.012);
    }

    // End-of-travel thud
    const endT = now + duration;
    const thud = this.ctx.createOscillator();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(115, endT);
    thud.frequency.exponentialRampToValueAtTime(36, endT + 0.065);

    const tGain = this.ctx.createGain();
    tGain.gain.setValueAtTime(0.32, endT);
    tGain.gain.exponentialRampToValueAtTime(0.001, endT + 0.07);

    thud.connect(tGain);
    tGain.connect(this.ctx.destination);
    thud.start(endT);
    thud.stop(endT + 0.075);
  }
}
