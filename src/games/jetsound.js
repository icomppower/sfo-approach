// Jet noise for the approach: filtered noise (fan / turbulence broadband) plus a low rumble, level and brightness
// by distance from the camera, a little louder in the flight-deck view. Plain Web Audio, created on first use (the
// engine resumes audio on the start click; this context starts on the first frame after that gesture).
export class JetSound {
  constructor() { this.ctx = null; this.tried = false; }
  start() {
    if (this.ctx || this.tried) return;
    this.tried = true;
    try {
      const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const sr = ctx.sampleRate, buf = ctx.createBuffer(1, sr * 4, sr), d = buf.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11; }
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const lp = this.lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 800; lp.Q.value = 0.7;
      const bp = this.bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 2.5;
      const g = this.gain = ctx.createGain(); g.gain.value = 0;
      const gb = this.gainB = ctx.createGain(); gb.gain.value = 0;
      src.connect(lp).connect(g).connect(ctx.destination);
      src.connect(bp).connect(gb).connect(ctx.destination);
      src.start();
    } catch { this.ctx = null; }
  }
  update(camPos, acPos, pose, dt) {
    if (!this.ctx) { this.start(); if (!this.ctx) return; }
    if (this.ctx.state === 'suspended') { this.ctx.resume().catch(() => {}); return; }
    const d = Math.max(20, camPos.distanceTo(acPos));
    const thrust = pose.ground ? (pose.ias > 60 ? 1.0 : 0.25) : 0.45 + 0.4 * Math.max(0, (pose.ias - 140) / 60);
    const level = Math.min(1, 380 / d) * thrust;
    const t = this.ctx.currentTime;
    this.gain.gain.setTargetAtTime(level * 0.9, t, 0.15);
    this.gainB.gain.setTargetAtTime(level * 0.25 * Math.min(1, 150 / d), t, 0.15);
    this.lp.frequency.setTargetAtTime(300 + 2500 * Math.min(1, 200 / d), t, 0.2);
  }
  dispose() { try { this.ctx?.close(); } catch {} }
}
