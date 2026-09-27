// A1 Georeference: independent sources agree where the scene puts things.
//  1. Shipped terrain vs FAA NASR: every runway end's shaped terrain height = the published elevation (± 0.3 m).
//  2. NAIP imagery vs FAA NASR: along each runway centreline the aerial pixels are pavement (grey, darker than the
//     ground 90 m to either side) on ≥ 80 % of samples — the FAA geometry lands on the imagery's runways.
//  3. Landmarks vs OSM: the tower's cab (vertices above 60 m) is centred on the OSM footprint centroid (≤ 10 m);
//     the bridge deck's west end is at the OSM carriageway's west end (≤ 15 m).
//  4. The title's pure UTM helper matches the engine's (≤ 1 mm) at the control points.
// --negative: runway ends moved 40 m sideways (imagery test), terrain raised 1 m under a runway, a tower moved
// 20 m, a UTM helper off by one metre.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { decodeTerrain } from 'harbor-engine/gates/lib/tiles.mjs';
import { parseGLB } from 'harbor-engine/src/engine/loaders/GLTF.js';
import { setUTMZone, toUTM as engineUTM } from 'harbor-engine/tools/geo/utm.mjs';
import { readTiff } from 'harbor-engine/tools/geo/tiff.mjs';
import { root, gate, readJSON, R } from './lib/common.mjs';
import { toUTM, toLocal, FRAME, MAP } from '../pipelines/lib/utm.mjs';
import { nasr, FT } from '../pipelines/lib/nasr.mjs';

setUTMZone(FRAME.utmZone);
const T = decodeTerrain(join(root, 'public/terrain'));
const { res, size } = T.index, texel = size / res;
const hAt = (x, z) => T.h[Math.max(0, Math.min(res - 1, Math.floor((z + size / 2) / texel))) * res + Math.max(0, Math.min(res - 1, Math.floor((x + size / 2) / texel)))];
const msl = readJSON('public/flight/airport.json').msl;
const naip = readTiff(readFileSync(join(root, 'data/raw/naip-bay.tif')));
const [, , , e0, n0] = naip.tags[33922], cell = naip.tags[33550][0];
const px = (x, z) => { const c = Math.floor((x + FRAME.originE - e0) / cell), r = Math.floor((n0 - (FRAME.originN - z)) / cell); if (c < 0 || r < 0 || c >= naip.width || r >= naip.height) return null; const k = r * naip.width + c; return [naip.bands[0][k], naip.bands[1][k], naip.bands[2][k]]; };
const luma = (p) => p ? 0.3 * p[0] + 0.59 * p[1] + 0.11 * p[2] : NaN;
const sat = (p) => p ? Math.max(...p) - Math.min(...p) : NaN;

function check({ ends = nasr().ends, terrain = hAt, towerShift = [0, 0], utm = toUTM } = {}) {
  const fail = [], req = (ok, m) => { if (!ok) fail.push(m); return ok; };
  // 1. runway ends vs shipped terrain
  for (const e of ends) {
    const [x, z] = toLocal(e.endLat, e.endLon), want = (e.endElevFt ?? 13) * FT - msl, got = terrain(x, z);
    req(Math.abs(got - want) <= 0.3, `terrain: runway ${e.id} end ${R(got)} m, NASR ${R(want)} m`);
  }
  // 2. NASR centrelines over the NAIP imagery
  const byRunway = {};
  for (const e of ends) (byRunway[e.runway] = byRunway[e.runway] || []).push(e);
  for (const [id, [A, B]] of Object.entries(byRunway)) {
    const a = toLocal(A.endLat, A.endLon), b = toLocal(B.endLat, B.endLon), L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], r = [- u[1], u[0]];
    let ok = 0, n = 0;
    for (let s = 150; s < L - 150; s += 60) {
      const c = [a[0] + u[0] * s, a[1] + u[1] * s];
      const centre = px(c[0], c[1]), side = [90, - 90].map((w) => px(c[0] + r[0] * w, c[1] + r[1] * w));
      if (!centre || side.some((p) => !p)) continue;
      n++;
      const lc = luma(centre), ls = side.map(luma);
      if (sat(centre) < 40 && lc < 150 && lc < Math.max(...ls) - 8) ok++; // grey pavement, darker than at least one side
    }
    req(n >= 20 && ok / n >= 0.8, `imagery: runway ${id} centreline is pavement on ${ok}/${n} samples (need ≥ 80 %)`);
  }
  // 3. landmarks vs OSM
  const idx = readJSON('public/landmarks/index.json');
  const verts = (slug) => { const buf = readFileSync(join(root, 'public/landmarks', `${slug}_lod0.glb`)); const g = parseGLB(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)); const out = []; for (const nd of g.nodes) if (nd.mesh !== undefined) for (const p of g.meshes[nd.mesh]) { const P = p.attributes.POSITION.array; for (let v = 0; v < P.length; v += 3) out.push([P[v] + nd.t[0], P[v + 1] + nd.t[1], P[v + 2] + nd.t[2]]); } return out; };
  const osm = JSON.parse(readFileSync(join(root, 'data/raw/osm-airport.json'), 'utf8')).elements;
  const tw = osm.find((e) => e.id === 554547693);
  const ring = tw.geometry.map((g) => toLocal(g.lat, g.lon)); ring.pop();
  let A2 = 0, cx = 0, cz = 0; for (let i = 0; i < ring.length; i++) { const [x0, z0] = ring[i], [x1, z1] = ring[(i + 1) % ring.length], c = x0 * z1 - x1 * z0; A2 += c; cx += (x0 + x1) * c; cz += (z0 + z1) * c; }
  const tc = [cx / (3 * A2), cz / (3 * A2)];
  const cab = verts('sfo-tower').filter((v) => v[1] > 60);
  const cabC = [cab.reduce((s, v) => s + v[0], 0) / cab.length + towerShift[0], cab.reduce((s, v) => s + v[2], 0) / cab.length + towerShift[1]];
  const dT = Math.hypot(cabC[0] - tc[0], cabC[1] - tc[1]);
  req(cab.length > 20 && dT <= 10, `landmark: tower cab ${R(dT, 1)} m from the OSM footprint centroid (≤ 10 m)`);
  const br = JSON.parse(readFileSync(join(root, 'data/raw/osm-bridge.json'), 'utf8')).elements.find((e) => e.id === 42248740);
  const west = br.geometry.map((g) => toLocal(g.lat, g.lon)).sort((p, q) => p[0] - q[0])[0];
  const deck = verts('san-mateo-bridge').filter((v) => v[1] > 7).sort((p, q) => p[0] - q[0]);
  const dB = Math.hypot(deck[0][0] - west[0], deck[0][2] - west[1]);
  req(deck.length > 100 && dB <= 15, `landmark: bridge deck west end ${R(dB, 1)} m from the OSM carriageway end (≤ 15 m)`);
  // 4. UTM helpers agree
  for (const c of MAP.controlPoints) { const [E, N] = utm(c.lat, c.lon), [E2, N2] = engineUTM(c.lat, c.lon); req(Math.hypot(E - E2, N - N2) < 0.001, `utm: ${c.name} differs from the engine by ${R(Math.hypot(E - E2, N - N2) * 1000, 1)} mm`); }
  return fail;
}

gate('A1', () => check(), [
  ['runway ends moved 40 m sideways', () => check({ ends: nasr().ends.map((e) => ({ ...e, endLat: e.endLat + 40 / 111320, displacedThrLat: e.displacedThrLat ? e.displacedThrLat + 40 / 111320 : null })) })],
  ['terrain raised 1 m under a runway', () => check({ terrain: (x, z) => hAt(x, z) + 1 })],
  ['tower moved 20 m', () => check({ towerShift: [20, 0] })],
  ['UTM helper off by a metre', () => check({ utm: (la, lo) => { const [E, N] = toUTM(la, lo); return [E + 1, N]; } })],
]);
