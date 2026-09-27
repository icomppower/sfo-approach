// Shared bits for the title's gates: the title root, the negative-fixture runner (every mutation must be caught and
// the run must print NEGATIVE n/n), and small readers.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
export const NEG = process.argv.includes('--negative');
export const readJSON = (f) => JSON.parse(readFileSync(join(root, f), 'utf8'));
export const has = (f) => existsSync(join(root, f));

// run( name, check ) where check() → [] on pass or a list of failure strings; in a negative run each entry of
// `mutations` ([ name, () => failures ]) must fail. Prints the gate's verdict and exits.
export async function gate(label, check, mutations) {
  if (!NEG) {
    const fail = await check();
    if (fail.length) { console.log(`${label} FAIL\n- ${fail.join('\n- ')}`); process.exit(1); }
    console.log(`${label} PASS`);
    process.exit(0);
  }
  let caught = 0;
  for (const [name, m] of mutations) {
    let fail = [];
    try { fail = await m(); } catch (e) { fail = []; console.log(`  ${name}: threw (${e.message}) — counts as MISSED`); }
    if (fail.length) { caught++; console.log(`  ${name}: caught — ${fail[0]}`); } else console.log(`  ${name}: MISSED`);
  }
  console.log(`NEGATIVE ${caught}/${mutations.length}`);
  process.exit(caught === mutations.length ? 1 : 0); // a negative run must exit non-zero when everything was caught
}
export const R = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
