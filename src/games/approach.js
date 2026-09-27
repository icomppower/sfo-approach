// The "approach" game (Harbor Engine registerGame, docs/ENGINE.md D7): a heavy jet flies SFO Tower's recorded ILS 28R
// track (public/flight/approach-28r.json) over the real bay while a director cuts between cameras. The engine draws
// the world; this module owns the aircraft, the airfield markings and lights, the cameras, the HUD and the radio.
import { registerGame, loadLodModel, FRAME } from 'harbor-engine';
import { Vector3, Euler, Quaternion, MathUtils } from 'harbor-engine/src/engine/index.js';
import { buildAirfield } from './airfield.js';
import { buildTimeline, UI } from './radio.js';
import { JetSound } from './jetsound.js';

const SHOTS = ['bridge', 'chase', 'wing', 'cockpit', 'tower', 'spotter', 'rollout'];
const FT = 0.3048;
const base = () => (import.meta.env && import.meta.env.BASE_URL) || '/';

// ---- the track: 1 Hz samples → Catmull-Rom position, shortest-way heading, linear pitch / bank / speeds
class Track {
  constructor(flight) {
    this.f = flight;
    this.s = flight.samples;
    this.duration = this.s.at(-1)[0];
  }
  at(t, out = {}) {
    const s = this.s, n = s.length;
    const tt = Math.max(0, Math.min(this.duration, t));
    let k = Math.min(n - 2, Math.max(0, Math.floor(tt)));
    while (k < n - 2 && s[k + 1][0] <= tt) k++;
    while (k > 0 && s[k][0] > tt) k--;
    const a = s[Math.max(0, k - 1)], b = s[k], c = s[k + 1], d = s[Math.min(n - 1, k + 2)];
    const u = Math.max(0, Math.min(1, (tt - b[0]) / Math.max(1e-6, c[0] - b[0])));
    const cr = (p0, p1, p2, p3) => 0.5 * (2 * p1 + (- p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (- p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);
    out.x = cr(a[1], b[1], c[1], d[1]); out.z = cr(a[2], b[2], c[2], d[2]); out.y = cr(a[3], b[3], c[3], d[3]);
    let dh = ((c[4] - b[4]) % 360 + 540) % 360 - 180;
    out.hdg = (b[4] + dh * u + 360) % 360;
    out.pitch = b[5] + (c[5] - b[5]) * u; out.bank = b[6] + (c[6] - b[6]) * u;
    out.ias = b[7] + (c[7] - b[7]) * u; out.gs = b[8] + (c[8] - b[8]) * u; out.vs = b[9] + (c[9] - b[9]) * u;
    out.dist = b[10] == null ? null : b[10] + ((c[10] ?? b[10]) - b[10]) * u;
    out.ground = b[11] === 1;
    out.t = tt;
    return out;
  }
}

// forward / right / up of the aircraft from its heading (world: x east, z south, y up)
function axes(hdg, pitch, bank, fwd, right, up) {
  const h = hdg * Math.PI / 180;
  fwd.set(Math.sin(h), 0, - Math.cos(h));
  right.set(Math.cos(h), 0, Math.sin(h));
  up.set(0, 1, 0);
  if (pitch) { fwd.y = Math.sin(pitch) * 1; fwd.normalize(); }
  return { fwd, right, up };
}

export class Approach {
  constructor(app, { flight, airport, aircraft, model }) {
    this.app = app;
    this.track = new Track(flight);
    this.flight = flight;
    this.airport = airport;
    this.model = model;
    this.aircraftIndex = aircraft;
    this.timeline = buildTimeline(flight);
    this.lang = (app.qs.get('lang') || (typeof navigator !== 'undefined' && /^zh/i.test(navigator.language) ? 'zh' : 'en')) === 'zh' ? 'zh' : 'en';
    this.speed = app.qs.has('speed') && Number.isFinite(Number(app.qs.get('speed'))) ? Number(app.qs.get('speed')) : 1;
    this.t = Number(app.qs.get('t')) || 0;
    this.auto = true;
    this.paused = false;
    this.shot = app.qs.get('shot') && SHOTS.includes(app.qs.get('shot')) ? app.qs.get('shot') : 'bridge';
    if (app.qs.get('shot')) this.auto = false;
    this.mode = 'shots'; // or 'free'
    this.hudHidden = false;
    this.ended = 0;
    this.pose = {};
    this.fwd = new Vector3(); this.right = new Vector3(); this.up = new Vector3();
    this.camPos = new Vector3(); this.camAt = new Vector3(); this.smoothPos = new Vector3(); this.smoothAt = new Vector3();
    this.lastShot = null; this.lookYaw = 0; this.lookPitch = 0; this.flyYaw = null; this.flyPitch = null;
    this.subtitle = null;
    this._q = new Quaternion(); this._e = new Euler();
    // fixed camera spots (frame metres): the San Mateo Bridge west high-rise, the tower cab, a spotter on the Millbrae shore
    const thr = airport.runways.find((r) => r.id === '10L/28R').ends.find((e) => e.id === '28R');
    const h = thr.hdg * Math.PI / 180, fx = Math.sin(h), fz = - Math.cos(h), rx = Math.cos(h), rz = Math.sin(h); // runway direction (28R heading) and right of it
    this.thr = { x: thr.thr[0], z: thr.thr[1], y: thr.tdzeM, fx, fz, rx, rz };
    this.spots = {
      bridge: new Vector3(8420, 42, 3640),
      tower: new Vector3(model.tower ? model.tower[0] : - 3891, (model.tower ? model.tower[1] : 0) + 64, model.tower ? model.tower[2] : - 310),
      spotter: new Vector3(this.thr.x - fx * 120 - rx * 330, this.thr.y + 3.5, this.thr.z - fz * 120 - rz * 330), // right of the approach = the Millbrae / Burlingame side
    };
    this.jet = app.qs.has('noAudio') ? null : new JetSound();
  }

  // ---- director: which shot at time t (auto), with the cut points on the flight's own events
  autoShot(t) {
    const f = this.flight.summary, tdT = f.touchdownT ?? this.track.duration - 40, thrT = f.thresholdT ?? tdT - 8;
    if (t < 34) return 'bridge';
    if (t < 82) return 'chase';
    if (t < 122) return 'wing';
    if (t < thrT - 42) return 'cockpit';
    if (t < thrT - 8) return 'tower';
    if (t < tdT + 9) return 'spotter';
    return 'rollout';
  }

  // ---- per-frame
  update(dt) {
    const app = this.app, input = app.input;
    this.keys(input);
    // F in the engine turns the free camera off (the walker would take over): treat it as our free/shots toggle
    if (!app.freeCam) { app.setFreeCam(true); this.mode = this.mode === 'free' ? 'shots' : 'free'; if (this.mode === 'free') { this.flyYaw = null; } this.lastShot = null; }
    if (!this.paused && !this.ended) this.t += dt * this.speed;
    if (this.t >= this.track.duration) { this.t = this.track.duration; if (!this.ended) this.ended = performance.now(); }
    if (this.ended && performance.now() - this.ended > 9000) this.restart();
    const p = this.track.at(this.t, this.pose);
    // aircraft pose: yaw = -heading (z south), pitch about x, bank about the fore-aft axis (+ right wing down = -z rotation)
    const m = this.model.group;
    m.position.set(p.x, p.y, p.z);
    m.rotation.set(p.pitch, - p.hdg * Math.PI / 180, - p.bank, 'YXZ');
    m.update(app.camera);
    axes(p.hdg, p.pitch, p.bank, this.fwd, this.right, this.up);
    if (this.mode === 'shots') {
      if (this.auto) this.shot = this.autoShot(this.t);
      this.camera(dt, p);
    }
    this.hud(p);
    if (this.jet) this.jet.update(app.camera.position, m.position, p, dt);
  }

  keys(input) {
    for (let i = 0; i < SHOTS.length; i++) if (input.hit('Digit' + (i + 1)) || input.hit('Numpad' + (i + 1))) { this.shot = SHOTS[i]; this.auto = false; if (this.mode === 'free') { this.mode = 'shots'; } }
    if (input.hit('Digit0') || input.hit('Numpad0')) { this.auto = true; this.mode = 'shots'; }
    if (input.hit('KeyR')) this.restart();
    if (input.hit('KeyP')) this.paused = !this.paused;
    if (input.hit('KeyZ')) { this.lang = this.lang === 'zh' ? 'en' : 'zh'; this.dom.help.textContent = UI[this.lang].help; }
    if (input.hit('KeyH')) { this.hudHidden = !this.hudHidden; this.dom.root.classList.toggle('is-hidden', this.hudHidden); }
    if (input.hit('BracketRight')) this.speed = Math.min(8, this.speed * 2);
    if (input.hit('BracketLeft')) this.speed = Math.max(0.25, this.speed / 2);
  }

  restart() { this.t = 0; this.ended = 0; this.lastShot = null; if (this.mode === 'shots' && !this.app.qs.get('shot')) this.auto = true; this.shownSubs = new Set(); }

  // the camera for the current shot; cuts snap, otherwise the eye and target are smoothed; a mouse / touch drag
  // (the engine's fly camera look) offsets the view
  camera(dt, p) {
    const app = this.app, cam = app.camera, m = this.model.group.position;
    const fly = app.fly;
    if (this.flyYaw === null) { this.flyYaw = fly.yaw; this.flyPitch = fly.pitch; }
    let dy = fly.yaw - this.flyYaw, dp = fly.pitch - this.flyPitch; this.flyYaw = fly.yaw; this.flyPitch = fly.pitch;
    const cut = this.shot !== this.lastShot;
    if (cut) { this.lookYaw = 0; this.lookPitch = 0; dy = 0; dp = 0; }
    this.lookYaw += dy; this.lookPitch = MathUtils.clamp(this.lookPitch + dp, - 1.2, 1.2);
    const pos = this.camPos, at = this.camAt, f = this.fwd, r = this.right;
    let fov = 60, tau = 0.35, rigid = false;
    switch (this.shot) {
      case 'bridge': { pos.copy(this.spots.bridge); at.copy(m); fov = MathUtils.clamp(3000 / Math.max(300, pos.distanceTo(m)), 14, 40); tau = 0.6; break; }
      case 'chase': { pos.copy(m).addScaledVector(f, - 150).addScaledVector(r, 18).add(new Vector3(0, 34, 0)); at.copy(m).addScaledVector(f, 260); fov = 55; break; }
      case 'wing': { pos.copy(m).addScaledVector(r, 62).addScaledVector(f, - 22).add(new Vector3(0, 7, 0)); at.copy(m).addScaledVector(f, 120).addScaledVector(r, - 10); fov = 50; tau = 0.2; break; }
      case 'cockpit': { pos.copy(m).addScaledVector(f, 38.5).addScaledVector(r, - 0.6).add(new Vector3(0, 5.5 + 1.6, 0)); at.copy(pos).addScaledVector(f, 200); at.y -= 200 * Math.tan(0.03 - p.pitch); fov = 68; rigid = true; break; }
      case 'tower': { pos.copy(this.spots.tower); at.copy(m); fov = MathUtils.clamp(4200 / Math.max(200, pos.distanceTo(m)), 7, 34); tau = 0.5; break; }
      case 'spotter': { pos.copy(this.spots.spotter); at.copy(m); at.y -= 4; fov = MathUtils.clamp(1900 / Math.max(120, pos.distanceTo(m)), 22, 50); tau = 0.45; break; }
      case 'rollout': { const k = Math.min(1, Math.max(0, (this.t - (this.flight.summary.touchdownT ?? 0) - 9) / 20)); pos.copy(m).addScaledVector(f, - 60 - 40 * k).addScaledVector(r, 45 + 60 * k).add(new Vector3(0, 12 + 18 * k, 0)); at.copy(m).addScaledVector(f, 30); fov = 48; break; }
    }
    // keep every eye above the ground / water
    const ground = Math.max(app.terrainData.heightAt(pos.x, pos.z), 0) + 2.5;
    if (pos.y < ground) pos.y = ground;
    if (cut || rigid) { this.smoothPos.copy(pos); this.smoothAt.copy(at); } else {
      const k = 1 - Math.exp(- dt / tau);
      this.smoothPos.lerp(pos, k); this.smoothAt.lerp(at, k);
    }
    cam.position.copy(this.smoothPos);
    cam.up.set(0, 1, 0);
    cam.lookAt(this.smoothAt);
    if (this.lookYaw || this.lookPitch) { this._e.setFromQuaternion(cam.quaternion, 'YXZ'); this._e.y += this.lookYaw; this._e.x = MathUtils.clamp(this._e.x + this.lookPitch, - 1.5, 1.5); cam.rotation.copy(this._e); }
    // a touch of bank in the rigid cockpit view
    if (rigid) { this._e.setFromQuaternion(cam.quaternion, 'YXZ'); this._e.z = - p.bank; cam.rotation.copy(this._e); }
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    this.lastShot = this.shot;
  }

  // ---- HUD (DOM the game owns) and subtitles
  buildDom() {
    const root = document.createElement('div');
    root.className = 'ap-hud';
    root.innerHTML = `
      <div class="ap-top"><div class="ap-id"><b></b><span></span></div><div class="ap-shot"><em></em><i></i></div></div>
      <div class="ap-sub"><p></p></div>
      <div class="ap-data"><div><small></small><b class="ap-alt"></b></div><div><small></small><b class="ap-ias"></b></div><div><small></small><b class="ap-vs"></b></div><div><small></small><b class="ap-dist"></b></div><div><small></small><b class="ap-hdg"></b></div></div>
      <div class="ap-help"></div>
      <div class="ap-bar"><i></i></div>
      <div class="ap-touch"><button data-key="Digit0">AUTO</button><button data-key="Digit2">1</button><button data-key="Digit3">2</button><button data-key="Digit4">3</button><button data-key="Digit5">4</button><button data-key="Digit6">5</button><button data-key="KeyR">↻</button><button data-key="KeyZ">中/EN</button></div>`;
    document.body.append(root);
    const q = (s) => root.querySelector(s);
    this.dom = { root, id: q('.ap-id b'), idSub: q('.ap-id span'), shot: q('.ap-shot em'), shotSub: q('.ap-shot i'), sub: q('.ap-sub p'), subBox: q('.ap-sub'),
      alt: q('.ap-alt'), ias: q('.ap-ias'), vs: q('.ap-vs'), dist: q('.ap-dist'), hdg: q('.ap-hdg'), labels: [...root.querySelectorAll('.ap-data small')], help: q('.ap-help'), bar: q('.ap-bar i') };
    this.dom.help.textContent = UI[this.lang].help;
    // on-screen buttons press the same keys (the engine's Input reads keydown / keyup on the window)
    for (const b of root.querySelectorAll('.ap-touch button')) {
      const code = b.dataset.key;
      const press = (e) => { e.preventDefault(); e.stopPropagation(); window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true })); setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true })), 30); };
      b.addEventListener('pointerdown', press);
    }
    this.shownSubs = new Set();
    this.subUntil = 0;
  }

  hud(p) {
    const d = this.dom, L = UI[this.lang], f = this.flight;
    if (!d) return;
    d.id.textContent = `${f.flight.callsign} · ${f.flight.aircraft.type}`;
    d.idSub.textContent = `${L.ils} · ${f.weather.conditions} · ${String(Math.round(f.weather.wind.dir)).padStart(3, '0')}/${Math.round(f.weather.wind.kt)}`;
    d.shot.textContent = this.mode === 'free' ? L.shots.free : L.shots[this.shot];
    d.shotSub.textContent = this.mode === 'free' ? '' : (this.auto ? L.auto : `${SHOTS.indexOf(this.shot) + 1}/7`) + (this.paused ? ' · ' + L.paused : '') + (this.speed !== 1 ? ` · ${this.speed}×` : '');
    const agl = p.y - this.thr.y;
    d.alt.textContent = `${Math.max(0, Math.round((p.y + this.flight.msl) / FT)).toLocaleString()} ${L.ft}`;
    d.ias.textContent = `${Math.round(p.ias)} ${L.kt}`;
    d.vs.textContent = `${p.ground ? 0 : Math.round(p.vs / 50) * 50} ${L.fpm}`;
    d.dist.textContent = p.dist == null || p.dist < 0 ? (p.ground ? `${Math.round(- (p.dist ?? 0) * 6076)} ${L.ft}` : '—') : `${p.dist.toFixed(1)} ${L.nm}`;
    d.hdg.textContent = `${String(Math.round(p.hdg) % 360).padStart(3, '0')}°`;
    [L.alt, L.ias, L.vs, L.dist, L.hdg].forEach((t, i) => { if (d.labels[i].textContent !== t) d.labels[i].textContent = t; });
    d.bar.style.width = `${(100 * this.t / this.track.duration).toFixed(2)}%`;
    // subtitles
    let cur = null;
    for (const s of this.timeline) if (this.t >= s.t && this.t < s.t + s.dur) cur = s;
    if (this.ended) { d.sub.textContent = L.landed; d.subBox.classList.add('is-on'); }
    else if (cur) { const txt = cur.text[this.lang]; if (d.sub.textContent !== txt) d.sub.textContent = txt; d.subBox.classList.add('is-on'); }
    else d.subBox.classList.remove('is-on');
    void agl;
  }

  dispose() { this.dom?.root.remove(); this.jet?.dispose(); }
}

// ---- registration: the title's main.js imports this module before boot()
registerGame('approach', {
  requires: [],
  async init(app) {
    const b = base();
    const [flight, airport, aircraft] = await Promise.all(['flight/approach-28r.json', 'flight/airport.json', 'aircraft/index.json'].map(async (f) => {
      const r = await fetch(b + f); if (!r.ok) throw new Error(`approach: ${f} HTTP ${r.status}`); return r.json();
    }));
    const group = await loadLodModel(aircraft.lods.map((l) => b + 'aircraft/' + l.name), { lodDistances: aircraft.lodDistances, refFov: aircraft.refFov || 60, name: 'aircraft' });
    app.scene.add(group);
    const airfield = buildAirfield(airport, (x, z) => app.terrainData.heightAt(x, z));
    app.scene.add(airfield);
    // the tower's true position when the landmark index has it
    let tower = null;
    try { const lm = app.landmarks?.userData?.index?.landmarks?.find((l) => l.slug === 'sfo-tower'); if (lm) tower = [lm.anchor[0], lm.ground ?? 0, lm.anchor[1]]; } catch {}
    const state = new Approach(app, { flight, airport, aircraft, model: { group, tower } });
    state.airfield = airfield;
    // golden hour unless the URL says otherwise; the engine's own T key runs the day
    if (app.qs.has('time')) app.settings.timeOfDay = Number(app.qs.get('time'));
    else if (app.qs.has('night')) app.settings.timeOfDay = 20.6;
    else app.settings.timeOfDay = 17.55;
    app.setFreeCam(true);
    app.fly.speed = 40;
    if (typeof document !== 'undefined' && document.body) state.buildDom();
    window.__approach = state; // browser checks
    return state;
  },
  update(app, dt, state) { state.update(dt); },
  view(app, state) { return { dispose: () => state.dispose() }; },
});
