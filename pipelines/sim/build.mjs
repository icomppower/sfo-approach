// The live simulation's data for the browser: sfo-tower's derived files (FAA NASR/CIFP, METAR history, BTS traffic
// shape, FAA ACD fleet, capacity profile) copied from the pinned package into public/sim/, plus fleet.json: every
// sim type → silhouette class and its own ACD length / span (the game scales the class model to them).
//   node pipelines/sim/build.mjs      (SFO_TOWER=<path> overrides node_modules/sfo-tower)
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SFO_TOWER } from '../lib/nasr.mjs';
import { fleetClass, FLEET } from '../aircraft/build.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
export const FILES = ['ksfo-airport.json', 'ksfo-procedures.json', 'ksfo-metar.min.json', 'ksfo-traffic.json', 'aircraft.json', 'sfo-capacity.json'];

export function buildSim(out = join(root, 'public/sim')) {
  mkdirSync(out, { recursive: true });
  const files = {};
  for (const f of FILES) { copyFileSync(join(SFO_TOWER, 'data/derived', f), join(out, f)); files[f] = createHash('sha256').update(readFileSync(join(out, f))).digest('hex'); }
  const types = JSON.parse(readFileSync(join(SFO_TOWER, 'data/derived/aircraft.json'), 'utf8')).types;
  const fleet = {};
  for (const t of Object.values(types)) fleet[t.icao] = { cls: fleetClass(t), lengthM: Math.round(t.lengthFt * 0.3048 * 10) / 10, spanM: Math.round(t.wingspanFt * 0.3048 * 10) / 10, heavy: t.faaWeight === 'Heavy' || t.faaWeight === 'Super', model: t.model };
  const pkg = JSON.parse(readFileSync(join(SFO_TOWER, 'package.json'), 'utf8'));
  const index = { format: 'sfo-sim/1', source: 'sfo-tower data/derived (FAA NASR, CIFP, ACD; IEM METAR; BTS)', sfoTower: pkg.version, files, classes: FLEET, types: fleet };
  writeFileSync(join(out, 'fleet.json'), JSON.stringify(index, null, 1) + '\n');
  return index;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const i = buildSim();
  const by = {}; for (const t of Object.values(i.types)) by[t.cls] = (by[t.cls] || 0) + 1;
  console.log('sim data:', Object.keys(i.files).length, 'files;', Object.keys(i.types).length, 'types', JSON.stringify(by));
}
