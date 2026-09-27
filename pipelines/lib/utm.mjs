// WGS84 → UTM zone 10N and the title frame (pure math, no engine import, so hooks and pipelines that run inside the
// engine's tools can use it): Transverse Mercator, Krüger series to n^4, the same formulation as
// harbor-engine/tools/geo/utm.mjs (gate A1 checks the two agree to the millimetre).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996;
const n = f / (2 - f), n2 = n * n, n3 = n2 * n, n4 = n3 * n;
const A = a / (1 + n) * (1 + n2 / 4 + n4 / 64);
const alpha = [n / 2 - 2 * n2 / 3 + 5 * n3 / 16 + 41 * n4 / 180, 13 * n2 / 48 - 3 * n3 / 5 + 557 * n4 / 1440, 61 * n3 / 240 - 103 * n4 / 140, 49561 * n4 / 161280];
const beta = [n / 2 - 2 * n2 / 3 + 37 * n3 / 96 - n4 / 360, n2 / 48 + n3 / 15 - 437 * n4 / 1440, 17 * n3 / 480 - 37 * n4 / 840, 4397 * n4 / 161280];
const delta = [2 * n - 2 * n2 / 3 - 2 * n3 + 116 * n4 / 45, 7 * n2 / 3 - 8 * n3 / 5 - 227 * n4 / 45, 56 * n3 / 15 - 136 * n4 / 35, 4279 * n4 / 630];
const E0 = 500000, rad = Math.PI / 180;
export const MAP = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../map.json'), 'utf8'));
export const FRAME = MAP.frame;
const lon0 = (FRAME.utmZone * 6 - 183) * rad;

export function toUTM(lat, lon) {
  const phi = lat * rad, lam = lon * rad - lon0, e = Math.sqrt(f * (2 - f));
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - e * Math.atanh(e * Math.sin(phi)));
  const xi1 = Math.atan2(t, Math.cos(lam)), eta1 = Math.atanh(Math.sin(lam) / Math.sqrt(1 + t * t));
  let xi = xi1, eta = eta1;
  for (let j = 1; j <= 4; j++) { xi += alpha[j - 1] * Math.sin(2 * j * xi1) * Math.cosh(2 * j * eta1); eta += alpha[j - 1] * Math.cos(2 * j * xi1) * Math.sinh(2 * j * eta1); }
  return [E0 + k0 * A * eta, k0 * A * xi];
}
export function fromUTM(E, N) {
  const xi = N / (k0 * A), eta = (E - E0) / (k0 * A);
  let xi1 = xi, eta1 = eta;
  for (let j = 1; j <= 4; j++) { xi1 -= beta[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta); eta1 -= beta[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta); }
  const chi = Math.asin(Math.sin(xi1) / Math.cosh(eta1));
  let phi = chi;
  for (let j = 1; j <= 4; j++) phi += delta[j - 1] * Math.sin(2 * j * chi);
  const lam = Math.atan2(Math.sinh(eta1), Math.cos(xi1));
  return [phi / rad, (lam + lon0) / rad];
}
// title frame: x east, z south, metres from the frame origin
export const toLocal = (lat, lon) => { const [E, N] = toUTM(lat, lon); return [E - FRAME.originE, FRAME.originN - N]; };
export const fromLocal = (x, z) => fromUTM(x + FRAME.originE, FRAME.originN - z);
