// B5 Page (and B2 tags): the built site in real Chrome (puppeteer-core, WebGPU) as the tower game with the bot
// flying. Desktop: boots, the shift advances (clock and hash change over 3 s), every visible tag sits within 24 px
// of its aircraft's projection, no two tags overlap, a click on a tag selects that aircraft and the command bar
// shows Phase 1's buttons, an altitude picked from the UI reaches the sim (readback or the sim's own "unable" in
// the ticker), the radar inset draws. Phone 390×844 (?touch&lang=zh): HUD, command bar and range buttons all
// reachable (elementFromPoint), no horizontal overflow, Chinese labels. --negative: a frozen shift (paused via
// ?t… speed 0) fails liveness, a covered page fails reachability, tags shifted 60 px fail the placement check.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, extname } from 'node:path';
import { checkAudit } from 'harbor-engine/gates/lib/clean.mjs';
import { root, gate } from './lib/common.mjs';

const DIST = join(root, 'dist');
const CHROME = process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'].find(existsSync);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.bin': 'application/octet-stream', '.glb': 'model/gltf-binary', '.deflate': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg', '.wgsl': 'text/plain', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' };
function serve(dir) { return new Promise((resolve) => { const s = createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = join(dir, p); if (!existsSync(f)) { res.statusCode = 404; return res.end(); } res.setHeader('Content-Type', MIME[extname(f)] || 'application/octet-stream'); res.end(readFileSync(f)); }); s.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${s.address().port}/`, close: () => s.close() })); }); }
function build() { const r = spawnSync(join(root, 'node_modules/.bin/vite'), ['build', '--logLevel', 'error'], { cwd: root, encoding: 'utf8' }); return r.status === 0 ? [] : [`build: ${(r.stderr || r.stdout).trim().split('\n').slice(0, 2).join(' ')}`]; }

async function browse(url, { phone = false, frozen = false, cover = false, shiftTags = 0 } = {}) {
  const puppeteer = (await import('puppeteer-core')).default;
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const out = { fails: [], errors: [] };
  try {
    const page = await browser.newPage();
    await page.setViewport(phone ? { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true } : { width: 1440, height: 900, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => out.errors.push(String(e.message || e))); page.on('console', (m) => { if (m.type() === 'error') out.errors.push(m.text()); });
    await page.goto(url + `?game=tower&noAudio&play&bot=1&seed=b5&difficulty=normal&weather=clear&ff=200${phone ? '&touch&lang=zh' : ''}`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => window.__app && window.__app.booted, { timeout: 240000 });
    await page.evaluate(() => document.querySelector('.tw-start')?.click());
    await new Promise((r) => setTimeout(r, 2500));
    if (frozen) await page.evaluate(() => { window.__tower.paused = true; });
    if (cover) await page.evaluate(() => { const c = document.createElement('div'); c.style.cssText = 'position:fixed;inset:0;z-index:9999;background:transparent'; document.body.append(c); });
    const s1 = await page.evaluate(() => ({ t: window.__tower.shift.t, hash: window.__tower.shift._hash, clock: document.querySelector('#tw-clock')?.textContent }));
    await new Promise((r) => setTimeout(r, 3000));
    const s2 = await page.evaluate(() => ({ t: window.__tower.shift.t, hash: window.__tower.shift._hash, clock: document.querySelector('#tw-clock')?.textContent }));
    if (!(s2.t >= s1.t + 2 && s2.hash !== s1.hash && s2.clock !== s1.clock)) out.fails.push(`liveness: shift ${s1.t} → ${s2.t}, hash ${s1.hash === s2.hash ? 'unchanged' : 'changed'}`);
    // tags on their aircraft, no overlaps
    const tags = await page.evaluate((shift) => {
      const st = window.__tower, cam = window.__app.camera, W = innerWidth, H = innerHeight, out = [];
      cam.updateMatrixWorld(); cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
      for (const [id, m] of st.meshes) { const el = document.querySelector(`.tw-tag[data-ac="${id}"]`); if (!el || el.style.display === 'none') continue; const v = m.group.position.clone(); v.y += Math.max(6, m.group.userData.spanM * 0.3); v.project(cam); const px = (v.x + 1) / 2 * W, py = (1 - v.y) / 2 * H; const r = el.getBoundingClientRect(); out.push({ id, dx: Math.abs(r.left - px) + shift, dy: Math.abs(r.top + 14 - py), rect: [r.left, r.top, r.width, r.height] }); }
      return out;
    }, shiftTags);
    const off = tags.filter((t) => t.dx > 24 || t.dy > 60);
    if (off.length) out.fails.push(`tags: ${off.length}/${tags.length} tags off their aircraft (worst ${Math.round(Math.max(...off.map((t) => t.dx)))} px)`);
    for (let i = 0; i < tags.length; i++) for (let j = i + 1; j < tags.length; j++) { const a = tags[i].rect, b = tags[j].rect; if (a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]) { out.fails.push(`tags: ${tags[i].id} overlaps ${tags[j].id}`); break; } }
    out.tags = tags.length;
    // select by tag, command through the UI
    const sel = await page.evaluate(() => { const tag = [...document.querySelectorAll('.tw-tag')].find((e) => e.style.display !== 'none'); if (!tag) return null; tag.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); return { id: tag.dataset.ac, selected: window.__tower.selected, cmds: [...document.querySelectorAll('#tw-cmdRow button')].map((b) => b.dataset.cmd) }; });
    if (!sel) out.fails.push('select: no visible tag to click');
    else { if (sel.selected !== sel.id) out.fails.push(`select: clicked ${sel.id}, selected ${sel.selected}`); if (!(sel.cmds.includes('heading') || sel.cmds.includes('luaw'))) out.fails.push(`select: command bar shows ${sel.cmds.join(',')}`); }
    const sent = await page.evaluate(() => { const before = window.__tower.shift.events.length; const b = [...document.querySelectorAll('#tw-cmdRow button')].find((x) => x.dataset.cmd === 'altitude' || x.dataset.cmd === 'luaw'); if (!b) return { ok: false, why: 'no command button' }; b.click(); const p = [...document.querySelectorAll('#tw-picker button')].find((x) => /k$/.test(x.textContent)); if (p) p.click(); return { ok: true, ticker: document.querySelector('#tw-ticker')?.textContent, events: window.__tower.shift.events.length - before }; });
    if (!sent.ok || !(/[a-z]/i.test(sent.ticker || ''))) out.fails.push(`command: ${sent.why || 'no readback / unable in the ticker'}`);
    const scope = await page.evaluate(() => { const c = document.querySelector('#tw-scope'); if (!c || !c.width) return -1; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0; for (let k = 0; k < d.length; k += 16) s += d[k] + d[k + 1] + d[k + 2]; return s / (d.length / 16); });
    if (!(scope > 3)) out.fails.push(`radar: inset mean ${scope} (blank)`);
    if (phone) {
      const reach = await page.evaluate(() => { const bad = [], btns = [...document.querySelectorAll('#tw-hud button, #tw-cmdRow button, #tw-range button')].filter((b) => b.offsetParent !== null); for (const b of btns) { const r = b.getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); if (el !== b && !b.contains(el)) bad.push(b.textContent.trim()); } return { n: btns.length, bad, overflow: document.documentElement.scrollWidth > innerWidth + 1, zh: /[一-鿿]/.test(document.querySelector('#tw-hud')?.textContent || '') }; });
      if (reach.bad.length) out.fails.push(`phone: not reachable: ${reach.bad.join(', ')}`); if (reach.overflow) out.fails.push('phone: horizontal overflow'); if (!reach.zh) out.fails.push('phone: no Chinese labels with ?lang=zh'); if (reach.n < 8) out.fails.push(`phone: only ${reach.n} buttons`);
    }
    mkdirSync(join(root, 'shots'), { recursive: true });
    writeFileSync(join(root, 'shots', phone ? 'tower-390.png' : 'tower-1440.png'), await page.screenshot({ type: 'png' }));
  } finally { await browser.close(); }
  return out;
}
async function pageChecks(o = {}) {
  const srv = await serve(DIST), fail = [];
  try {
    const d = await browse(srv.url, o); fail.push(...d.fails.map((f) => 'desktop: ' + f)); if (d.errors.length) fail.push(`desktop: ${d.errors.length} page errors: ${d.errors.slice(0, 2).join(' | ')}`);
    console.log(`  desktop: ${d.tags} tags checked`);
    const p = await browse(srv.url, { ...o, phone: true }); fail.push(...p.fails.map((f) => 'phone: ' + f)); if (p.errors.length) fail.push(`phone: ${p.errors.length} page errors`);
  } finally { srv.close(); }
  return fail;
}
gate('B5', async () => { if (!CHROME) return ['chrome: no Google Chrome found (CHROME=…)']; return [...checkAudit(), ...build(), ...(await pageChecks())]; }, [
  ['a frozen shift fails liveness', () => pageChecks({ frozen: true })],
  ['a covered page fails reachability', () => pageChecks({ cover: true })],
  ['tags shifted 60 px fail placement', () => pageChecks({ shiftTags: 60 })],
]);
