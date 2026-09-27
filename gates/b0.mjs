// B0 Fleet: seven Blender silhouettes × 3 LODs in public/aircraft (index.json `fleet`), every one of the sim's types
// mapped to a class in public/sim/fleet.json with its own FAA ACD length and span; each silhouette's own extent
// matches its reference type's published dimensions within 15 %; LODs shrink; the sim's data files in public/sim
// are byte-identical to sfo-tower's pinned derived files. --negative: a type without a class, a silhouette 30 %
// off its reference span, a LOD that grows, a tampered sim data file.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { root, gate, readJSON, R } from './lib/common.mjs';
import { SFO_TOWER } from '../pipelines/lib/nasr.mjs';
import { FILES } from '../pipelines/sim/build.mjs';
import { glbStats } from '../pipelines/aircraft/build.mjs';

const CLASSES = ['heavy2', 'heavy4', 'narrow', 'rearjet', 'turboprop2', 'turboprop1', 'light'];

function check({ index = readJSON('public/aircraft/index.json'), fleet = readJSON('public/sim/fleet.json'), simFiles = {} } = {}) {
  const fail = [], req = (ok, m) => { if (!ok) fail.push(m); return ok; };
  for (const cls of CLASSES) {
    const f = index.fleet?.[cls];
    if (!req(f && f.lods?.length === 3, `fleet: class ${cls} missing or not 3 LODs`)) continue;
    const ref = fleet.types[f.ref];
    req(ref, `fleet: reference type ${f.ref} for ${cls} not in fleet.json`);
    const l0 = f.lods[0], span = l0.max[0] - l0.min[0], len = l0.max[2] - l0.min[2];
    req(Math.abs(span - f.spanM) / f.spanM <= 0.15, `fleet: ${cls} span ${R(span, 1)} m vs reference ${f.spanM} m (> 15 %)`);
    req(Math.abs(len - f.lengthM) / f.lengthM <= 0.15, `fleet: ${cls} length ${R(len, 1)} m vs reference ${f.lengthM} m (> 15 %)`);
    req(l0.triangles > 800 && l0.triangles < 12000, `fleet: ${cls} LOD0 ${l0.triangles} triangles (800–12000)`);
    for (let k = 1; k < 3; k++) req(f.lods[k].triangles < f.lods[k - 1].triangles, `fleet: ${cls} LOD${k} has more triangles than LOD${k - 1}`);
    for (const l of f.lods) { const buf = readFileSync(join(root, 'public/aircraft', l.name)); req(createHash('sha256').update(buf).digest('hex') === l.sha256, `fleet: ${l.name} sha256 differs from the index`); req(glbStats(buf).triangles === l.triangles, `fleet: ${l.name} triangle count differs from the index`); }
  }
  const types = JSON.parse(readFileSync(join(SFO_TOWER, 'data/derived/aircraft.json'), 'utf8')).types;
  for (const t of Object.values(types)) { const m = fleet.types[t.icao]; req(m && CLASSES.includes(m.cls), `fleet: sim type ${t.icao} has no silhouette class`); if (m) req(Math.abs(m.spanM - t.wingspanFt * 0.3048) < 0.2 && Math.abs(m.lengthM - t.lengthFt * 0.3048) < 0.2, `fleet: ${t.icao} dimensions differ from the FAA ACD`); }
  for (const f of FILES) { const a = simFiles[f] ?? readFileSync(join(root, 'public/sim', f)), b = readFileSync(join(SFO_TOWER, 'data/derived', f)); req(createHash('sha256').update(a).digest('hex') === createHash('sha256').update(b).digest('hex'), `sim data: public/sim/${f} differs from sfo-tower's pinned file`); }
  return fail;
}
const mut = (fn) => { const index = structuredClone(readJSON('public/aircraft/index.json')), fleet = structuredClone(readJSON('public/sim/fleet.json')); const o = fn(index, fleet) || {}; return check({ index, fleet, ...o }); };
gate('B0', () => check(), [
  ['a type without a class', () => mut((i, f) => { delete f.types.A320; })],
  ['silhouette 30 % off its reference span', () => mut((i) => { i.fleet.narrow.spanM *= 1.3; })],
  ['a LOD that grows', () => mut((i) => { i.fleet.heavy2.lods[2].triangles = i.fleet.heavy2.lods[1].triangles + 1; })],
  ['tampered sim data file', () => mut(() => ({ simFiles: { 'aircraft.json': Buffer.from('{}') } }))],
]);
