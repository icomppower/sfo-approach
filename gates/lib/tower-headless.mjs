// Headless runs of the tower game in the real App (one App per process): boots with ?game=tower&play, steps the
// shift by driving app.frame() with dt = 1 s of sim per call (timeScale 1), optionally runs a command script through
// the game's own select()/send() path, and reports positions, events, the replay hash, and render stats.
//   node gates/lib/tower-headless.mjs --seed s --minutes 10 [--difficulty hard] [--bot] [--script scripted] [--fps] [--uhd] [--leak]
// prints RESULT {...}
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gpuMemory } from './render.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };

// Phase 1's scripted flow (sfo-tower test/scripted.mjs): vector the first arrival onto the ILS 28R and land it;
// line the first departure up and launch it. Returns the commands issued as [ t, id, cmd ] for replay in pure Node.
export function scriptedFlow(shift, issue) {
  const log = [];
  const arr = [...shift.aircraft.values()].find((a) => a.kind === 'ARR');
  const dep = [...shift.aircraft.values()].find((a) => a.kind === 'DEP');
  const cmd = (a, c) => { const r = issue(a.id, c); log.push([shift.t, a.id, c, r.ok, r.readback]); return r; };
  cmd(arr, { type: 'altitude', alt: 6000 }); cmd(arr, { type: 'speed', ias: 210 });
  let phase = 0;
  return { arr, dep, log, tick() {
    const rw = shift.airport.ends['28R'];
    if (phase === 0 && shift.t >= 30) { phase = 1; cmd(arr, { type: 'heading', hdg: (rw.finalCourse + 30) % 360, turn: 'R' }); cmd(arr, { type: 'approach', runway: '28R', kind: 'ILS' }); cmd(arr, { type: 'altitude', alt: 4000 }); }
    if (phase === 1 && arr.mode === 'FINAL') { phase = 2; cmd(arr, { type: 'land', runway: '28R' }); if (dep) cmd(dep, { type: 'holdshort' }); if (dep) cmd(dep, { type: 'luaw' }); }
    if (phase === 2 && arr.onGround && dep && dep.mode === 'LUAW') { phase = 3; cmd(dep, { type: 'takeoff' }); }
    if (phase === 3 && dep && dep.mode === 'SID' && !dep.flags.dir) { dep.flags.dir = 1; phase = 4; cmd(dep, { type: 'direct', fix: dep.route?.[dep.route.length - 1]?.fix }); cmd(dep, { type: 'goaround' }); }
  } };
}

export async function towerRun({ seed = 'tower-gate', minutes = 10, difficulty = 'normal', weather = 'clear', bot = false, script = null, fps = false, uhd = false, leak = false }) {
  process.env.HARBOR_TITLE = root;
  await import('../../src/games/tower.js');
  const { bootApp } = await import('harbor-engine/tools/headless/app.mjs');
  const H = await bootApp({ width: uhd ? 3840 : 1920, height: uhd ? 2160 : 1080, query: `?game=tower&noAudio&tier=low&play&seed=${seed}&difficulty=${difficulty}&weather=${weather}${bot ? '&bot=1' : ''}` });
  const app = H.app, st = app.game.state, s = st.shift;
  let leaked = null;
  if (leak) { leaked = []; for (let i = 0; i < 6; i++) { const b = H.GPU.device.createBuffer({ size: 256 * 2 ** 20, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }); H.GPU.queue.writeBuffer(b, 0, new Uint8Array(256 * 2 ** 20).fill(1)); leaked.push(b); } }
  const flow = script ? scriptedFlow(s, (id, c) => { st.select(id); return st.send(c); }) : null;
  const worst = { pos: 0, hdg: 0 }, samples = [];
  const stats = () => app.engine.meshRenderer.stats;
  let maxTri = 0, maxDraws = 0, maxAc = 0, mem = { gpuMB: 0, footprintMB: 0 };
  const ms = [];
  const total = minutes * 60;
  for (let i = 0; i < total; i++) {
    if (flow) flow.tick();
    const t0 = performance.now();
    app.frame(1); // one sim second per frame: acc reaches 1 → exactly one shift.step(1)
    if (fps) await H.settle();
    ms.push(performance.now() - t0);
    // the mesh of every aircraft sits where the sim says (at frac 1 the pose equals the current sim state)
    for (const [id, m] of st.meshes) {
      const a = s.aircraft.get(id); if (!a || !m.cur) continue;
      const want = st.state(a), g = m.group;
      const d = Math.hypot(g.position.x - want.x, g.position.z - want.z, g.position.y - want.y);
      const h = Math.abs(((-g.rotation.y * 180 / Math.PI - st.gridOffset - a.hdg) % 360 + 540) % 360 - 180);
      worst.pos = Math.max(worst.pos, d); worst.hdg = Math.max(worst.hdg, h);
    }
    maxTri = Math.max(maxTri, stats().triangles); maxDraws = Math.max(maxDraws, stats().draws); maxAc = Math.max(maxAc, [...s.aircraft.values()].filter((a) => !a.done).length);
    if (i % 120 === 60) { const m = gpuMemory(process.pid); if (m.gpuMB > mem.gpuMB) mem = m; samples.push({ t: s.t, aircraft: maxAc, tris: stats().triangles, draws: stats().draws }); }
  }
  const sorted = [...ms].sort((a, b) => a - b), q = (f) => sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))];
  const events = s.events.filter((e) => !['FIX', 'SPAWN'].includes(e.type)).map((e) => ({ t: e.t, type: e.type, ac: e.ac, ...(e.runway ? { runway: e.runway } : {}) }));
  return { t: s.t, hash: s._hash, worst, maxTri, maxDraws, maxAc, mem, timing: { frames: ms.length, p50: q(0.5), p95: q(0.95), max: sorted.at(-1) }, events, commands: flow ? flow.log : [], score: s.scoring.summary(), errors: H.errors.length, errorText: H.errors.slice(0, 3), leaked: leaked ? leaked.length : 0 };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const r = await towerRun({ seed: arg('--seed', 'tower-gate'), minutes: Number(arg('--minutes', 10)), difficulty: arg('--difficulty', 'normal'), weather: arg('--weather', 'clear'), bot: process.argv.includes('--bot'), script: arg('--script', null), fps: process.argv.includes('--fps'), uhd: process.argv.includes('--uhd'), leak: process.argv.includes('--leak') });
  console.log('RESULT ' + JSON.stringify(r));
  process.exit(0);
}
