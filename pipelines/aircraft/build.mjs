// Offline aircraft build: Blender (pipelines/aircraft/build.py) → public/aircraft/b77w_lod{0,1,2}.glb + index.json
// (triangle counts, sha256). Deterministic for a given Blender build. Never run Blender while a dev server is up.
//   node pipelines/aircraft/build.mjs [--out <dir>]      (BLENDER=… to override the binary)
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
export const LOD_DISTANCES = [900, 3500]; // m at a 60° lens: LOD0 nearer than 900 m, LOD1 to 3.5 km, LOD2 beyond
// the fleet classes and the reference type each silhouette is built at (must match FLEET in build.py)
export const FLEET = {
  heavy2: { ref: 'B772', lengthM: 63.7, spanM: 60.9 }, heavy4: { ref: 'B744', lengthM: 70.7, spanM: 64.4 }, narrow: { ref: 'B738', lengthM: 39.5, spanM: 35.8 },
  rearjet: { ref: 'CRJ9', lengthM: 36.2, spanM: 24.9 }, turboprop2: { ref: 'DH8D', lengthM: 32.8, spanM: 28.4 }, turboprop1: { ref: 'PC12', lengthM: 14.4, spanM: 16.3 }, light: { ref: 'C172', lengthM: 8.3, spanM: 11.0 },
};
// a sim type → silhouette class (FAA ACD engine type / weight class / length; rear-engined T-tail types by list)
const REAR = new Set(['B712', 'CRJ2', 'CRJ7', 'CRJ9', 'C56X', 'CL60', 'GLF5', 'MD80', 'MD88', 'MD90', 'E45X', 'E145', 'E135']);
export function fleetClass(t) {
  if (t.engine === 'Jet') { if (t.faaWeight === 'Heavy' || t.faaWeight === 'Super') return t.engines >= 4 ? 'heavy4' : 'heavy2'; if (REAR.has(t.icao)) return 'rearjet'; return t.lengthFt * 0.3048 >= 26 ? 'narrow' : 'rearjet'; }
  if (t.engine === 'Turboprop') return t.engines >= 2 ? 'turboprop2' : 'turboprop1';
  return 'light';
}
export const MODEL = { id: 'b77w', type: 'B77W', name: 'Boeing 777-300ER (generic livery)', lengthM: 73.9, spanM: 64.8, heightM: 18.5, source: 'Boeing D6-58329-2, 777-200LR/-300ER Airplane Characteristics for Airport Planning' };

// triangles and materials of a GLB from its JSON chunk alone (no engine import: the accessor counts are in the JSON)
export function glbStats(buf) {
  const len = buf.readUInt32LE(12), json = JSON.parse(buf.subarray(20, 20 + len).toString('utf8'));
  let triangles = 0, meshes = 0;
  for (const m of json.meshes || []) for (const p of m.primitives) { meshes++; triangles += (p.indices !== undefined ? json.accessors[p.indices].count : json.accessors[p.attributes.POSITION].count) / 3; }
  const pos = (json.meshes || []).flatMap(m => m.primitives.map(p => json.accessors[p.attributes.POSITION]));
  const min = [0, 1, 2].map(i => Math.min(...pos.map(a => a.min[i]))), max = [0, 1, 2].map(i => Math.max(...pos.map(a => a.max[i])));
  return { triangles, meshes, materials: (json.materials || []).map(m => m.name), min, max };
}

export function buildAircraft(out = join(root, 'public/aircraft')) {
  mkdirSync(out, { recursive: true });
  for (const f of readdirSync(out)) if (f.endsWith('.glb') || f === 'index.json') rmSync(join(out, f));
  const blender = process.env.BLENDER || 'blender';
  const r = spawnSync(blender, ['-b', '--factory-startup', '--python', join(root, 'pipelines/aircraft/build.py'), '--', out], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0 || /Traceback|Error:/.test(r.stdout + r.stderr)) { console.error(r.stdout.slice(-3000), r.stderr.slice(-3000)); throw new Error('blender failed'); }
  const index = { format: 'sfo-aircraft/2', lodDistances: LOD_DISTANCES, refFov: 60, blender: (r.stdout.match(/Blender \d\S*/) || [''])[0], model: MODEL,
    frame: 'glTF: x starboard, y up, z aft (nose toward -z = heading 0); origin = ground point under the main gear', lods: [], fleet: {} };
  for (const lod of [0, 1, 2]) {
    const name = `${MODEL.id}_lod${lod}.glb`, buf = readFileSync(join(out, name)), s = glbStats(buf);
    index.lods.push({ name, ...s, sha256: createHash('sha256').update(buf).digest('hex') });
  }
  // the fleet silhouettes (Phase 3): reference dimensions the game scales each type to
  for (const [cls, P] of Object.entries(FLEET)) {
    const lods = [0, 1, 2].map((lod) => { const name = `fleet_${cls}_lod${lod}.glb`, buf = readFileSync(join(out, name)), s = glbStats(buf); return { name, ...s, sha256: createHash('sha256').update(buf).digest('hex') }; });
    index.fleet[cls] = { ...P, lods };
  }
  writeFileSync(join(out, 'index.json'), JSON.stringify(index, null, 1) + '\n');
  return index;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const idx = buildAircraft(arg('--out', join(root, 'public/aircraft')));
  for (const l of [...idx.lods, ...Object.values(idx.fleet).flatMap(f => f.lods)]) console.log(l.name.padEnd(26), l.triangles, 'tris,', l.meshes, 'meshes, extent', l.min.map(v => v.toFixed(1)).join('/'), '→', l.max.map(v => v.toFixed(1)).join('/'));
}
