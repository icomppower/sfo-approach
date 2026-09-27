// The flight: one heavy jet flown by SFO Tower's deterministic simulation (icomppower/sfo-tower, sim/) down the
// ILS 28R from 9 NM to a full stop, sampled every second into the title frame. The sim's kinematics give position,
// altitude, heading, speeds and vertical speed; pitch and bank are derived here (flight-path angle + approach
// angle of attack; bank from the turn rate), so the model flies the way the sim says it does.
//   node pipelines/flight/build.mjs [--out public/flight]      (SFO_TOWER=<path> overrides node_modules/sfo-tower)
// Also writes airport.json: runway geometry in the title frame (FAA NASR via sfo-tower) for the runway overlay.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { toLocal } from '../lib/utm.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SIM = process.env.SFO_TOWER || join(root, 'node_modules/sfo-tower');
const sim = async (f) => import(pathToFileURL(join(SIM, 'sim', f)).href);

export const FT = 0.3048, KT = 0.514444, G = 9.80665;
export const FLIGHT = { seed: process.env.SFO_APPROACH_SEED || 'sfo-approach', callsign: 'UAL869', telephony: 'United', type: 'B77W', runway: '28R', startNm: 9.0 };
const R2 = v => Math.round(v * 100) / 100, R3 = v => Math.round(v * 1000) / 1000;

export async function buildFlight({ msl }) {
  const { loadData } = await sim('load-node.js');
  const { Shift } = await sim('shift.js');
  const { Aircraft, MODES } = await sim('aircraft.js');
  const { angDiff } = await sim('geo.js');
  const data = loadData();
  // a west-flow visual afternoon with a moderate westerly: the first seed suffix whose METAR window says so
  let s = null;
  for (let k = 0; k < 400 && !s; k++) {
    const seed = k ? `${FLIGHT.seed}-${k}` : FLIGHT.seed;
    const t = new Shift(data, { seed, difficulty: 'easy', weather: 'auto', durationMin: 20 });
    const w = t.weather.current;
    if (t.config.id === 'WEST' && w.conditions === 'VISUAL' && w.wind.kt >= 8 && w.wind.kt <= 16 && Math.abs(angDiff(w.wind.dir, 285)) <= 25) { s = t; FLIGHT.seedUsed = seed; }
  }
  if (!s) throw new Error('flight: no seed gives a WEST visual westerly window');
  s.traffic.schedule = [];
  for (const id of [...s.aircraft.keys()]) s.aircraft.delete(id);
  const rw = s.airport.ends[FLIGHT.runway], perf = s.perf[FLIGHT.type];
  const p0 = s.airport.finalPoint(FLIGHT.runway, FLIGHT.startNm);
  const gsAlt = d => rw.elevFt + rw.tchFt + d * 6076.1155 * Math.tan(rw.gsDeg * Math.PI / 180);
  const ac = new Aircraft({ id: 'A1', callsign: FLIGHT.callsign, telephony: FLIGHT.telephony, type: FLIGHT.type, perf, kind: 'ARR', mode: MODES.VECTOR,
    x: p0.x, y: p0.y, alt: gsAlt(FLIGHT.startNm), hdg: rw.finalCourse, ias: 180, runway: FLIGHT.runway, t: 0 });
  ac.tgt.hdg = rw.finalCourse; ac.tgt.hdgAssigned = true; ac.tgt.alt = ac.alt; ac.tgt.ias = 180;
  s.aircraft.set(ac.id, ac);
  const rb = [];
  rb.push([0, s.command(ac.id, { type: 'approach', runway: FLIGHT.runway, kind: 'ILS' }).readback]);
  const samples = [], events = [];
  const wind = { ...s.env.wind };
  const rec = (t) => samples.push({ t, x: ac.x, y: ac.y, alt: ac.alt, hdg: ac.hdg, ias: ac.ias, gs: ac.onGround ? ac.ias : (ac.gs || ac.tas || ac.ias), vs: ac.vs, mode: ac.mode, d: ac.finalDistNm, ground: ac.onGround, along: ac.alongRunwayFt || 0 });
  rec(0);
  let landCleared = false;
  for (let i = 1; i <= 900 && ac.mode !== MODES.LANDED; i++) {
    if (!landCleared && ac.mode === MODES.FINAL && ac.finalDistNm <= 6.5) { landCleared = true; rb.push([s.t, s.command(ac.id, { type: 'land', runway: FLIGHT.runway }).readback]); }
    s.step(1);
    rec(s.t);
  }
  if (ac.mode !== MODES.LANDED) throw new Error(`flight: aircraft ended in ${ac.mode} (${ac.goArounds} go-arounds)`);
  for (const e of s.events) if (['ESTABLISHED', 'THRESHOLD', 'TOUCHDOWN', 'CLEAR_RUNWAY', 'LANDED', 'GO_AROUND', 'LOSS'].includes(e.type)) events.push(e);
  // the sim's final step side-steps the aircraft 300 ft off the runway (taxi clear): the track ends on the runway, stopped
  const cleared = events.find(e => e.type === 'CLEAR_RUNWAY');
  if (cleared) samples.length = samples.findIndex(q => q.t > cleared.t + 5) > 0 ? samples.findIndex(q => q.t > cleared.t + 5) : samples.length - 1;
  const proj = s.airport.proj;
  const latLon = (x, y) => [proj.lat0 + y / 60, proj.lon0 + x / (proj.k * 60)];
  // --- derive pitch and bank; convert to the frame (x east, z south, y up, metres above local MSL)
  const out = [], tdIdx = samples.findIndex(q => q.ground);
  let bank = 0;
  for (let i = 0; i < samples.length; i++) {
    const q = samples[i], prev = samples[Math.max(0, i - 1)], next = samples[Math.min(samples.length - 1, i + 1)];
    const [lat, lon] = latLon(q.x, q.y), [lx, lz] = toLocal(lat, lon);
    const v = Math.max(30, q.gs) * KT;
    const gamma = Math.atan2(q.vs * FT / 60, v);
    let pitch;
    if (q.ground) pitch = Math.max(0, 4.5 - (i - tdIdx) * 1.5) * Math.PI / 180; // derotation after touchdown
    else {
      const aoa = (5.5 * Math.pow(perf.vApp / Math.max(q.ias, perf.vApp), 2)) * Math.PI / 180;
      const flare = q.d != null && q.d <= 0.05 && !q.ground ? 2.0 * Math.PI / 180 : 0;
      pitch = gamma + aoa + flare;
    }
    const rate = angDiff(next.hdg, prev.hdg) / Math.max(1, next.t - prev.t) * Math.PI / 180; // rad/s
    const want = q.ground ? 0 : Math.atan2(rate * v, G);
    bank += (want - bank) * 0.5;
    out.push([q.t, R2(lx), R2(lz), R2(q.alt * FT - msl), R2(q.hdg), R3(pitch), R3(bank), R2(q.ias), R2(q.gs), Math.round(q.vs), q.d == null ? null : R3(q.d), q.ground ? 1 : 0]);
  }
  const thr = events.find(e => e.type === 'THRESHOLD'), td = events.find(e => e.type === 'TOUCHDOWN'), cr = events.find(e => e.type === 'CLEAR_RUNWAY');
  return {
    format: 'sfo-flight/1', fields: ['t s', 'x m east', 'z m south', 'y m above local MSL', 'heading deg true', 'pitch rad', 'bank rad (+ right wing down)', 'ias kt', 'gs kt', 'vs fpm', 'dist to threshold NM', 'on ground'],
    flight: { ...FLIGHT, aircraft: { type: FLIGHT.type, model: perf.model || data.aircraft[FLIGHT.type]?.model, vApp: perf.vApp, heavy: perf.heavy } },
    weather: { conditions: s.weather.current.conditions, wind, config: s.config.id, metarT0: s.weather.t0 },
    runway: { id: FLIGHT.runway, finalCourse: rw.finalCourse, gsDeg: rw.gsDeg, tchFt: rw.tchFt, elevFt: rw.elevFt, ils: rw.ils },
    events: events.map(e => ({ t: e.t, type: e.type, ...(e.altAgl != null ? { altAgl: e.altAgl } : {}), ...(e.fromThrFt != null ? { fromThrFt: e.fromThrFt } : {}), ...(e.rolloutFt != null ? { rolloutFt: e.rolloutFt } : {}), ...(e.occupancyS != null ? { occupancyS: e.occupancyS } : {}) })),
    summary: { thresholdAgl: thr?.altAgl ?? null, touchdownFt: td?.fromThrFt ?? null, rolloutFt: cr?.rolloutFt ?? null, seconds: out.at(-1)[0], thresholdT: thr?.t ?? null, touchdownT: td?.t ?? null },
    readbacks: rb, msl, samples: out,
  };
}

export async function buildAirport({ msl }) {
  const apt = JSON.parse(readFileSync(join(SIM, 'data/derived/ksfo-airport.json'), 'utf8')).nasr;
  const runways = apt.runways.map(r => {
    const ends = apt.ends.filter(e => e.runway === r.id).map(e => {
      const [x, z] = toLocal(e.endLat, e.endLon), thr = e.displacedThrLat ? toLocal(e.displacedThrLat, e.displacedThrLon) : [x, z];
      return { id: e.id, hdg: e.trueHeading, end: [R2(x), R2(z)], thr: [R2(thr[0]), R2(thr[1])], displacedFt: e.displacedThrLenFt || 0, elevM: R3((e.endElevFt ?? apt.elevFt) * FT - msl), tdzeM: R3((e.tdzeFt ?? e.endElevFt) * FT - msl),
        ils: e.ils, gsDeg: e.glidePathDeg, tchFt: e.tchFt, approachLights: e.approachLights, latLon: [e.endLat, e.endLon], thrLatLon: e.displacedThrLat ? [e.displacedThrLat, e.displacedThrLon] : [e.endLat, e.endLon] };
    });
    return { id: r.id, lengthFt: r.lengthFt, widthFt: r.widthFt, widthM: R2(r.widthFt * FT), surface: r.surface, ends };
  });
  const [ax, az] = toLocal(apt.lat, apt.lon);
  return { format: 'sfo-airport/1', icao: apt.icao, name: apt.name, source: 'FAA NASR via sfo-tower data/derived/ksfo-airport.json', effective: apt.effective, arp: [R2(ax), R2(az)], elevFt: apt.elevFt, elevM: R3(apt.elevFt * FT - msl), magVar: apt.magVar, msl, runways };
}

// local MSL above NAVD88 from the cached tide datums (the terrain pipeline's convention)
export function mslOffset(rawDir = join(root, 'data/raw')) {
  const f = join(rawDir, 'noaa-datums-9414523.json');
  if (!existsSync(f)) return 0.982;
  const d = JSON.parse(readFileSync(f, 'utf8')), v = n => d.datums.find(x => x.name === n).value;
  return R3(v('MSL') - v('NAVD88'));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = arg('--out', join(root, 'public/flight')), msl = mslOffset();
  mkdirSync(out, { recursive: true });
  const flight = await buildFlight({ msl }), airport = await buildAirport({ msl });
  writeFileSync(join(out, 'approach-28r.json'), JSON.stringify(flight) + '\n');
  writeFileSync(join(out, 'airport.json'), JSON.stringify(airport, null, 1) + '\n');
  console.log(`flight: seed ${FLIGHT.seedUsed}, ${flight.weather.config} ${flight.weather.conditions} wind ${flight.weather.wind.dir}/${flight.weather.wind.kt}, ${flight.samples.length} s; threshold ${flight.summary.thresholdAgl} ft AGL at t=${flight.summary.thresholdT}, touchdown ${flight.summary.touchdownFt} ft at t=${flight.summary.touchdownT}, rollout ${flight.summary.rolloutFt} ft`);
  for (const e of flight.events) console.log('  ', e.t, e.type, JSON.stringify(e));
  console.log('readbacks', flight.readbacks.map(r => r.join(': ')).join(' | '));
  const k = flight.samples; console.log('first', k[0], 'mid', k[Math.floor(k.length / 2)], 'last', k.at(-1));
}
