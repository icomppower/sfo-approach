// B6 Look (advisory): stills of the tower game headless — the cab view with traffic at golden hour and at night,
// and a follow view — for human review; sanity only (non-blank, night darker than day). --negative: night as
// bright as day must fail.
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { root, gate, R } from './lib/common.mjs';

async function shoot(dir, night) {
  process.env.HARBOR_TITLE = root;
  await import('../src/games/tower.js');
  const { bootApp } = await import('harbor-engine/tools/headless/app.mjs');
  const { writePNG } = await import('harbor-engine/test/headless.mjs');
  const H = await bootApp({ width: 1920, height: 1080, query: `?game=tower&noAudio&tier=low&play&bot=1&seed=b6&difficulty=hard&weather=clear&ff=420${night ? '&time=20.8' : '&time=17.4'}` });
  const app = H.app, st = app.game.state;
  mkdirSync(dir, { recursive: true });
  const out = [];
  for (const [name, mode] of [['cab', 'cab'], ['follow', 'follow']]) {
    st.camMode = mode; if (mode === 'follow') { const a = [...st.shift.aircraft.values()].find((x) => !x.done && !x.onGround); if (a) st.selected = a.id; }
    for (let i = 0; i < 30; i++) app.frame(1 / 30);
    const px = await H.readPixels();
    writePNG(join(dir, `tower-${name}${night ? '-night' : ''}.png`), H.width, H.height, px);
    let s = 0; for (let k = 0; k < px.length; k += 4) s += (px[k] + px[k + 1] + px[k + 2]) / 3;
    out.push({ name, luma: s / (px.length / 4) });
  }
  return out;
}
if (process.argv.includes('--shoot')) { const night = process.argv.includes('--night'); console.log('RESULT ' + JSON.stringify(await shoot(process.argv[process.argv.indexOf('--shoot') + 1], night))); process.exit(0); }
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const run = (dir, night) => { const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--shoot', dir, ...(night ? ['--night'] : [])], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 }); const line = (r.stdout || '').split('\n').find((l) => l.startsWith('RESULT ')); if (!line) throw new Error('shoot crashed: ' + (r.stderr || '').slice(-800)); return JSON.parse(line.slice(7)); };
function judge(day, night) { const fail = []; for (const f of [...day, ...night]) if (!(f.luma > 5 && f.luma < 240)) fail.push(`still ${f.name}: luma ${R(f.luma, 1)}`); const md = day.reduce((s, f) => s + f.luma, 0) / day.length, mn = night.reduce((s, f) => s + f.luma, 0) / night.length; console.log(`  day ${R(md, 1)}, night ${R(mn, 1)}`); if (!(mn < md * 0.7)) fail.push('night not darker than day'); return fail; }
gate('B6', () => judge(run(join(root, 'shots'), false), run(join(root, 'shots'), true)), [['night as bright as day', () => { const d = run(join(root, '.verify/b6'), false); return judge(d, d); }]]);
