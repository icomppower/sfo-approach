// A0 Data: every source in pipelines/data/sources.mjs is cached with its checksum, its licence is in sources.json and
// CREDITS.md, and the rasters and extracts are the right shape for the 24 km slice: 4000 × 4000 elevation and
// bathymetry at 6 m, the NAIP mosaic, the OSM extracts (buildings, the aerodrome, the tower way, the bridge ways),
// the tide datums (MSL and NAVD88), and sfo-tower's FAA data (NASR runway ends, the B77W record) are reachable.
// --negative: a bad checksum, a licence missing from CREDITS.md, a truncated OSM extract, a datum file without
// NAVD88 and a raster of the wrong size must each be caught.
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readTiff } from 'harbor-engine/tools/geo/tiff.mjs';
import { root, gate, readJSON } from './lib/common.mjs';
import { SOURCES, slice } from '../pipelines/data/sources.mjs';
import { nasr, SFO_TOWER } from '../pipelines/lib/nasr.mjs';

const RAW = join(root, 'data/raw');
const LICENCE_WORD = (f) => /osm/.test(f) ? 'ODbL' : 'Public domain';

function check({ raw = RAW, credits = readFileSync(join(root, 'CREDITS.md'), 'utf8'), patch = {}, skipChecksum = false } = {}) {
  const fail = [], req = (ok, m) => { if (!ok) fail.push(m); return ok; };
  const file = (f) => patch[f] !== undefined ? patch[f] : readFileSync(join(raw, f));
  const manPath = join(raw, 'MANIFEST.sha256');
  if (!req(existsSync(manPath), 'MANIFEST.sha256 missing')) return fail;
  const manifest = Object.fromEntries(readFileSync(manPath, 'utf8').trim().split('\n').map((l) => l.split(/\s+/).reverse()));
  for (const s of SOURCES) {
    if (!req(existsSync(join(raw, s.file)), `${s.file} missing from cache`)) continue;
    if (!skipChecksum) req(manifest[s.file] === createHash('sha256').update(file(s.file)).digest('hex'), `${s.file} checksum does not match MANIFEST`);
  }
  if (fail.length) return fail;
  const sources = JSON.parse(readFileSync(join(raw, 'sources.json'), 'utf8'));
  for (const s of SOURCES) {
    req(sources[s.file]?.licence, `${s.file} has no licence in sources.json`);
    const line = credits.split('\n').find((l) => l.includes(s.file));
    req(line && line.includes(LICENCE_WORD(s.file)), `CREDITS.md does not record ${s.file} with its ${LICENCE_WORD(s.file)} licence`);
  }
  const { minE, minN, maxE, maxN } = slice.extent, W = (maxE - minE) / slice.gridMetres;
  for (const f of ['terrain-3dep.tif', 'bathy-ncei.tif', 'naip-bay.tif']) {
    const t = readTiff(file(f));
    req(t.width === W && t.height === W, `${f}: ${t.width}×${t.height}, expected ${W}×${W}`);
    const [, , , e0, n0] = t.tags[33922], cell = t.tags[33550][0];
    req(Math.abs(e0 - minE) < 0.5 && Math.abs(n0 - maxN) < 0.5 && Math.abs(cell - slice.gridMetres) < 1e-6, `${f}: georeference ${e0},${n0} @ ${cell} m, expected ${minE},${maxN} @ ${slice.gridMetres} m`);
    if (f === 'terrain-3dep.tif') { let land = 0; for (let k = 0; k < t.data.length; k += 97) if (t.data[k] > 1) land++; req(land / (t.data.length / 97) > 0.35, `${f}: only ${(100 * land / (t.data.length / 97)).toFixed(0)} % of cells above 1 m NAVD88`); }
    if (f === 'naip-bay.tif') req(t.bands.length === 3, `${f}: ${t.bands.length} bands`);
  }
  for (const f of ['naip-airport.tif', 'naip-shore.tif']) { const t = readTiff(file(f)); req(t.bands.length === 3 && t.width > 2000, `${f}: ${t.width}×${t.height}, ${t.bands.length} bands`); }
  const osm = (f) => JSON.parse(file(f).toString('utf8')).elements || [];
  req(osm('osm-buildings-airport.json').filter((e) => e.type === 'way' && e.tags?.building).length >= 5000, 'osm-buildings-airport.json: fewer than 5000 building ways');
  req(osm('osm-buildings-shore.json').filter((e) => e.type === 'way' && e.tags?.building).length >= 8000, 'osm-buildings-shore.json: fewer than 8000 building ways');
  req(osm('osm-relations-airport.json').some((e) => e.type === 'relation' && e.members?.some((m) => m.geometry)), 'osm-relations-airport.json: no relation carries member geometry');
  const ap = osm('osm-airport.json');
  req(ap.some((e) => e.tags?.aeroway === 'aerodrome' && e.geometry?.length > 50), 'osm-airport.json: no aerodrome outline');
  req(ap.filter((e) => e.tags?.aeroway === 'runway').length >= 4, 'osm-airport.json: fewer than 4 runway ways');
  req(ap.some((e) => e.id === 554547693 && parseFloat(e.tags?.height) > 60), 'osm-airport.json: the control tower way (554547693, height > 60 m) is missing');
  req(osm('osm-bridge.json').filter((e) => e.type === 'way' && /San Mateo/.test(e.tags?.name || '') && e.geometry?.length > 20).length >= 2, 'osm-bridge.json: the two San Mateo–Hayward Bridge carriageways are missing');
  const d = JSON.parse(file('noaa-datums-9414523.json').toString('utf8')), v = (n) => d.datums?.find((x) => x.name === n)?.value;
  req(Number.isFinite(v('MSL')) && Number.isFinite(v('NAVD88')) && v('MSL') - v('NAVD88') > 0.8 && v('MSL') - v('NAVD88') < 1.2, `datums: MSL − NAVD88 = ${v('MSL') - v('NAVD88')} m (expected ≈ 0.98 m at Redwood City)`);
  // sfo-tower's FAA data (pinned by that repo's checksums)
  const n = nasr();
  req(n.ends.some((e) => e.id === '28R' && e.ils && e.displacedThrLat), 'NASR: runway 28R with an ILS and a displaced threshold not found');
  req(JSON.parse(readFileSync(join(SFO_TOWER, 'data/derived/aircraft.json'), 'utf8')).B77W?.approachSpeedKt === 149, 'FAA ACD: B77W approach speed 149 kt not found');
  return fail;
}

gate('A0', () => check(), [
  ['tampered raster', () => check({ patch: { 'terrain-3dep.tif': Buffer.concat([readFileSync(join(RAW, 'terrain-3dep.tif')), Buffer.from([1])]) } })],
  ['licence missing from CREDITS.md', () => check({ credits: readFileSync(join(root, 'CREDITS.md'), 'utf8').replace(/osm-airport\.json.*ODbL[^\n]*/, 'osm-airport.json (no licence)') })],
  ['truncated OSM extract', () => { const f = 'osm-buildings-shore.json'; const j = JSON.parse(readFileSync(join(RAW, f), 'utf8')); j.elements = j.elements.slice(0, 500); return check({ patch: { [f]: Buffer.from(JSON.stringify(j)) }, skipChecksum: true }); }],
  ['datums without NAVD88', () => { const j = JSON.parse(readFileSync(join(RAW, 'noaa-datums-9414523.json'), 'utf8')); j.datums = j.datums.filter((x) => x.name !== 'NAVD88'); return check({ patch: { 'noaa-datums-9414523.json': Buffer.from(JSON.stringify(j)) }, skipChecksum: true }); }],
  ['raster of the wrong size', () => check({ patch: { 'naip-bay.tif': readFileSync(join(RAW, 'naip-airport.tif')) }, skipChecksum: true })],
]);
