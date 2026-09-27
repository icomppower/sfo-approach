// B3 Commands: Phase 1's scripted flow (vector an arrival onto the ILS 28R and land it; hold short, line up and launch
// a departure; a direct and a go-around) issued through the tower game's own select() / send() path: every command
// is accepted (or rejected) with Phase 1's readback text, and the event list (ESTABLISHED, THRESHOLD, TOUCHDOWN,
// CLEAR_RUNWAY, LANDED, ROLL_START, LIFTOFF, DEPARTED…) equals the pure-Node sim's for the same script.
// --negative: a script with one command dropped, and one issued a step late, must change the events / readbacks.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { root, gate } from './lib/common.mjs';
import { SFO_TOWER } from '../pipelines/lib/nasr.mjs';
import { scriptedFlow } from './lib/tower-headless.mjs';

const SEED = 'scripted-b3', MIN = 25;
function child() {
  const r = spawnSync(process.execPath, [join(root, 'gates/lib/tower-headless.mjs'), '--seed', SEED, '--minutes', String(MIN), '--script', 'scripted'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, HARBOR_TITLE: root } });
  const line = (r.stdout || '').split('\n').find((l) => l.startsWith('RESULT '));
  if (!line) throw new Error('headless run crashed: ' + (r.stderr || '').slice(-1200));
  return JSON.parse(line.slice(7));
}
async function pure({ drop = null, late = null } = {}) {
  const { loadData } = await import(`${SFO_TOWER}/sim/load-node.js`);
  const { Shift } = await import(`${SFO_TOWER}/sim/shift.js`);
  const s = new Shift(loadData(), { seed: SEED, difficulty: 'normal', weather: 'clear', durationMin: 30, assist: true });
  let n = 0;
  const flow = scriptedFlow(s, (id, c) => { n++; if (drop === n) return { ok: false, readback: 'dropped' }; if (late === n) { s.step(1); } return s.command(id, c); });
  for (let i = 0; i < MIN * 60; i++) { flow.tick(); s.step(1); }
  return { events: s.events.filter((e) => !['FIX', 'SPAWN'].includes(e.type)).map((e) => ({ t: e.t, type: e.type, ac: e.ac, ...(e.runway ? { runway: e.runway } : {}) })), commands: flow.log, hash: s._hash };
}
function judge(r, p) {
  const fail = [];
  const types = [...new Set(r.events.map((e) => e.type))];
  console.log(`  ${r.commands.length} commands through the UI path; events: ${types.join(' ')}`);
  for (const [i, c] of r.commands.entries()) { const q = p.commands[i]; if (!q || q[3] !== c[3] || q[4] !== c[4]) fail.push(`command ${i} (${c[2].type}): 3D "${c[4]}" vs pure "${q ? q[4] : 'none'}"`); }
  for (const want of ['ESTABLISHED', 'THRESHOLD', 'TOUCHDOWN', 'CLEAR_RUNWAY', 'LANDED', 'ROLL_START', 'LIFTOFF']) if (!types.includes(want)) fail.push(`events: no ${want} in the flow`);
  if (JSON.stringify(r.events) !== JSON.stringify(p.events)) fail.push(`events: the 3D run's ${r.events.length} events differ from the pure sim's ${p.events.length}`);
  if (r.hash !== p.hash) fail.push('determinism: hash differs');
  return fail;
}
gate('B3', async () => judge(child(), await pure()), [
  ['one command dropped', async () => judge(child(), await pure({ drop: 4 }))],
  ['one command a step late', async () => judge(child(), await pure({ late: 3 }))],
]);
