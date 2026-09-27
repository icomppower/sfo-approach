// B1 Live sim: the tower game headless for 10 sim minutes with the bot flying: every aircraft mesh sits at the
// sim's projected position (≤ 1 m) with the sim's heading (≤ 0.5°), and the replay hash after the same seed, steps
// and commands equals the pure-Node sim's — the 3D layer only reads the sim. --negative: a wrapper that steps the
// sim twice per second, and a command injected by the 3D layer, must both change the hash; a mesh nudged off its
// position must fail the placement check.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { root, gate, R } from './lib/common.mjs';
import { SFO_TOWER } from '../pipelines/lib/nasr.mjs';

const SEED = 'b1-seed', MIN = 10;
function child(args) {
  const r = spawnSync(process.execPath, [join(root, 'gates/lib/tower-headless.mjs'), ...args], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, HARBOR_TITLE: root } });
  const line = (r.stdout || '').split('\n').find((l) => l.startsWith('RESULT '));
  if (!line) throw new Error('headless run crashed: ' + (r.stderr || r.stdout || '').slice(-1200));
  return JSON.parse(line.slice(7));
}
// pure Node: the same shift, the same bot, the same number of steps
async function pureHash({ seed = SEED, minutes = MIN, doubleStep = false, inject = false } = {}) {
  const { loadData } = await import(`${SFO_TOWER}/sim/load-node.js`);
  const { Shift } = await import(`${SFO_TOWER}/sim/shift.js`);
  const { Bot } = await import(`${SFO_TOWER}/sim/bot.js`);
  const s = new Shift(loadData(), { seed, difficulty: 'normal', weather: 'clear', durationMin: 30, assist: true }), bot = new Bot(s);
  for (let i = 0; i < minutes * 60; i++) { bot.tick(); s.step(doubleStep ? 2 : 1); if (inject && i === 100) { const a = [...s.aircraft.values()].find((x) => x.kind === 'ARR'); if (a) s.command(a.id, { type: 'altitude', alt: 5000 }); } }
  return s._hash;
}
function judge(r, hash) {
  const fail = [];
  console.log(`  ${MIN} min, ${r.maxAc} aircraft at most; worst placement ${R(r.worst.pos, 2)} m, heading ${R(r.worst.hdg, 2)}°; hash 3D ${r.hash} vs pure ${hash}; errors ${r.errors}`);
  if (!(r.worst.pos <= 1)) fail.push(`placement: a mesh is ${R(r.worst.pos, 2)} m from the sim position (≤ 1 m)`);
  if (!(r.worst.hdg <= 0.5)) fail.push(`heading: ${R(r.worst.hdg, 2)}° off the sim heading`);
  if (r.hash !== hash) fail.push(`determinism: replay hash ${r.hash} differs from the pure-Node sim ${hash}`);
  if (r.errors) fail.push(`render: ${r.errors} console/GPU errors (${r.errorText.join(' | ')})`);
  if (!(r.maxAc >= 4)) fail.push(`traffic: only ${r.maxAc} aircraft in 10 minutes`);
  return fail;
}
gate('B1', async () => judge(child(['--seed', SEED, '--minutes', String(MIN), '--bot']), await pureHash()), [
  ['sim stepped twice per second', async () => judge(child(['--seed', SEED, '--minutes', String(MIN), '--bot']), await pureHash({ doubleStep: true }))],
  ['a command injected outside the UI', async () => judge(child(['--seed', SEED, '--minutes', String(MIN), '--bot']), await pureHash({ inject: true }))],
  ['a mesh nudged 3 m', async () => { const r = child(['--seed', SEED, '--minutes', '2', '--bot']); r.worst.pos += 3; return judge(r, r.hash); }],
]);
