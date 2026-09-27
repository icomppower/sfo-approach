// Landmark inputs for the offline Blender build (pipelines/landmarks/build.py) from the cache: the control tower's
// OSM footprint and height, the San Mateo–Hayward Bridge carriageway centrelines (the part inside the map, plus a
// little beyond its east edge), ground heights from the merged terrain. Local metres (x east, z south).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toLocal } from '../lib/utm.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const R3 = v => Math.round(v * 1000) / 1000;

export async function prepareLandmarks({ rawDir, grid, mergeHeights }) {
  const merged = mergeHeights({ rawDir });
  const { res, size } = grid, texel = size / res;
  const ground = ([x, z]) => { const i = Math.max(0, Math.min(res - 1, Math.floor((x + size / 2) / texel))), j = Math.max(0, Math.min(res - 1, Math.floor((z + size / 2) / texel))); return merged.heights[j * res + i] / 100; };
  const meta = JSON.parse(readFileSync(join(root, 'data/landmarks.json'), 'utf8')).landmarks;
  const osmA = JSON.parse(readFileSync(join(rawDir, 'osm-airport.json'), 'utf8')).elements;
  const osmB = JSON.parse(readFileSync(join(rawDir, 'osm-bridge.json'), 'utf8')).elements;
  const centroid = pts => { let A = 0, cx = 0, cz = 0; for (let i = 0; i < pts.length; i++) { const [x0, z0] = pts[i], [x1, z1] = pts[(i + 1) % pts.length], c = x0 * z1 - x1 * z0; A += c; cx += (x0 + x1) * c; cz += (z0 + z1) * c; } return Math.abs(A) < 1e-6 ? [pts[0][0], pts[0][1]] : [R3(cx / (3 * A)), R3(cz / (3 * A))]; };
  // tower
  const tw = meta.find(l => l.slug === 'sfo-tower');
  const way = osmA.find(e => e.type === 'way' && e.id === tw.osmWay);
  const tRing = way.geometry.map(g => toLocal(g.lat, g.lon)); if (tRing.length > 1 && tRing[0][0] === tRing.at(-1)[0] && tRing[0][1] === tRing.at(-1)[1]) tRing.pop();
  const tAnchor = centroid(tRing);
  const tower = { slug: tw.slug, name: tw.name, anchor: tAnchor, ground: R3(ground(tAnchor)), height: parseFloat(way.tags.height) || tw.heightM, cabFrom: parseFloat(way.tags.min_height) || 60,
    ring: tRing.map(([x, z]) => [R3(x - tAnchor[0]), R3(z - tAnchor[1])]), latLon: [way.geometry[0].lat, way.geometry[0].lon] };
  // bridge: the two carriageways, west → east, clipped to the map plus 600 m
  const br = meta.find(l => l.slug === 'san-mateo-bridge');
  const lines = br.osmWays.map(id => osmB.find(e => e.type === 'way' && e.id === id)).filter(Boolean).map(w => { const pts = w.geometry.map(g => toLocal(g.lat, g.lon)); if (pts[0][0] > pts.at(-1)[0]) pts.reverse(); return pts; });
  const limit = size / 2 + 600;
  const clipped = lines.map(pts => pts.filter(p => p[0] <= limit && Math.abs(p[1]) <= limit));
  const west = clipped[0][0], bAnchor = [R3(west[0]), R3(west[1])];
  const bridge = { slug: br.slug, name: br.name, anchor: bAnchor, ground: R3(ground(bAnchor)),
    carriageways: clipped.map(pts => pts.map(([x, z]) => [R3(x - bAnchor[0]), R3(z - bAnchor[1]), R3(ground([x, z]))])),
    profile: { trestleDeck: 9.0, highRiseClearance: 41.1, highRiseStart: 150, mainSpanCentre: 1050, highRiseEnd: 3050, deckWidth: 31, source: br.source } };
  return { note: 'SFO Approach landmarks', landmarks: [tower, bridge] };
}
