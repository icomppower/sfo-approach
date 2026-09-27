// A5 Look (advisory): headless 1920×1080 stills of every director shot at golden hour and at night, written to
// shots/ for human review; the numbers checked are sanity only (non-blank frames, night darker than day).
// --negative: night no darker than day must fail.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { root, gate, readJSON, R } from './lib/common.mjs';

const flight = readJSON('public/flight/approach-28r.json');
const tdT = flight.summary.touchdownT, thrT = flight.summary.thresholdT;
const SHOTS = [['bridge', 12], ['chase', 60], ['wing', 100], ['cockpit', thrT - 30], ['tower', thrT - 20], ['spotter', thrT + 2], ['rollout', tdT + 20]];
function child(args) {
  const r = spawnSync(process.execPath, [join(root, 'gates/lib/render.mjs'), ...args], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, HARBOR_TITLE: root } });
  const line = (r.stdout || '').split('\n').find((l) => l.startsWith('RESULT '));
  if (!line) throw new Error('render crashed: ' + (r.stderr || '').slice(-800));
  return JSON.parse(line.slice(7));
}
function shoot(night, dir) { const out = []; for (const [s, t] of SHOTS) out.push(...child(['--shots', s, '--t', String(t), '--png', dir, ...(night ? ['--night'] : [])]).frames); return out; }
function judge(day, night) {
  const fail = [];
  for (const f of [...day, ...night]) if (!(f.luma > 5 && f.luma < 240)) fail.push(`shot ${f.shot}: mean luma ${R(f.luma, 1)}`);
  const md = day.reduce((s, f) => s + f.luma, 0) / day.length, mn = night.reduce((s, f) => s + f.luma, 0) / night.length;
  console.log(`  day mean luma ${R(md, 1)}, night ${R(mn, 1)}`);
  if (!(mn < md * 0.7)) fail.push(`night (${R(mn, 1)}) is not darker than day (${R(md, 1)})`);
  return fail;
}
gate('A5', () => judge(shoot(false, join(root, 'shots')), shoot(true, join(root, 'shots'))), [
  ['night as bright as day', () => { const d = shoot(false, join(root, '.verify/a5')); return judge(d, d); }],
]);
