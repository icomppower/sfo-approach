// The airport's FAA NASR record, from sfo-tower's derived data (node_modules/sfo-tower, or SFO_TOWER=<path>).
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
export const SFO_TOWER = process.env.SFO_TOWER || join(root, 'node_modules/sfo-tower');
export function nasr() {
  const f = join(SFO_TOWER, 'data/derived/ksfo-airport.json');
  if (!existsSync(f)) throw new Error(`nasr: ${f} not found (npm install, or SFO_TOWER=<path to sfo-tower>)`);
  return JSON.parse(readFileSync(f, 'utf8')).nasr;
}
export const FT = 0.3048;
