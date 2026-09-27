// The "tower" game (Phase 3, SPEC B): SFO Tower's simulation runs live in the map. You sit in the cab; every sim
// aircraft flies in the 3D world with a data tag; tap a tag, give it Phase 1's commands from Phase 1's command bar;
// a radar-scope inset (Phase 1's scope) covers the airspace the window cannot. The sim is read-only to this module:
// it is stepped once per sim second and commanded only through shift.command(), so the replay hash is Phase 1's.
import { registerGame, Material } from 'harbor-engine';
import { Vector3, Euler, MathUtils } from 'harbor-engine/src/engine/index.js';
import { Shift } from 'sfo-tower/sim/shift.js';
import { Bot } from 'sfo-tower/sim/bot.js';
import { MODES } from 'sfo-tower/sim/aircraft.js';
import { Scope } from 'sfo-tower/view/scope.js';
import { Radio } from 'sfo-tower/view/audio.js';
import { STRINGS } from 'sfo-tower/view/i18n.js';
import { buildAirfield } from './airfield.js';
import { Fleet } from './fleet.js';
import { utm } from '../lib/utm-core.js';
import map from '../../map.json';

const FT = 0.3048, NM = 1852, G = 9.80665, KT = 0.514444;
const base = () => (import.meta.env && import.meta.env.BASE_URL) || '/';
const EXTRA = {
  en: { follow: 'Follow', cab: 'Tower cab', radar: 'Radar', watch: 'Watch the approach', control: 'Control the tower', mode: 'Camera', zoomIn: 'Zoom +', zoomOut: 'Zoom −', keys3d: 'Drag to look · wheel to zoom · V follow the selected aircraft · F free camera · X radar · Z 中文', shift: 'Shift' },
  zh: { follow: '跟隨', cab: '塔台', radar: '雷達', watch: '觀看進場', control: '指揮塔台', mode: '鏡頭', zoomIn: '放大', zoomOut: '縮小', keys3d: '拖曳環視 · 滾輪縮放 · V 跟隨所選飛機 · F 自由攝影機 · X 雷達 · Z English', shift: '值班' },
};

function el(tag, attrs = {}, ...kids) { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'html') e.innerHTML = v; else e.setAttribute(k, v); } for (const k of kids) e.append(k); return e; }

export class Tower {
  constructor(app, { data, airport, fleet, airfield, simIndex }) {
    this.app = app; this.data = data; this.airport = airport; this.fleet = fleet; this.airfield = airfield;
    this.lang = (app.qs.get('lang') || (typeof navigator !== 'undefined' && /^zh/i.test(navigator.language || '') ? 'zh' : 'en')) === 'zh' ? 'zh' : 'en';
    this.t = (k) => STRINGS[this.lang][k] ?? EXTRA[this.lang][k] ?? STRINGS.en[k] ?? EXTRA.en[k] ?? k;
    // sim tangent plane (NM, origin at the ARP, x east y north) → frame: through lat/lon and UTM, so the grid is exact
    const ap = data.airport.nasr, U = utm(map.frame.utmZone);
    this.U = U;
    const oE = map.frame.originE, oN = map.frame.originN;
    this.k = Math.cos(ap.lat * Math.PI / 180);
    this.toFrame = (x, y) => { const lat = ap.lat + y / 60, lon = ap.lon + x / (this.k * 60); const [E, N] = U.toUTM(lat, lon); return [E - oE, oN - N]; };
    const a0 = this.toFrame(0, 0), a1 = this.toFrame(0, 1);
    this.gridOffset = Math.atan2(a1[0] - a0[0], -(a1[1] - a0[1])) * 180 / Math.PI; // grid bearing of true north
    this.msl = airport.msl;
    this.selected = null; this.timeScale = 1; this.paused = true; this.acc = 0; this.eventIdx = 0; this.conflicts = []; this.picker = null;
    this.meshes = new Map(); // ac.id → { group, prev, cur, bank, pitch }
    this.radio = new Radio();
    this.camMode = 'cab'; // cab | follow | free
    this.yaw = 0; this.pitch = -0.05; this.fov = 40; this.flyYaw = null;
    const lm = app.landmarks?.userData?.index?.landmarks?.find((l) => l.slug === 'sfo-tower');
    this.cab = new Vector3(lm ? lm.anchor[0] : -3619, (lm ? lm.ground : 2) + 64.5, lm ? lm.anchor[1] : -378);
    this.shift = null; this.bot = null;
    this._v = new Vector3(); this._e = new Euler();
  }

  // ---------------- shift lifecycle
  start(opts) {
    this.radio.init();
    const shift = this.shift = new Shift(this.data, { seed: opts.seed, difficulty: opts.difficulty, weather: opts.weather, durationMin: opts.durationMin, assist: opts.assist });
    this.bot = this.app.qs.has('bot') ? new Bot(shift) : null;
    this.eventIdx = 0; this.selected = null; this.acc = 0; this.paused = false; this.conflicts = [];
    for (const m of this.meshes.values()) this.app.scene.remove(m.group); this.meshes.clear();
    if (this.dom) { this.scope = new Scope(this.dom.scope, shift, { range: 30, assist: shift.assist }); this.scope.center = { x: 6, y: -4 }; this.dom.menu.classList.add('hidden'); this.dom.end.classList.add('hidden'); }
    // the world's clock and weather follow the METAR window: local hour at the shift start, haze from visibility,
    // clouds from the ceiling
    const localH = ((shift.weather.t0 / 3600 - 8) % 24 + 24) % 24;
    this.hour0 = this.app.qs.has('time') ? Number(this.app.qs.get('time')) : localH;
    this.applyWeather();
    if (this.app.qs.has('ff')) { const n = +this.app.qs.get('ff') || 60; for (let i = 0; i < n; i++) { this.bot?.tick(); shift.step(1); } }
    this.afterStep(true);
    if (this.dom) { this.scope.resize(); this.renderCmdBar(); this.updateHud(); }
    // look toward the 28 thresholds from the cab
    const thr = this.airport.runways.find((r) => r.id === '10L/28R').ends.find((e) => e.id === '28R').thr;
    this.yaw = Math.atan2(-(thr[0] - this.cab.x), -(thr[1] - this.cab.z)); this.pitch = -0.06; this.fov = 40;
  }
  applyWeather() {
    const app = this.app, w = this.shift.weather.current;
    const visKm = (w.vis ?? 10) * 1.609;
    if (app.haze) app.haze.density.value = MathUtils.clamp(16 / Math.max(0.8, visKm), 0.5, 3.5);
    if (app.clouds) app.clouds.coverage.value = w.conditions === 'VISUAL' ? (w.ceil ? 0.45 : 0.25) : w.conditions === 'MARGINAL' ? 0.7 : 0.92;
  }
  endShift() {
    this.paused = true; if (!this.dom) return;
    const s = this.shift, sc = s.scoring.summary(), e = this.dom.end; e.innerHTML = '';
    const row = (k, v, cls = '') => el('div', { class: 'row' }, el('label', {}, this.t(k)), el('b', { class: cls }, String(v)));
    e.append(el('div', { class: 'card' }, el('h1', {}, sc.gameOver ? this.t('collision') : this.t('shiftOver')), el('h2', {}, this.t('summary')),
      row('score', sc.score), row('landed', sc.LANDED), row('departed', sc.DEPARTED), row('losses', sc.SEP_LOSS, sc.SEP_LOSS ? 'bad' : ''), row('wake', sc.WAKE), row('incursions', sc.RUNWAY_INCURSION), row('crossings', sc.CROSSING_CONFLICT), row('goarounds', sc.GO_AROUND), row('delay', sc.delayMin + ' ' + this.t('minutes')),
      el('div', { class: 'actions' }, el('button', { class: 'primary', onclick: () => { e.classList.add('hidden'); this.dom.menu.classList.remove('hidden'); this.paused = true; } }, this.t('again')))));
    e.classList.remove('hidden'); this.paused = true;
  }

  // ---------------- per frame
  update(dt) {
    const app = this.app, s = this.shift;
    if (typeof document !== 'undefined' && document.pointerLockElement) document.exitPointerLock?.(); // the cab needs a cursor for tags and buttons
    if (!app.freeCam) { app.setFreeCam(true); this.camMode = this.camMode === 'free' ? 'cab' : 'free'; this.flyYaw = null; if (this.dom) this.dom.cam.textContent = this.t(this.camMode === 'free' ? 'mode' : this.camMode); }
    app.settings.timeSpeed = 0; // the shift's own clock drives the day (Phase 1's T key = take-off)
    if (!s) { this.camera(dt); return; }
    if (!this.paused && !s.finished && !s.gameOver) {
      this.acc += dt * this.timeScale;
      let steps = 0;
      while (this.acc >= 1 && steps++ < 8) { this.acc -= 1; this.bot?.tick(); s.step(1); this.afterStep(); }
      if (s.finished || s.gameOver) { this.drainEvents(); this.endShift(); }
    }
    const frac = this.paused ? 0 : Math.min(1, this.acc);
    this.poseAircraft(frac);
    this.camera(dt);
    this.computeConflicts();
    if (this.dom) {
      this.tags(); this.drawScope(frac); this.updateHud();
      if (this.selected && !s.aircraft.get(this.selected)) { this.selected = null; this.renderCmdBar(); }
      else if (this.selected) this.refreshSelInfo();
    }
    // the day runs with the shift; the fixed exposure that suits golden hour blows out the midday sun, so pull it
    // down towards solar noon (−0.9 EV at 12:30, none by 17:30)
    const h = (this.hour0 + s.t / 3600) % 24;
    app.settings.timeOfDay = h;
    app.settings.exposure = 0.55 * Math.pow(2, -0.9 * MathUtils.clamp(1 - Math.abs(h - 12.5) / 5, 0, 1));
  }
  // after every sim step: keep the previous and current state of every aircraft for interpolation; events
  afterStep(first = false) {
    const s = this.shift;
    for (const a of s.aircraft.values()) {
      let m = this.meshes.get(a.id);
      if (!m) { const group = this.fleet.instance(a.type); this.app.scene.add(group); m = { group, prev: null, cur: null, bank: 0, pitch: 0, ac: a }; this.meshes.set(a.id, m); }
      m.prev = first || !m.cur ? this.state(a) : m.cur; m.cur = this.state(a); m.ac = a;
    }
    for (const [id, m] of this.meshes) if (!s.aircraft.has(id)) { this.app.scene.remove(m.group); this.meshes.delete(id); }
    this.drainEvents();
  }
  state(a) {
    const [x, z] = this.toFrame(a.x, a.y);
    const y = a.onGround ? this.app.terrainData.heightAt(x, z) : a.alt * FT - this.msl;
    return { x, y, z, hdg: a.hdg, alt: a.alt, ias: a.ias, gs: a.gs || a.ias, vs: a.vs, ground: a.onGround, mode: a.mode, t: this.shift.t };
  }
  poseAircraft(frac) {
    const cam = this.app.camera;
    for (const m of this.meshes.values()) {
      const p = m.prev, c = m.cur; if (!c) continue;
      const g = m.group, a = m.ac;
      // ground aircraft that only appeared (queue) sit still; airborne ones move between the two sim states
      const x = p.x + (c.x - p.x) * frac, z = p.z + (c.z - p.z) * frac, y = p.y + (c.y - p.y) * frac;
      let dh = ((c.hdg - p.hdg) % 360 + 540) % 360 - 180; const hdg = p.hdg + dh * frac;
      g.position.set(x, y, z);
      // attitude: flight-path angle + angle of attack; climbing departures nose-high; bank from the heading rate
      const v = Math.max(30, c.gs) * KT, gamma = Math.atan2(c.vs * FT / 60, v);
      let pitch;
      if (c.ground) pitch = a.mode === MODES.TAKEOFF && c.ias > a.perf.vR * 0.9 ? 6 * Math.PI / 180 : 0;
      else if (c.vs > 300) pitch = Math.min(14 * Math.PI / 180, gamma + 5 * Math.PI / 180);
      else pitch = gamma + Math.min(8, 5.5 * Math.pow(a.perf.vApp / Math.max(c.ias, a.perf.vApp), 2)) * Math.PI / 180;
      m.pitch += (pitch - m.pitch) * 0.08;
      const want = c.ground ? 0 : Math.atan2((dh * Math.PI / 180) * v, G);
      m.bank += (MathUtils.clamp(want, -0.45, 0.45) - m.bank) * 0.04;
      g.rotation.set(m.pitch, -(hdg + this.gridOffset) * Math.PI / 180, -m.bank, 'YXZ');
      g.visible = !a.done || a.mode === MODES.LANDED;
      this.fleet.updateLod(g, cam);
    }
  }

  // ---------------- camera: cab (look around, zoom), follow the selection, or the engine's free camera
  camera(dt) {
    const app = this.app, cam = app.camera, fly = app.fly;
    if (fly.flight) { fly.flight = null; this.flyYaw = null; }
    if (this.flyYaw === null) { this.flyYaw = fly.yaw; this.flyPitch = fly.pitch; }
    const dy = fly.yaw - this.flyYaw, dp = fly.pitch - this.flyPitch; this.flyYaw = fly.yaw; this.flyPitch = fly.pitch;
    const wheel = app.input.consumeWheel();
    if (this.camMode === 'free') return;
    const sens = this.fov / 60;
    this.yaw += dy * sens; this.pitch = MathUtils.clamp(this.pitch + dp * sens, -1.2, 1.2);
    if (wheel) this.fov = MathUtils.clamp(this.fov * Math.pow(1.18, wheel), 3.5, 75);
    if (this.zoomStep) { this.fov = MathUtils.clamp(this.fov * Math.pow(1.4, this.zoomStep), 3.5, 75); this.zoomStep = 0; }
    const sel = this.selected && this.meshes.get(this.selected);
    if (this.camMode === 'follow' && sel) {
      const g = sel.group, h = -g.rotation.y; const fx = Math.sin(h), fz = -Math.cos(h);
      const L = Math.max(30, sel.ac.perf ? 60 : 60);
      this._v.set(g.position.x - fx * L * 2.2, g.position.y + L * 0.5, g.position.z - fz * L * 2.2);
      const ground = Math.max(app.terrainData.heightAt(this._v.x, this._v.z), 0) + 3; if (this._v.y < ground) this._v.y = ground;
      cam.position.lerp(this._v, 1 - Math.exp(-dt * 3));
      cam.up.set(0, 1, 0); cam.lookAt(g.position.x + fx * L, g.position.y, g.position.z + fz * L);
      this._e.setFromQuaternion(cam.quaternion, 'YXZ'); this._e.y += this.yaw * 0; cam.rotation.copy(this._e);
      if (Math.abs(cam.fov - 50) > 0.01) { cam.fov = 50; cam.updateProjectionMatrix(); }
      return;
    }
    cam.position.copy(this.cab);
    cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
    if (this.airfield) { const lens = cam.fov / 60; for (const c of this.airfield.children) if (c.material?.uniforms?.lens) c.material.uniforms.lens.value = lens; }
  }

  // ---------------- tags: DOM labels projected from the aircraft, decluttered by vertical stacking
  tags() {
    const cam = this.app.camera, W = window.innerWidth, H = window.innerHeight, layer = this.dom.tags;
    cam.updateMatrixWorld(); cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    const placed = [];
    for (const [id, m] of this.meshes) {
      const a = m.ac; let tag = this.tagEls.get(id);
      const hidden = a.done || a.mode === MODES.QUEUE;
      if (!tag) { tag = el('div', { class: 'tw-tag', 'data-ac': id }, el('b'), el('span'), el('i')); tag.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.select(id); }); layer.append(tag); this.tagEls.set(id, tag); }
      if (hidden) { tag.style.display = 'none'; continue; }
      this._v.set(m.group.position.x, m.group.position.y + Math.max(6, m.group.userData.spanM * 0.3), m.group.position.z).project(cam);
      if (this._v.z > 1 || this._v.x < -1.1 || this._v.x > 1.1 || this._v.y < -1.1 || this._v.y > 1.1) { tag.style.display = 'none'; continue; }
      let px = (this._v.x + 1) / 2 * W, py = (1 - this._v.y) / 2 * H - 14;
      const d = cam.position.distanceTo(m.group.position);
      const sel = this.selected === id;
      tag.className = 'tw-tag' + (a.kind === 'ARR' ? ' arr' : ' dep') + (sel ? ' sel' : '') + (d > 12000 ? ' far' : '');
      const alt = Math.round(a.alt / 100).toString().padStart(3, '0'), spd = Math.round(a.gs || a.ias);
      const l3 = a.onGround ? (a.mode === MODES.LUAW ? 'LUAW' : a.mode === MODES.TAKEOFF ? 'ROLL' : a.mode === MODES.LANDED ? 'TAXI' : 'RWY') : `${alt} ${spd}${a.mode === MODES.FINAL ? ' F' + (a.finalDistNm ?? 0).toFixed(0) : a.mode === MODES.APPROACH ? ' APP' : a.mode === MODES.GOAROUND ? ' GA' : ''}`;
      tag.firstChild.textContent = a.callsign; tag.children[1].textContent = `${a.type}/${a.cwt} ${a.runway ?? ''}`; tag.children[2].textContent = l3;
      // declutter: stack tags whose boxes overlap
      const w = 92, h = 40;
      for (let guard = 0; guard < 8; guard++) { const hit = placed.find((q) => Math.abs(q.x - px) < w && Math.abs(q.y - py) < h); if (!hit) break; py = hit.y + h; }
      placed.push({ x: px, y: py });
      tag.style.display = ''; tag.style.transform = `translate(${px.toFixed(0)}px, ${py.toFixed(0)}px)`;
    }
    for (const [id, tag] of this.tagEls) if (!this.meshes.has(id)) { tag.remove(); this.tagEls.delete(id); }
  }
  select(id) { this.selected = id; this.picker = null; if (this.dom) this.renderCmdBar(); this.radio.click(); if (this.scope) this.scope.selected = id; }

  // ---------------- Phase 1's scope as an inset, conflicts (assist)
  drawScope(frac) {
    if (!this.scope || this.dom.scopeWrap.classList.contains('hidden')) return;
    const s = this.shift, localHour = Math.floor(((s.weather.t0 + s.t) / 3600 - 8) % 24 + 24) % 24;
    this.scope.look = { night: localHour >= 19 || localHour < 6, fog: s.weather.current.conditions !== 'VISUAL' && s.weather.current.fog, localHour: String(localHour).padStart(2, '0') + ':00' };
    this.scope.selected = this.selected;
    if (this.scope.w !== this.dom.scope.clientWidth) this.scope.resize();
    this.scope.draw(frac, this.conflicts);
  }
  computeConflicts() {
    const s = this.shift, out = []; if (!s.assist) { this.conflicts = out; return; }
    const acs = [...s.aircraft.values()].filter((a) => !a.done && !a.onGround && a.mode !== MODES.QUEUE);
    for (let i = 0; i < acs.length; i++) for (let j = i + 1; j < acs.length; j++) {
      const a = acs[i], b = acs[j]; if (Math.abs(a.alt - b.alt) > 1500) continue;
      const va = { x: Math.sin(a.hdg * Math.PI / 180) * a.gs / 3600, y: Math.cos(a.hdg * Math.PI / 180) * a.gs / 3600 }, vb = { x: Math.sin(b.hdg * Math.PI / 180) * b.gs / 3600, y: Math.cos(b.hdg * Math.PI / 180) * b.gs / 3600 };
      const dx = b.x - a.x, dy = b.y - a.y, dvx = vb.x - va.x, dvy = vb.y - va.y; const v2 = dvx * dvx + dvy * dvy; let tc = v2 > 1e-9 ? -(dx * dvx + dy * dvy) / v2 : 0; tc = Math.max(0, Math.min(60, tc));
      const dmin = Math.hypot(dx + dvx * tc, dy + dvy * tc), dnow = Math.hypot(dx, dy);
      const bothFinal = a.mode === MODES.FINAL && b.mode === MODES.FINAL && s.airport.sameOrCloseParallel(a.runway, b.runway) && s.weather.current.visualOK;
      if (dnow < 3 && Math.abs(a.alt - b.alt) < 950 && !bothFinal) out.push([a, b, 'loss']); else if (dmin < 3 && !bothFinal && Math.abs(a.alt - b.alt) < 950) out.push([a, b, 'predict']);
    }
    this.conflicts = out;
  }

  // ---------------- events → ticker and radio (Phase 1's drainEvents)
  drainEvents() {
    const s = this.shift; if (!this.dom) { this.eventIdx = s.events.length; return; } const tick = this.dom.ticker;
    for (const e of s.events.slice(this.eventIdx)) {
      if (e.type === 'COMMAND') { const a = s.aircraft.get(e.ac); if (a?.lastReadback) { tick.innerHTML = `<span class="rb">${a.lastReadback}</span>`; this.radio.readback(a.lastReadback); } }
      else if (['SEP_LOSS', 'WAKE', 'RUNWAY_INCURSION', 'CROSSING_CONFLICT', 'COLLISION'].includes(e.type)) { const a = s.aircraft.get(e.ac), b = s.aircraft.get(e.other); tick.innerHTML = `<span class="alert">${e.type.replace('_', ' ')}: ${a?.callsign ?? ''} ${b ? '/ ' + b.callsign : ''} ${e.nm != null ? e.nm + ' NM (' + e.reqNm + ' req)' : ''} ${e.how ?? ''}</span>`; this.radio.alert(); }
      else if (e.type === 'LANDED' || e.type === 'DEPARTED') this.radio.chime();
      else if (e.type === 'GO_AROUND') { const a = s.aircraft.get(e.ac); tick.innerHTML = `<span class="alert">${a?.callsign ?? ''} going around — ${e.reason}</span>`; }
    }
    this.eventIdx = s.events.length;
  }

  // ---------------- DOM: HUD, command bar, pickers, menu (ported from Phase 1's view/main.js)
  buildDom() {
    const t = this.t, root = el('div', { class: 'tw-game' });
    root.append(
      el('div', { id: 'tw-hud' },
        el('span', { class: 'stat', id: 'tw-clock' }, '00:00:00'), el('span', { class: 'stat', id: 'tw-score' }), el('span', { class: 'stat ok', id: 'tw-landed' }), el('span', { class: 'stat ok opt', id: 'tw-dep' }), el('span', { class: 'stat bad', id: 'tw-loss' }),
        el('span', { class: 'stat opt', id: 'tw-cond' }), el('span', { id: 'tw-atis' }), el('span', { class: 'spacer' }),
        el('button', { id: 'tw-speed1', class: 'active', onclick: () => this.setTimeScale(1) }, '1×'), el('button', { id: 'tw-speed2', onclick: () => this.setTimeScale(2) }, '2×'), el('button', { id: 'tw-speed4', onclick: () => this.setTimeScale(4) }, '4×'),
        el('button', { id: 'tw-pause', onclick: () => this.togglePause() }, t('pause')), el('button', { id: 'tw-cam', onclick: () => this.cycleCam() }, t('cab')), el('button', { id: 'tw-radar', onclick: () => this.toggleRadar() }, t('radar')),
        el('button', { id: 'tw-zin', onclick: () => { this.zoomStep = -1; } }, '+'), el('button', { id: 'tw-zout', onclick: () => { this.zoomStep = 1; } }, '−'), el('button', { id: 'tw-mute', onclick: () => this.toggleMute() }, '🔊'), el('button', { id: 'tw-lang', onclick: () => this.setLang(this.lang === 'en' ? 'zh' : 'en') }, t('language'))),
      el('div', { id: 'tw-tags' }),
      el('div', { id: 'tw-ticker' }),
      el('div', { id: 'tw-scopeWrap' }, el('canvas', { id: 'tw-scope' }), el('div', { id: 'tw-range' }, ...[15, 30, 45].map((r) => el('button', { onclick: () => this.setRange(r), 'data-range': r, class: r === 30 ? 'active' : '' }, r)))),
      el('div', { id: 'tw-cmdbar' }, el('div', { class: 'sel', id: 'tw-selInfo' }, el('span', { class: 'dim' }, t('select'))), el('div', { id: 'tw-cmdRow' }), el('div', { id: 'tw-picker' })),
      el('div', { id: 'tw-menu', class: 'overlay' }),
      el('div', { id: 'tw-end', class: 'overlay hidden' }),
    );
    document.body.append(root);
    const q = (id) => root.querySelector('#' + id);
    this.dom = { root, tags: q('tw-tags'), ticker: q('tw-ticker'), scope: q('tw-scope'), scopeWrap: q('tw-scopeWrap'), cmdRow: q('tw-cmdRow'), picker: q('tw-picker'), selInfo: q('tw-selInfo'), menu: q('tw-menu'), end: q('tw-end'), clock: q('tw-clock'), score: q('tw-score'), landed: q('tw-landed'), dep: q('tw-dep'), loss: q('tw-loss'), cond: q('tw-cond'), atis: q('tw-atis'), pause: q('tw-pause'), cam: q('tw-cam'), mute: q('tw-mute') };
    this.tagEls = new Map();
    this.dom.scope.addEventListener('pointerdown', (e) => { if (!this.scope) return; const r = e.currentTarget.getBoundingClientRect(); const a = this.scope.hit((e.clientX - r.left), (e.clientY - r.top)); if (a) this.select(a.id); e.stopPropagation(); });
    this.dom.scope.addEventListener('wheel', (e) => { e.preventDefault(); e.stopPropagation(); if (this.scope) this.setRange(Math.max(10, Math.min(60, this.scope.range * (e.deltaY > 0 ? 1.2 : 0.83)))); }, { passive: false });
    for (const stop of [root.querySelector('#tw-hud'), root.querySelector('#tw-cmdbar'), this.dom.scopeWrap, this.dom.menu, this.dom.end]) { stop.addEventListener('pointerdown', (e) => e.stopPropagation()); stop.addEventListener('wheel', (e) => e.stopPropagation()); }
    window.addEventListener('keydown', (e) => this.onKey(e));
    this.menuDom();
  }
  menuDom() {
    const t = this.t, m = this.dom.menu, qs = this.app.qs; m.innerHTML = '';
    const opts = this.opts = this.opts || { difficulty: qs.get('difficulty') ?? 'normal', weather: qs.get('weather') ?? 'auto', seed: qs.get('seed') ?? String(Math.floor(Math.random() * 90000) + 10000), assist: true, durationMin: +(qs.get('minutes') ?? 30) };
    const seg = (key, values, labels) => { const box = el('div', { class: 'seg' }); for (const v of values) box.append(el('button', { class: String(opts[key]) === String(v) ? 'active' : '', 'data-opt': key, 'data-val': v, onclick: (e) => { opts[key] = v; for (const b of box.children) b.classList.toggle('active', b === e.currentTarget); } }, labels[v])); return box; };
    const seedInput = el('input', { id: 'tw-seed', value: opts.seed, oninput: (e) => { opts.seed = e.target.value; } });
    const help = el('div', { class: 'hidden', id: 'tw-help' }, el('p', {}, t('about')), el('h2', {}, t('tutorialTitle')), el('p', {}, t('tut1')), el('p', {}, t('tut2')), el('p', {}, t('tut3')), el('p', {}, t('keys')), el('p', {}, t('keys3d')));
    m.append(el('div', { class: 'card' },
      el('h1', {}, '🛩️ ' + t('title') + ' 3D'), el('p', {}, t('subtitle')),
      el('div', { class: 'actions' }, el('button', { id: 'tw-start', class: 'primary', onclick: () => this.start(opts) }, t('start')), el('button', { onclick: () => this.setLang(this.lang === 'en' ? 'zh' : 'en') }, t('language')), el('button', { onclick: () => help.classList.toggle('hidden') }, '?')),
      el('div', { class: 'row' }, el('label', {}, t('difficulty')), seg('difficulty', ['easy', 'normal', 'hard'], { easy: t('easy'), normal: t('normal'), hard: t('hard') })),
      el('div', { class: 'row' }, el('label', {}, t('weather')), seg('weather', ['auto', 'clear', 'fog', 'storm'], { auto: t('auto'), clear: t('clear'), fog: t('fog'), storm: t('storm') })),
      el('div', { class: 'row' }, el('label', {}, t('assist')), seg('assist', [true, false], { true: t('on'), false: t('off') })),
      el('div', { class: 'row' }, el('label', {}, t('seed')), seedInput, seg('durationMin', [30, 60], { 30: '30 ' + t('minutes'), 60: '60 ' + t('minutes') })),
      help, el('p', {}, el('a', { href: '?game=approach' }, t('watch')))));
  }
  setLang(l) { this.lang = l; try { localStorage.setItem('sfo-lang', l); } catch {} this.menuDom(); this.renderCmdBar(); const t = this.t; this.dom.pause.textContent = this.paused ? t('resume') : t('pause'); this.dom.cam.textContent = t(this.camMode === 'cab' ? 'cab' : this.camMode === 'follow' ? 'follow' : 'mode'); this.dom.root.querySelector('#tw-radar').textContent = t('radar'); this.dom.root.querySelector('#tw-lang').textContent = t('language'); }
  fmtClock(sec) { const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; }
  updateHud() {
    const s = this.shift, d = this.dom, t = this.t; if (!s) return; const sc = s.scoring.summary();
    d.clock.textContent = this.fmtClock(s.t); d.score.innerHTML = `${t('score')} <b>${sc.score}</b>`; d.landed.innerHTML = `${t('landed')} <b>${sc.LANDED}</b>`; d.dep.innerHTML = `${t('departed')} <b>${sc.DEPARTED}</b>`;
    const losses = sc.SEP_LOSS + sc.WAKE + sc.RUNWAY_INCURSION + sc.CROSSING_CONFLICT; d.loss.innerHTML = `${t('losses')} <b>${losses}</b>`; d.loss.classList.toggle('bad', losses > 0);
    d.cond.innerHTML = `<b>${s.weather.current.conditions}</b> ${s.config.id}`; d.atis.textContent = s.weather.atis();
  }
  setTimeScale(x) { this.timeScale = x; for (const v of [1, 2, 4]) this.dom.root.querySelector('#tw-speed' + v).classList.toggle('active', v === x); }
  togglePause() { if (!this.shift) return; this.paused = !this.paused; this.dom.pause.textContent = this.paused ? this.t('resume') : this.t('pause'); }
  toggleMute() { this.radio.setMuted(!this.radio.muted); this.dom.mute.textContent = this.radio.muted ? '🔇' : '🔊'; }
  toggleRadar() { this.dom.scopeWrap.classList.toggle('hidden'); }
  cycleCam() { const order = ['cab', 'follow']; this.camMode = order[(order.indexOf(this.camMode) + 1) % order.length]; this.dom.cam.textContent = this.t(this.camMode); }
  setRange(r) { if (!this.scope) return; this.scope.range = r; for (const b of this.dom.root.querySelectorAll('#tw-range button')) b.classList.toggle('active', +b.dataset.range === Math.round(r)); }
  selectedAc() { return this.selected && this.shift ? this.shift.aircraft.get(this.selected) : null; }
  refreshSelInfo() { const a = this.selectedAc(); if (!a) return; const t = this.t; const mode = a.onGround ? a.mode : `${a.mode}${a.mode === MODES.FINAL ? ' ' + (a.finalDistNm ?? 0).toFixed(1) + ' NM' : ''}`; this.dom.selInfo.innerHTML = `<b>${a.callsign}</b> <span>${a.type}/${a.cwt} ${a.kind === 'ARR' ? t('arrivals') : t('departures')} ${a.runway ?? ''}</span> <span class="dim">${mode} · ${Math.round(a.alt)} ft → ${a.tgt.alt} · ${Math.round(a.ias)} kt · hdg ${Math.round(a.hdg)}°</span>`; }
  renderCmdBar() {
    const a = this.selectedAc(), row = this.dom.cmdRow, t = this.t; row.innerHTML = ''; this.dom.picker.classList.remove('open'); this.dom.picker.innerHTML = '';
    if (!a) { this.dom.selInfo.innerHTML = `<span class="dim">${t('select')}</span>`; return; }
    this.refreshSelInfo();
    const btn = (key, label, fn, cls = '') => row.append(el('button', { 'data-cmd': key, class: cls, onclick: fn }, label));
    const air = !a.onGround && a.mode !== MODES.TAKEOFF;
    if (air) { btn('heading', t('hdg'), () => this.openPicker('heading')); btn('altitude', t('alt'), () => this.openPicker('altitude')); btn('speed', t('spd'), () => this.openPicker('speed')); }
    if (a.kind === 'ARR' && air) { btn('approach', t('apch'), () => this.openPicker('approach')); btn('land', t('land'), () => this.send({ type: 'land', runway: a.runway }), 'primary'); btn('goaround', t('ga'), () => this.send({ type: 'goaround' })); }
    if (a.kind === 'DEP' && (a.mode === MODES.QUEUE || a.mode === MODES.LUAW)) { btn('luaw', t('luaw'), () => this.send({ type: 'luaw' })); btn('takeoff', t('takeoff'), () => this.send({ type: 'takeoff' }), 'primary'); btn('holdshort', t('hold'), () => this.send({ type: 'holdshort' })); }
  }
  openPicker(kind) {
    const a = this.selectedAc(); if (!a) return; const p = this.dom.picker, t = this.t; p.innerHTML = ''; p.classList.add('open'); this.picker = kind;
    const b = (label, fn, cls = '') => p.append(el('button', { class: cls, 'data-pick': label, onclick: fn }, label));
    if (kind === 'heading') { for (const d of [-30, -10, 10, 30]) b((d > 0 ? '+' : '') + d + '°', () => this.send({ type: 'heading', hdg: ((Math.round(a.hdg) + d) % 360 + 360) % 360, turn: d < 0 ? 'L' : 'R' })); const inp = el('input', { type: 'number', min: 1, max: 360, placeholder: t('hdg'), 'data-pick': 'input' }); inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') this.send({ type: 'heading', hdg: +inp.value }); }); p.append(inp); b(t('apply'), () => this.send({ type: 'heading', hdg: +inp.value })); }
    if (kind === 'altitude') { for (const alt of [3000, 4000, 5000, 6000, 7000, 8000, 10000]) b((alt / 1000) + 'k', () => this.send({ type: 'altitude', alt }), a.tgt.alt === alt ? 'active' : ''); }
    if (kind === 'speed') { for (const v of [160, 170, 180, 190, 210, 250]) if (v >= a.perf.vApp && v <= a.perf.vMax) b(v + ' kt', () => this.send({ type: 'speed', ias: v })); b(t('resumeSpeed'), () => this.send({ type: 'speed', ias: null })); }
    if (kind === 'approach') { const s = this.shift; for (const rwy of s.config.arrivals) { const e = s.airport.ends[rwy]; if (e.ils) b(`${t('ils')} ${rwy}`, () => this.send({ type: 'approach', runway: rwy, kind: 'ILS' })); else b(`${t('rnav')} ${rwy}`, () => this.send({ type: 'approach', runway: rwy, kind: 'RNAV' })); if (s.weather.current.visualOK) b(`${t('visual')} ${rwy}`, () => this.send({ type: 'approach', runway: rwy, kind: 'VISUAL' })); } }
    b(t('cancel'), () => { p.classList.remove('open'); p.innerHTML = ''; this.picker = null; });
  }
  send(cmd) {
    const a = this.selectedAc(); if (!a) return null; const r = this.shift.command(a.id, cmd);
    if (!r.ok) { if (this.dom) this.dom.ticker.innerHTML = `<span class="alert">${this.t('unable')}: ${r.readback}</span>`; this.radio.unable(); } else this.drainEvents();
    if (this.dom) { this.dom.picker.classList.remove('open'); this.dom.picker.innerHTML = ''; this.renderCmdBar(); } this.picker = null; return r;
  }
  onKey(e) {
    if (e.target.tagName === 'INPUT') return; const k = e.key.toLowerCase();
    if (k === 'z') { this.setLang(this.lang === 'en' ? 'zh' : 'en'); return; }
    if (k === 'x') { this.toggleRadar(); return; }
    if (k === 'v') { this.cycleCam(); return; }
    if (!this.shift) return;
    if (k === ' ') { this.togglePause(); e.preventDefault(); return; } if (k === '1' || k === '2' || k === '4') return this.setTimeScale(+k); if (k === 'escape') { this.selected = null; this.renderCmdBar(); return; }
    const a = this.selectedAc(); if (!a) return;
    if (this.camMode === 'free' && 'asw'.includes(k)) return; // WASD flies the free camera
    const map = { h: () => this.openPicker('heading'), a: () => this.openPicker('altitude'), s: () => this.openPicker('speed'), c: () => this.openPicker('approach'), l: () => this.send({ type: 'land', runway: a.runway }), g: () => this.send({ type: 'goaround' }), u: () => this.send({ type: 'luaw' }), t: () => this.send({ type: 'takeoff' }), w: () => this.send({ type: 'holdshort' }) };
    if (map[k]) { map[k](); e.preventDefault(); }
  }
  dispose() { this.dom?.root.remove(); for (const m of this.meshes.values()) this.app.scene.remove(m.group); }
}

async function loadSim(b) {
  const get = (f) => fetch(`${b}sim/${f}`).then((r) => { if (!r.ok) throw new Error(f + ' ' + r.status); return r.json(); });
  const [airport, procedures, metarMin, traffic, aircraft, capacity, fleet] = await Promise.all(['ksfo-airport.json', 'ksfo-procedures.json', 'ksfo-metar.min.json', 'ksfo-traffic.json', 'aircraft.json', 'sfo-capacity.json', 'fleet.json'].map(get));
  const metar = { ...metarMin, records: metarMin.records.map(([tt, wd, ws, gust, vis, ceil, wx, temp, dew, altim, cat]) => ({ t: tt, wd, ws, gust, vis, ceil, wx: wx ? wx.split(' ') : [], temp, dew, altim, cat, raw: '' })) };
  return { data: { airport, procedures, metar, traffic, aircraft, capacity }, simIndex: fleet };
}

registerGame('tower', {
  requires: [],
  async init(app) {
    const b = base();
    const [{ data, simIndex }, airport, aircraftIndex] = await Promise.all([loadSim(b), fetch(b + 'flight/airport.json').then((r) => r.json()), fetch(b + 'aircraft/index.json').then((r) => r.json())]);
    const fleet = await new Fleet().load(b, aircraftIndex, simIndex);
    const airfield = buildAirfield(airport, (x, z) => app.terrainData.heightAt(x, z));
    app.scene.add(airfield);
    const state = new Tower(app, { data, airport, fleet, airfield, simIndex });
    if (app.qs.has('time')) app.settings.timeOfDay = Number(app.qs.get('time')); else app.settings.timeOfDay = 14;
    app.setFreeCam(true);
    app.fly.speed = 40;
    if (typeof document !== 'undefined' && document.body) state.buildDom(); else state.dom = null;
    if (app.qs.has('play')) state.start(state.opts || { difficulty: app.qs.get('difficulty') ?? 'normal', weather: app.qs.get('weather') ?? 'auto', seed: app.qs.get('seed') ?? 'tower', assist: true, durationMin: +(app.qs.get('minutes') ?? 30) });
    window.__tower = state;
    return state;
  },
  update(app, dt, state) { state.update(dt); },
  view(app, state) { return { dispose: () => state.dispose() }; },
});
