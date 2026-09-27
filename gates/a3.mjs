// A3 Render: the real App, headless Dawn on the M4, on the title's baked data with the approach game:
//  - every director shot at its own moment (eight) shows the aircraft (pixels that change when the model is hidden ≥ 0.02 %
//    of the frame), and the frame is neither black nor blown out;
//  - frame budget caps hold (triangles and draw calls per frame at the fixed shots; calibrated on first run and
//    frozen in SPEC-THRESHOLDS.md at 1.5 × / 1.25 × the measured maximum);
//  - a 1,500-frame real-time pass of the auto-director stays above the fps floor at p95 (target ≥ 30 fps at 1080p,
//    frozen at 0.8 × the calibration) under the GPU memory cap (1.25 × measured), with no console / GPU errors.
// --negative: a hidden aircraft, rendering at 4K (fps), a leaked 1.5 GB of GPU buffers (memory) must each fail.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readThresholds, freeze } from 'harbor-engine/gates/lib/thresholds.mjs';
import { root, gate, readJSON, R } from './lib/common.mjs';

const RENDER = join(root, 'gates/lib/render.mjs');
const flight = readJSON('public/flight/approach-28r.json');
const tdT = flight.summary.touchdownT, thrT = flight.summary.thresholdT;
// each shot at a time inside its own director slot
const SHOTS = [['establish', 10], ['bridge', 48], ['chase', 75], ['wing', 110], ['cockpit', thrT - 30], ['tower', thrT - 20], ['spotter', thrT + 2], ['rollout', tdT + 20]];
const FPS_TARGET = 30;

function child(args) {
  const r = spawnSync(process.execPath, [RENDER, ...args], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, HARBOR_TITLE: root } });
  const line = (r.stdout || '').split('\n').find((l) => l.startsWith('RESULT '));
  if (!line) throw new Error('render crashed: ' + (r.stderr || r.stdout || '').slice(-1200));
  return JSON.parse(line.slice(7));
}
function shotsRun(extra = []) {
  const frames = [];
  for (const [shot, t] of SHOTS) { const r = child(['--shots', shot, '--t', String(t), ...extra]); frames.push(...r.frames); if (r.errors) frames.push({ shot, t, error: r.errorText.join(' | ') }); }
  return frames;
}

function judgeShots(frames, T) {
  const fail = [];
  for (const f of frames) {
    if (f.error) { fail.push(`render: ${f.shot} — ${f.error}`); continue; }
    console.log(`  ${f.shot.padEnd(8)} t=${String(f.t).padStart(3)}  luma ${R(f.luma, 1)}  aircraft ${R(f.aircraftPct, 3)} %  tris ${f.triangles}  draws ${f.draws}  fov ${R(f.fov, 1)}`);
    if (!(f.luma > 12 && f.luma < 235)) fail.push(`frame: ${f.shot} mean luma ${R(f.luma, 1)} (black or blown out)`);
    if (!(f.aircraftPct >= 0.02)) fail.push(`aircraft: not visible in the ${f.shot} shot (${R(f.aircraftPct, 3)} % of pixels change when it is hidden)`);
    if (T['A3.frameTriangles'] && !(f.triangles <= T['A3.frameTriangles'])) fail.push(`budget: ${f.shot} ${f.triangles} triangles, cap ${T['A3.frameTriangles']}`);
    if (T['A3.frameDraws'] && !(f.draws <= T['A3.frameDraws'])) fail.push(`budget: ${f.shot} ${f.draws} draws, cap ${T['A3.frameDraws']}`);
  }
  return fail;
}
function judgeTiming(r, T) {
  const fail = [], fps95 = 1000 / r.timing.p95;
  console.log(`  director pass: ${r.timing.frames} frames — p50 ${R(r.timing.p50, 1)} ms, p95 ${R(r.timing.p95, 1)} ms (${R(fps95, 1)} fps), max ${R(r.timing.max, 1)} ms; GPU memory ${R(r.mem.gpuMB, 0)} MB; errors ${r.errors}`);
  if (r.errors) fail.push(`render: ${r.errors} console/GPU errors (${r.errorText.join(' | ')})`);
  if (!(fps95 >= T['A3.fpsFloor'])) fail.push(`fps: p95 ${R(r.timing.p95, 1)} ms = ${R(fps95, 1)} fps, floor ${T['A3.fpsFloor']}`);
  if (!(r.mem.gpuMB <= T['A3.gpuMemoryMB'])) fail.push(`memory: ${R(r.mem.gpuMB, 0)} MB GPU, cap ${T['A3.gpuMemoryMB']} MB`);
  return fail;
}

// calibration on first run
let T = readThresholds();
const today = new Date().toISOString().slice(0, 10);
if (!('A3.frameTriangles' in T)) {
  const frames = shotsRun();
  const maxT = Math.max(...frames.map((f) => f.triangles || 0)), maxD = Math.max(...frames.map((f) => f.draws || 0));
  freeze('A3.frameTriangles', Math.ceil(maxT * 1.25), `triangles per frame, all passes, 1920×1080 low tier, the eight director shots (gates/a3.mjs); measured max ${maxT} on ${today}; cap = 1.25 × measured`);
  freeze('A3.frameDraws', Math.ceil(maxD * 1.5), `draw calls per frame, same shots; measured max ${maxD} on ${today}; cap = 1.5 × measured`);
}
if (!('A3.fpsFloor' in T)) {
  const r = child(['--shots', 'chase', '--t', '60', '--fps']);
  const fps95 = 1000 / r.timing.p95;
  if (fps95 < FPS_TARGET) { console.log(`A3 FAIL — calibration pass is ${R(fps95, 1)} fps at p95, below the ${FPS_TARGET} fps target; not freezing`); process.exit(1); }
  freeze('A3.fpsFloor', Math.max(FPS_TARGET, Math.floor(0.8 * fps95)), `95th-percentile fps of a 1,500-frame auto-director pass (gates/lib/render.mjs --fps), 1920×1080 low tier, M4 (Metal), CPU+GPU serialised; measured ${R(fps95, 1)} fps on ${today}; floor = max( 30, 0.8 × measured )`);
  freeze('A3.gpuMemoryMB', Math.ceil(r.mem.gpuMB * 1.25), `peak GPU memory (footprint "(graphics)" categories) of the render process over the shots and the director pass; measured ${R(r.mem.gpuMB, 0)} MB on ${today}; cap = 1.25 × measured`);
}
T = readThresholds();

gate('A3', () => [...judgeShots(shotsRun(), T), ...judgeTiming(child(['--shots', 'chase', '--t', '60', '--fps']), T)], [
  ['aircraft hidden', () => judgeShots(shotsRun(['--hide']), T)],
  ['rendering at 4K', () => judgeTiming(child(['--shots', 'chase', '--t', '60', '--fps', '--uhd']), T)],
  ['1.5 GB of leaked GPU buffers', () => judgeTiming(child(['--shots', 'chase', '--t', '60', '--fps', '--leak']), T)],
]);
