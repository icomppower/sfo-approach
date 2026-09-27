// Headless render of the approach game in the real App (harbor-engine/tools/headless/app.mjs): boots on the title's
// public/, registers the game, jumps the flight to a time and a shot, renders frames, and measures. One App per
// process (the GPU device is global), so gates spawn this as a child:
//   node gates/lib/render.mjs --shots bridge,chase --t 20,60 [--hide] [--uhd] [--night] [--png <dir>] [--fps]
// prints one line: RESULT {...}
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };

export function gpuMemory(pid) {
  const r = spawnSync('footprint', ['-f', 'bytes', String(pid)], { encoding: 'utf8' });
  let gpu = 0, total = 0;
  for (const line of (r.stdout || '').split('\n')) {
    const m = line.match(/^\s*(\d+)\s*B?\s+(\d+)\s*B?\s+(\d+)\s*B?\s+(\d+)\s+(.+)$/);
    if (m && /\(graphics\)/i.test(m[5])) gpu += Number(m[1]);
    const t = line.match(/Footprint:\s*(\d+)\s*B/);
    if (t) total = Number(t[1]);
  }
  return { gpuMB: gpu / 2 ** 20, footprintMB: total / 2 ** 20 };
}

export async function renderRun({ shots, times, hide = false, uhd = false, night = false, png = null, fps = false, leak = false }) {
  process.env.HARBOR_TITLE = root;
  await import('../../src/games/approach.js'); // registers the game (imports harbor-engine from node_modules)
  const { bootApp } = await import('harbor-engine/tools/headless/app.mjs');
  const { writePNG } = await import('harbor-engine/test/headless.mjs');
  const H = await bootApp({ width: uhd ? 3840 : 1920, height: uhd ? 2160 : 1080, query: `?game=approach&noAudio&tier=low${night ? '&night' : ''}` });
  const app = H.app, st = app.game.state;
  let leaked = null;
  if (leak) { leaked = []; for (let i = 0; i < 6; i++) { const b = H.GPU.device.createBuffer({ size: 256 * 2 ** 20, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }); H.GPU.queue.writeBuffer(b, 0, new Uint8Array(256 * 2 ** 20).fill(1)); leaked.push(b); } }
  st.auto = false; st.paused = true;
  const out = [];
  if (png) mkdirSync(png, { recursive: true });
  const stats = () => app.engine.meshRenderer.stats;
  let mem = { gpuMB: 0, footprintMB: 0 };
  for (const shot of shots) for (const t of times) {
    st.shot = shot; st.t = t; st.lastShot = null;
    st.model.group.visible = true;
    H.frames(24, 1 / 30);
    const tri = stats().triangles, draws = stats().draws;
    const a = await H.readPixels();
    st.model.group.visible = false;
    H.frames(3, 1 / 30);
    const b = await H.readPixels();
    st.model.group.visible = !hide;
    H.frames(2, 1 / 30);
    let diff = 0, lum = 0;
    for (let k = 0; k < a.length; k += 4) { lum += (a[k] + a[k + 1] + a[k + 2]) / 3; if (Math.abs(a[k] - b[k]) + Math.abs(a[k + 1] - b[k + 1]) + Math.abs(a[k + 2] - b[k + 2]) > 36) diff++; }
    const n = a.length / 4;
    // with --hide the "with aircraft" frame is really without it: the visibility check must then fail
    const aircraftPx = hide ? 0 : diff;
    if (png) writePNG(join(png, `${shot}-t${t}${night ? '-night' : ''}.png`), H.width, H.height, hide ? b : a);
    out.push({ shot, t, luma: lum / n, aircraftPx, aircraftPct: 100 * aircraftPx / n, triangles: tri, draws, camY: app.camera.position.y, fov: app.camera.fov });
    const m = gpuMemory(process.pid); if (m.gpuMB > mem.gpuMB) mem = m;
  }
  let timing = null;
  if (fps) {
    // a real-time pass of the auto-director at the low tier: frame time = CPU + GPU serialised
    st.auto = true; st.paused = false; st.t = 0; st.lastShot = null;
    const dt = 1 / 60, ms = [];
    for (let i = 0; i < 40; i++) app.frame(dt); await H.settle();
    for (let i = 0; i < 1500; i++) { const t0 = performance.now(); app.frame(dt); await H.settle(); ms.push(performance.now() - t0); if (i % 300 === 150) { const m = gpuMemory(process.pid); if (m.gpuMB > mem.gpuMB) mem = m; } }
    const s = [...ms].sort((p, q) => p - q), q = (f) => s[Math.min(s.length - 1, Math.floor(f * s.length))];
    timing = { frames: ms.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: s.at(-1) };
  }
  return { frames: out, timing, mem, errors: H.errors.length, errorText: H.errors.slice(0, 3), leaked: leaked ? leaked.length : 0 };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const r = await renderRun({ shots: arg('--shots', 'chase').split(','), times: arg('--t', '60').split(',').map(Number), hide: process.argv.includes('--hide'), uhd: process.argv.includes('--uhd'), night: process.argv.includes('--night'), png: arg('--png', null), fps: process.argv.includes('--fps'), leak: process.argv.includes('--leak') });
  console.log('RESULT ' + JSON.stringify(r));
  process.exit(0);
}
