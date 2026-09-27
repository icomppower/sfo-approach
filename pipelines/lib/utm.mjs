// WGS84 → UTM zone 10N and the title frame for pipelines and hooks (no engine import, so hooks running inside the
// engine's tools can use it); the math lives in src/lib/utm-core.js and is shared with the browser game.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { utm } from '../../src/lib/utm-core.js';

export const MAP = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../map.json'), 'utf8'));
export const FRAME = MAP.frame;
const U = utm(FRAME.utmZone);
export const toUTM = U.toUTM, fromUTM = U.fromUTM;
// title frame: x east, z south, metres from the frame origin
export const toLocal = (lat, lon) => { const [E, N] = toUTM(lat, lon); return [E - FRAME.originE, FRAME.originN - N]; };
export const fromLocal = (x, z) => fromUTM(x + FRAME.originE, FRAME.originN - z);
