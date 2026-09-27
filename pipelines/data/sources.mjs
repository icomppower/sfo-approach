// SFO Approach's raw sources: the datasets behind the map (data/slice.json), as the engine's fetchSources() wants
// them ({ file, key, title, licence, licenceUrl, url, body?, fetch? }). Pure data + fetchers: no engine imports, so
// the list can be read by gates and runners alike; configureSources() hands in the TIFF helpers the NAIP mosaic
// fetcher needs (pipelines/data/fetch.mjs does that).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
export const slice = JSON.parse(readFileSync(join(root, 'data/slice.json'), 'utf8'));
const { minE, minN, maxE, maxN } = slice.extent, CELL = slice.gridMetres;
const W = (maxE - minE) / CELL, H = (maxN - minN) / CELL;
const WGS = slice.bbox;

let tiff = null;
export function configureSources({ readTiff, writeTiff }) { tiff = { readTiff, writeTiff }; }

// Uncompressed chunky RGB8 GeoTIFF (little-endian, one strip) with the pixel-scale / tie-point tags the engine's
// readTiff() reads; the engine's own writeTiff() is single-band F32, so the mosaic writes its own.
export function writeRgbTiff({ width, height, bands, cell, originE, originN }) {
  const n = width * height, data = new Uint8Array(n * 3);
  for (let k = 0; k < n; k++) { data[k * 3] = bands[0][k]; data[k * 3 + 1] = bands[1][k]; data[k * 3 + 2] = bands[2][k]; }
  const tags = [[256, 4, [width]], [257, 4, [height]], [258, 3, [8, 8, 8]], [259, 3, [1]], [262, 3, [2]], [273, 4, [0]], [277, 3, [3]],
    [278, 4, [height]], [279, 4, [data.length]], [284, 3, [1]], [33550, 12, [cell, cell, 0]], [33922, 12, [0, 0, 0, originE, originN, 0]]];
  const SIZE = { 3: 2, 4: 4, 12: 8 };
  let extra = 0; for (const [, t, v] of tags) if (SIZE[t] * v.length > 4) extra += SIZE[t] * v.length + (SIZE[t] * v.length) % 2;
  const ifdOff = 8, ifdLen = 2 + tags.length * 12 + 4, dataOff = ifdOff + ifdLen + extra;
  const head = Buffer.alloc(dataOff);
  head.write('II', 0, 'latin1'); head.writeUInt16LE(42, 2); head.writeUInt32LE(ifdOff, 4);
  head.writeUInt16LE(tags.length, ifdOff);
  let ext = ifdOff + ifdLen;
  tags.forEach(([tag, type, vals], i) => {
    if (tag === 273) vals = [dataOff];
    const e = ifdOff + 2 + i * 12, size = SIZE[type] * vals.length;
    head.writeUInt16LE(tag, e); head.writeUInt16LE(type, e + 2); head.writeUInt32LE(vals.length, e + 4);
    const at = size <= 4 ? e + 8 : ext;
    vals.forEach((v, k) => { const q = at + k * SIZE[type]; if (type === 3) head.writeUInt16LE(v, q); else if (type === 4) head.writeUInt32LE(v, q); else head.writeDoubleLE(v, q); });
    if (size > 4) { head.writeUInt32LE(ext, e + 8); ext += size + size % 2; }
  });
  head.writeUInt32LE(0, ifdOff + 2 + tags.length * 12);
  return Buffer.concat([head, Buffer.from(data.buffer)]);
}

function exportImage(service, b = { minE, minN, maxE, maxN }) {
  const q = new URLSearchParams({
    bbox: `${b.minE},${b.minN},${b.maxE},${b.maxN}`, bboxSR: '32610', imageSR: '32610', size: `${(b.maxE - b.minE) / CELL},${(b.maxN - b.minN) / CELL}`,
    format: 'tiff', pixelType: 'F32', noDataInterpretation: 'esriNoDataMatchAny',
    interpolation: 'RSP_BilinearInterpolation', compression: 'LZ77', f: 'image',
  });
  return `${service}/exportImage?${q}`;
}
// the elevation services time out on a 4000 px export: 2 × 2 quadrants of 2000 px, mosaicked into one F32 GeoTIFF
const QUADS = (() => { const midE = (minE + maxE) / 2, midN = (minN + maxN) / 2; return [[minE, midN, midE, maxN], [midE, midN, maxE, maxN], [minE, minN, midE, midN], [midE, minN, maxE, midN]]; })(); // NW NE SW SE
function demMosaic(service) {
  return async ({ download }) => {
    if (!tiff) throw new Error('sources: configureSources({ readTiff, writeTiff }) first');
    const qw = W / 2, qh = H / 2, data = new Float32Array(W * H);
    for (const [qi, [e0, n0, e1, n1]] of QUADS.entries()) {
      const t = tiff.readTiff(await download(exportImage(service, { minE: e0, minN: n0, maxE: e1, maxN: n1 })));
      if (t.width !== qw || t.height !== qh) throw new Error(`dem quadrant ${qi}: ${t.width}x${t.height}, expected ${qw}x${qh}`);
      const ox = qi % 2 ? qw : 0, oy = qi >= 2 ? qh : 0;
      for (let y = 0; y < qh; y++) for (let x = 0; x < qw; x++) data[(oy + y) * W + ox + x] = t.data[y * qw + x];
    }
    return tiff.writeTiff({ width: W, height: H, data, tie: [0, 0, 0, minE, maxN, 0], scale: [CELL, CELL, 0] });
  };
}
const NAIP = 'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage?';
export function naipExport(b, cell) {
  return NAIP + new URLSearchParams({
    bbox: `${b.minE},${b.minN},${b.maxE},${b.maxN}`, bboxSR: '32610', imageSR: '32610', size: `${(b.maxE - b.minE) / cell},${(b.maxN - b.minN) / cell}`,
    format: 'tiff', pixelType: 'U8', bandIds: '0,1,2', compression: 'LZ77', interpolation: 'RSP_BilinearInterpolation', f: 'image',
  });
}
// the NAIP ImageServer exports at most 4000 px a side; the 24 km square at 6 m is fetched as 2 × 2 quadrants
// (2000 px each) and mosaicked into one GeoTIFF sharing the terrain square (row 0 = north)
export const NAIP_BAY = { minE, minN, maxE, maxN, cell: 6 };
async function naipMosaic({ download }) {
  if (!tiff) throw new Error('sources: configureSources({ readTiff, writeTiff }) first');
  const { cell } = NAIP_BAY, quads = QUADS;
  const w = (maxE - minE) / cell, h = (maxN - minN) / cell, qw = w / 2, qh = h / 2;
  const bands = [0, 1, 2].map(() => new Uint8Array(w * h));
  for (const [qi, [e0, n0, e1, n1]] of quads.entries()) {
    const buf = await download(naipExport({ minE: e0, minN: n0, maxE: e1, maxN: n1 }, cell));
    const t = tiff.readTiff(buf);
    if (t.width !== qw || t.height !== qh) throw new Error(`naip quadrant ${qi}: ${t.width}x${t.height}, expected ${qw}x${qh}`);
    const ox = qi % 2 ? qw : 0, oy = qi >= 2 ? qh : 0;
    for (let b = 0; b < 3; b++) for (let y = 0; y < qh; y++) bands[b].set(t.bands[b].subarray(y * qw, (y + 1) * qw), (oy + y) * w + ox);
  }
  return writeRgbTiff({ width: w, height: h, bands, cell, originE: minE, originN: maxN });
}

const OVERPASS = ['https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass-api.de/api/interpreter'];
// Overpass mirrors answer "too busy" as an HTML page with status 200: try each mirror until one returns JSON
function overpass(query) {
  return async ({ download }) => {
    let last = null;
    for (let round = 0; round < 4; round++) for (const m of OVERPASS) {
      try {
        const buf = await download(m, { body: 'data=' + encodeURIComponent(query) });
        const head = buf.subarray(0, 200).toString();
        if (head.trimStart().startsWith('{')) { const j = JSON.parse(buf.toString()); if (Array.isArray(j.elements)) return Buffer.from(JSON.stringify(j) + '\n'); }
        last = new Error(`${m}: not JSON (${head.replace(/\s+/g, ' ').slice(0, 80)})`);
      } catch (e) { last = e; }
      await new Promise(r => setTimeout(r, 15000));
    }
    throw last;
  };
}
const bb = b => `${b.south},${b.west},${b.north},${b.east}`;
const B = slice.boxes;

export const SOURCES = [
  {
    file: 'terrain-3dep.tif', key: 'terrain-3dep',
    title: `USGS 3DEP elevation, ${CELL} m resample over the 24 km slice (3DEPElevation ImageServer)`,
    licence: 'Public domain (US Government work, USGS)', licenceUrl: 'https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits',
    url: exportImage('https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer') + '&note=fetched-as-four-quadrants',
    fetch: demMosaic('https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer'),
  },
  {
    file: 'bathy-ncei.tif', key: 'bathy-ncei',
    title: `NOAA NCEI DEM mosaic (topobathy), ${CELL} m resample over the slice (DEM_mosaics/DEM_all ImageServer)`,
    licence: 'Public domain (US Government work, NOAA NCEI)', licenceUrl: 'https://www.ncei.noaa.gov/access/metadata/landing-page/bin/iso?id=gov.noaa.ngdc.mgg.dem:999919',
    url: exportImage('https://gis.ngdc.noaa.gov/arcgis/rest/services/DEM_mosaics/DEM_all/ImageServer') + '&note=fetched-as-four-quadrants',
    fetch: demMosaic('https://gis.ngdc.noaa.gov/arcgis/rest/services/DEM_mosaics/DEM_all/ImageServer'),
  },
  {
    file: 'noaa-datums-9414523.json', key: 'noaa-datums',
    title: 'NOAA CO-OPS tidal datums, Redwood City station 9414523 (MSL relative to NAVD88; nearest station to the 28R final)',
    licence: 'Public domain (US Government work, NOAA CO-OPS)', licenceUrl: 'https://tidesandcurrents.noaa.gov/datums.html?id=9414523',
    url: 'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/9414523/datums.json?units=metric',
  },
  {
    file: 'naip-bay.tif', key: 'naip-bay',
    title: 'USDA NAIP aerial orthoimagery (natural colour, 6 m resample, 2 × 2 mosaic) over the whole 24 km terrain square (USGS The National Map NAIP ImageServer), for the ground colour map',
    licence: 'Public domain (US Government work, USDA Farm Service Agency NAIP)', licenceUrl: 'https://naip-usdaonline.hub.arcgis.com/',
    url: naipExport(NAIP_BAY, NAIP_BAY.cell) + '&note=fetched-as-four-quadrants', fetch: naipMosaic,
  },
  {
    file: 'naip-airport.tif', key: 'naip-airport',
    title: 'USDA NAIP aerial orthoimagery (natural colour, 2 m resample) over the airport / Millbrae / Burlingame building box, for roof colours',
    licence: 'Public domain (US Government work, USDA Farm Service Agency NAIP)', licenceUrl: 'https://naip-usdaonline.hub.arcgis.com/',
    url: naipExport(B.airport.utm, 2),
  },
  {
    file: 'naip-shore.tif', key: 'naip-shore',
    title: 'USDA NAIP aerial orthoimagery (natural colour, 2 m resample) over the Foster City / San Mateo shoreline building box, for roof colours',
    licence: 'Public domain (US Government work, USDA Farm Service Agency NAIP)', licenceUrl: 'https://naip-usdaonline.hub.arcgis.com/',
    url: naipExport(B.southShore.utm, 2),
  },
  {
    file: 'osm-buildings-airport.json', key: 'osm-buildings-airport',
    title: 'OpenStreetMap buildings: SFO, Millbrae, Burlingame, San Bruno, the Bayfront hotels (Overpass API)',
    licence: 'ODbL 1.0 — © OpenStreetMap contributors', licenceUrl: 'https://www.openstreetmap.org/copyright',
    url: OVERPASS[0], fetch: overpass(`[out:json][timeout:180];(way["building"](${bb(B.airport)});relation["building"](${bb(B.airport)}););out geom tags qt;`),
  },
  {
    file: 'osm-buildings-shore.json', key: 'osm-buildings-shore',
    title: 'OpenStreetMap buildings: Foster City, the San Mateo shoreline, Coyote Point (Overpass API)',
    licence: 'ODbL 1.0 — © OpenStreetMap contributors', licenceUrl: 'https://www.openstreetmap.org/copyright',
    url: OVERPASS[0], fetch: overpass(`[out:json][timeout:180];(way["building"](${bb(B.southShore)});relation["building"](${bb(B.southShore)}););out geom tags qt;`),
  },
  {
    file: 'osm-relations-airport.json', key: 'osm-relations-airport',
    title: 'OpenStreetMap multipolygon buildings (relations with member geometry) in the airport box: the terminals, garages and other courtyard buildings (Overpass API)',
    licence: 'ODbL 1.0 — © OpenStreetMap contributors', licenceUrl: 'https://www.openstreetmap.org/copyright',
    url: OVERPASS[0], fetch: overpass(`[out:json][timeout:180];relation["building"](${bb(B.airport)});out geom;`),
  },
  {
    file: 'osm-relations-shore.json', key: 'osm-relations-shore',
    title: 'OpenStreetMap multipolygon buildings (relations with member geometry) in the shoreline box (Overpass API)',
    licence: 'ODbL 1.0 — © OpenStreetMap contributors', licenceUrl: 'https://www.openstreetmap.org/copyright',
    url: OVERPASS[0], fetch: overpass(`[out:json][timeout:180];relation["building"](${bb(B.southShore)});out geom;`),
  },
  {
    file: 'osm-airport.json', key: 'osm-airport',
    title: 'OpenStreetMap airport features: SFO aerodrome boundary, runways, taxiways, aprons, the control tower, terminals tagged aeroway (Overpass API)',
    licence: 'ODbL 1.0 — © OpenStreetMap contributors', licenceUrl: 'https://www.openstreetmap.org/copyright',
    url: OVERPASS[0], fetch: overpass(`[out:json][timeout:180];(
  way["aeroway"~"^(aerodrome|runway|taxiway|apron|terminal|helipad)$"](37.596,-122.412,37.645,-122.348);
  relation["aeroway"="aerodrome"](37.596,-122.412,37.645,-122.348);
  nwr["aeroway"="control_tower"](37.596,-122.412,37.645,-122.348);
  nwr["man_made"="tower"]["tower:type"~"airport|control"](37.596,-122.412,37.645,-122.348);
  nwr["name"~"Control Tower"](37.596,-122.412,37.645,-122.348);
);out geom tags qt;`),
  },
  {
    file: 'osm-bridge.json', key: 'osm-bridge',
    title: 'OpenStreetMap: San Mateo–Hayward Bridge carriageways and piers (Overpass API)',
    licence: 'ODbL 1.0 — © OpenStreetMap contributors', licenceUrl: 'https://www.openstreetmap.org/copyright',
    url: OVERPASS[0], fetch: overpass(`[out:json][timeout:180];(
  way["bridge"]["highway"]["name"~"San Mateo"](37.555,-122.290,37.625,-122.110);
  way["bridge"]["highway"~"^(motorway|trunk)$"](37.565,-122.290,37.600,-122.230);
  nwr["bridge:support"](37.555,-122.290,37.625,-122.110);
  nwr["name"~"San Mateo.*Bridge"](37.555,-122.290,37.625,-122.110);
);out geom tags qt;`),
  },
];
