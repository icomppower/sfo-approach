// A2 Flight: the shipped track is the pipeline's output (rebuilt offline, byte-identical), and it is a real ILS 28R:
// on the published glidepath (3.0°, TCH 68 ft, FAA NASR) within ± 60 ft from 8 NM to 1 NM; the threshold crossed
// at 40–100 ft; touchdown 1,000–3,000 ft past the threshold (the touchdown zone); on the ground the aircraft sits on
// the runway (± 0.3 m of the NASR gradient); heading within 5° of the runway inside 6 NM (crab allowed); speed never
// below Vref − 5 before touchdown; no jump over 110 m between 1 s samples; pitch −3°…+8°, bank ≤ 25°; the airport
// file's runway lengths match NASR (± 1 %). --negative: an altitude bias, a gap, a late (long) landing, a heading
// offset and a rebuilt-with-different-seed track must each be caught.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { root, gate, readJSON, R } from './lib/common.mjs';
import { nasr, FT, SFO_TOWER } from '../pipelines/lib/nasr.mjs';
import { toLocal } from '../pipelines/lib/utm.mjs';

const NM = 1852;
const flight = readJSON('public/flight/approach-28r.json'), airport = readJSON('public/flight/airport.json');
const rwEnd = nasr().ends.find((e) => e.id === '28R');
const thr = toLocal(rwEnd.displacedThrLat, rwEnd.displacedThrLon), elev = rwEnd.tdzeFt * FT - flight.msl;
const gsAlt = (nm) => (rwEnd.tdzeFt + rwEnd.tchFt + nm * 6076.1155 * Math.tan(rwEnd.glidePathDeg * Math.PI / 180)) * FT - flight.msl;

function physics(f) {
  const fail = [], req = (ok, m) => { if (!ok) fail.push(m); return ok; };
  const s = f.samples, vApp = f.flight.aircraft.vApp;
  req(s.length > 120 && s.every((q, i) => i === 0 || q[0] === s[i - 1][0] + 1), 'track: samples are not every second');
  let worst = 0, n = 0;
  for (const q of s) { const d = q[10]; if (d == null || d < 1 || d > 8) continue; n++; worst = Math.max(worst, Math.abs(q[3] - gsAlt(d)) / FT); }
  req(n > 100 && worst <= 60, `glidepath: worst deviation ${R(worst, 0)} ft over ${n} samples between 1 and 8 NM (≤ 60 ft)`);
  const th = f.summary.thresholdAgl; req(th != null && th >= 40 && th <= 100, `threshold crossed at ${th} ft AGL (40–100)`);
  const td = f.summary.touchdownFt; req(td != null && td >= 1000 && td <= 3000, `touchdown ${td} ft past the threshold (touchdown zone 1,000–3,000 ft)`);
  const g = s.filter((q) => q[11] === 1);
  req(g.length > 20, 'no rollout samples');
  const slope = (rwEnd.endElevFt - 5.5) * FT / (11870 * FT); // ≈ NASR gradient 28R → 10L end (13 → 5.5 ft)
  let worstG = 0; for (const q of g) { const along = Math.hypot(q[1] - thr[0], q[2] - thr[1]); worstG = Math.max(worstG, Math.abs(q[3] - (elev - slope * along))); }
  req(worstG <= 0.3, `ground: aircraft ${R(worstG)} m off the runway surface while rolling (≤ 0.3 m)`);
  let worstH = 0; for (const q of s) if (q[10] != null && q[10] <= 6 && q[11] === 0) worstH = Math.max(worstH, Math.abs(((q[4] - rwEnd.trueHeading + 540) % 360) - 180));
  req(worstH <= 5, `heading: ${R(worstH, 1)}° off the runway inside 6 NM (≤ 5°)`);
  const slow = s.find((q) => q[11] === 0 && q[7] < vApp - 5); req(!slow, `speed: ${slow && R(slow[7], 0)} kt airborne at t=${slow && slow[0]} (Vref ${vApp})`);
  let jump = 0; for (let i = 1; i < s.length; i++) jump = Math.max(jump, Math.hypot(s[i][1] - s[i - 1][1], s[i][2] - s[i - 1][2], s[i][3] - s[i - 1][3]));
  req(jump <= 110, `continuity: ${R(jump, 0)} m between samples (≤ 110 m)`);
  req(s.every((q) => q[5] >= - 3 * Math.PI / 180 && q[5] <= 8 * Math.PI / 180 && Math.abs(q[6]) <= 25 * Math.PI / 180), 'attitude: pitch or bank out of bounds');
  for (const r of airport.runways) { const [A, B] = r.ends, L = Math.hypot(B.end[0] - A.end[0], B.end[1] - A.end[1]) / FT; req(Math.abs(L - r.lengthFt) / r.lengthFt <= 0.01, `airport: runway ${r.id} ${R(L, 0)} ft in the frame, NASR ${r.lengthFt}`); }
  return fail;
}

function reproducible(seed) {
  const out = join(root, '.verify', 'a2');
  rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
  const r = spawnSync(process.execPath, [join(root, 'pipelines/flight/build.mjs'), '--out', out], { cwd: root, encoding: 'utf8', env: { ...process.env, SFO_TOWER, ...(seed ? { SFO_APPROACH_SEED: seed } : {}) } });
  if (r.status !== 0) return [`pipeline: flight build failed — ${(r.stderr || '').trim().split('\n').slice(-2).join(' ')}`];
  const a = createHash('sha256').update(readFileSync(join(out, 'approach-28r.json'))).digest('hex'), b = createHash('sha256').update(readFileSync(join(root, 'public/flight/approach-28r.json'))).digest('hex');
  return a === b ? [] : ['pipeline: the rebuilt track differs from public/flight/approach-28r.json'];
}

const mutate = (fn) => { const f = structuredClone(flight); fn(f); return physics(f); };
gate('A2', async () => [...physics(flight), ...reproducible()], [
  ['altitude 200 ft high', () => mutate((f) => { for (const q of f.samples) if (q[11] === 0) q[3] += 200 * FT; })],
  ['a 4 s gap', () => mutate((f) => { f.samples.splice(100, 4); })],
  ['touchdown 4,000 ft long', () => mutate((f) => { f.summary.touchdownFt = 4000; })],
  ['heading 8° off', () => mutate((f) => { for (const q of f.samples) if (q[11] === 0) q[4] += 8; })],
  ['rebuilt with another seed', () => reproducible('other')],
]);
