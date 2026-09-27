// OSM buildings (ODbL) for the engine's building pipeline: ways and multipolygon relations from the two Overpass
// extracts; roof height = OSM `height`, else `building:levels` × 3 m, else a class default (terminals / commercial /
// industrial 12 m, apartments 10 m, retail 6 m, houses 5.5 m, other 6 m), every fallback logged. Buildings inside
// the SFO aerodrome polygon take the `airport` palette; roofs sample the 2 m NAIP boxes.
const CLASS_HEIGHT = { terminal: 12, commercial: 12, industrial: 12, office: 14, hotel: 20, hospital: 16, apartments: 10, retail: 6, school: 7, house: 5.5, residential: 5.5, detached: 5.5, semidetached_house: 5.5, garage: 3, garages: 3, carport: 3, shed: 3, roof: 4, warehouse: 9, hangar: 14, church: 9, public: 9, university: 12, parking: 12 };
const MIN_AREA = 20; // m²

// OSM multipolygon assembly: member ways (lat/lon point lists) chained by shared end nodes into closed rings
function assembleRings(members) {
  const key = g => `${g.lat},${g.lon}`;
  const ways = members.map(m => m.geometry.slice());
  const rings = [];
  while (ways.length) {
    const ring = ways.shift();
    let guard = 0;
    while (key(ring[0]) !== key(ring[ring.length - 1]) && guard++ < 500) {
      const end = key(ring[ring.length - 1]);
      const i = ways.findIndex(w => key(w[0]) === end || key(w[w.length - 1]) === end);
      if (i < 0) break;
      const w = ways.splice(i, 1)[0];
      if (key(w[0]) !== end) w.reverse();
      ring.push(...w.slice(1));
    }
    if (ring.length >= 4 && key(ring[0]) === key(ring[ring.length - 1])) rings.push(ring);
  }
  return rings;
}

export function collectBuildings(kit) {
  const { local, cleanRing, inside, area2, finish, DEFAULT_HEIGHT, LEVEL_HEIGHT } = kit;
  const log = { osmHeight: 0, osmLevels: 0, classDefault: 0, generic: 0, skippedSmall: 0, skippedBad: 0, relations: 0, airport: 0 };
  const anchors = kit.landmarkAnchors();
  const excluded = [];
  const airportPoly = (() => { const e = kit.readJSON('osm-airport.json').elements.find(x => x.tags?.aeroway === 'aerodrome' && x.geometry); return e ? cleanRing(e.geometry.map(g => local(g.lat, g.lon))) : null; })();
  const H = t => parseFloat(String(t || '').replace(/[^\d.]/g, ''));
  const seen = new Set();
  for (const [file, relFile, naipFile] of [['osm-buildings-airport.json', 'osm-relations-airport.json', 'naip-airport.tif'], ['osm-buildings-shore.json', 'osm-relations-shore.json', 'naip-shore.tif']]) {
    const naip = kit.naip(naipFile);
    const style = (inAirport) => ({ walls: inAirport ? 'airport' : null, roofs: inAirport ? 'airport' : 'city', naip, src: 'osm' });
    // ways come from the `out geom tags` extract (no relation members there); multipolygons from the `out geom` one
    const els = [...kit.readJSON(file).elements.filter(e => e.type === 'way'), ...kit.readJSON(relFile).elements.filter(e => e.type === 'relation')];
    const items = [];
    for (const e of els) {
      if (!e.tags?.building || e.tags.building === 'no') continue;
      if (e.type === 'way' && e.geometry?.length >= 4) items.push({ id: 'w' + e.id, tags: e.tags, rings: [e.geometry.map(g => local(g.lat, g.lon))] });
      else if (e.type === 'relation' && e.members) {
        // a multipolygon's rings are split over member ways: join them end to end into closed rings
        const outers = assembleRings(e.members.filter(m => m.role === 'outer' && m.geometry?.length >= 2)).map(r => r.map(g => local(g.lat, g.lon)));
        const inners = assembleRings(e.members.filter(m => m.role === 'inner' && m.geometry?.length >= 2)).map(r => r.map(g => local(g.lat, g.lon)));
        if (outers.length) { items.push({ id: 'r' + e.id, tags: e.tags, rings: [...outers, ...inners], holes: inners.length, outers: outers.length }); log.relations++; }
      }
    }
    items.sort((p, q) => (p.id < q.id ? -1 : 1));
    for (const it of items) {
      if (seen.has(it.id)) continue; seen.add(it.id);
      let polys;
      if (it.outers) { const outs = it.rings.slice(0, it.outers).map(cleanRing).filter(Boolean), ins = it.rings.slice(it.outers).map(cleanRing).filter(Boolean); polys = outs.map(o => [o, ...ins.filter(h => inside(o, h[0][0], h[0][1]))]); }
      else { const r = cleanRing(it.rings[0]); polys = r ? [[r]] : []; }
      polys = polys.filter(p => Math.abs(area2(p[0])) / 2 >= MIN_AREA);
      if (!polys.length) { log[it.rings[0] && Math.abs(area2(cleanRing(it.rings[0]) || [[0, 0], [0, 0], [0, 0]])) / 2 < MIN_AREA ? 'skippedSmall' : 'skippedBad']++; continue; }
      const c = polys[0][0][0];
      const lm = anchors.find(a => polys.some(poly => inside(poly[0], a.p[0], a.p[1])));
      if (lm) { excluded.push({ landmark: lm.name, id: it.id }); continue; }
      const inAirport = airportPoly ? inside(airportPoly, c[0], c[1]) : false;
      if (inAirport) log.airport++;
      const h = H(it.tags.height), lv = parseFloat(it.tags['building:levels']), cls = it.tags.building;
      let above;
      if (Number.isFinite(h) && h > 0) { above = h; log.osmHeight++; }
      else if (Number.isFinite(lv) && lv > 0) { above = lv * LEVEL_HEIGHT + (it.tags['roof:levels'] ? 2 : 0); log.osmLevels++; }
      else if (CLASS_HEIGHT[cls] !== undefined) { above = CLASS_HEIGHT[cls]; log.classDefault++; }
      else if (it.tags.aeroway === 'terminal' || it.tags.amenity === 'parking') { above = 12; log.classDefault++; }
      else { above = DEFAULT_HEIGHT; log.generic++; }
      finish(it.id, polys, above, null, style(inAirport));
    }
  }
  return { log, excluded };
}
