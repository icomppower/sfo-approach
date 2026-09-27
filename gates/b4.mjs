// B4 Budget: the tower game headless at the low tier with the bot flying a hard shift (20+ aircraft after the
// warm-up): triangles and draw calls per frame under caps calibrated on first run (frozen), the p95 frame under the
// fps floor's period (target ≥ 30 fps at 1080p, frozen at 0.8 × measured), GPU memory under the cap (1.25 ×
// measured), no console / GPU errors. --negative: 4K rendering (fps), a leaked 1.5 GB of GPU buffers (memory), and
// an aircraft cap reported below 20 must each fail.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { readThresholds, freeze } from 'harbor-engine/gates/lib/thresholds.mjs';
import { root, gate, R } from './lib/common.mjs';

const ARGS = ['--seed', 'b4-budget', '--minutes', '12', '--difficulty', 'hard', '--bot', '--fps'];
const FPS_TARGET = 30;
function child(extra = []) {
  const r = spawnSync(process.execPath, [join(root, 'gates/lib/tower-headless.mjs'), ...ARGS, ...extra], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, HARBOR_TITLE: root } });
  const line = (r.stdout || '').split('\n').find((l) => l.startsWith('RESULT '));
  if (!line) throw new Error('headless run crashed: ' + (r.stderr || '').slice(-1200));
  return JSON.parse(line.slice(7));
}
function judge(r, T) {
  const fail = [], fps95 = 1000 / r.timing.p95;
  console.log(`  ${r.maxAc} aircraft at most; tris ${r.maxTri}, draws ${r.maxDraws}; p50 ${R(r.timing.p50, 1)} ms, p95 ${R(r.timing.p95, 1)} ms (${R(fps95, 1)} fps); GPU ${R(r.mem.gpuMB, 0)} MB; errors ${r.errors}`);
  if (!(r.maxAc >= 20)) fail.push(`traffic: only ${r.maxAc} aircraft (need 20+)`);
  if (!(r.maxTri <= T['B4.frameTriangles'])) fail.push(`budget: ${r.maxTri} triangles, cap ${T['B4.frameTriangles']}`);
  if (!(r.maxDraws <= T['B4.frameDraws'])) fail.push(`budget: ${r.maxDraws} draws, cap ${T['B4.frameDraws']}`);
  if (!(fps95 >= T['B4.fpsFloor'])) fail.push(`fps: p95 ${R(fps95, 1)} fps, floor ${T['B4.fpsFloor']}`);
  if (!(r.mem.gpuMB <= T['B4.gpuMemoryMB'])) fail.push(`memory: ${R(r.mem.gpuMB, 0)} MB, cap ${T['B4.gpuMemoryMB']}`);
  if (r.errors) fail.push(`render: ${r.errors} errors (${r.errorText.join(' | ')})`);
  return fail;
}
let T = readThresholds();
if (!('B4.frameTriangles' in T)) {
  const r = child(), fps95 = 1000 / r.timing.p95, today = new Date().toISOString().slice(0, 10);
  if (fps95 < FPS_TARGET) { console.log(`B4 FAIL — calibration is ${R(fps95, 1)} fps at p95, below ${FPS_TARGET}; not freezing`); process.exit(1); }
  freeze('B4.frameTriangles', Math.ceil(r.maxTri * 1.25), `triangles per frame, tower game, hard shift with the bot, 12 min, 1920×1080 low tier; measured max ${r.maxTri} with ${r.maxAc} aircraft on ${today}; cap = 1.25 × measured`);
  freeze('B4.frameDraws', Math.ceil(r.maxDraws * 1.5), `draw calls per frame, same run; measured max ${r.maxDraws} on ${today}; cap = 1.5 × measured`);
  freeze('B4.fpsFloor', Math.max(FPS_TARGET, Math.floor(0.8 * fps95)), `95th-percentile fps of the same run (CPU+GPU serialised, M4 Metal); measured ${R(fps95, 1)} on ${today}; floor = max( 30, 0.8 × measured )`);
  freeze('B4.gpuMemoryMB', Math.ceil(r.mem.gpuMB * 1.25), `peak GPU memory (footprint "(graphics)") of the same run; measured ${R(r.mem.gpuMB, 0)} MB on ${today}; cap = 1.25 × measured`);
  T = readThresholds();
}
gate('B4', () => judge(child(), T), [
  ['rendering at 4K', () => judge(child(['--uhd']), T)],
  ['1.5 GB of leaked GPU buffers', () => judge(child(['--leak']), T)],
  ['a run with fewer than 20 aircraft', () => { const r = child(); r.maxAc = 12; return judge(r, T); }],
]);
