// A4 Page: the title builds (vite) with a clean dependency audit (the engine's generic clean-title checks), and the
// built page runs in real Chrome (puppeteer-core, new headless, WebGPU): boots to the start overlay, the approach game
// is live (altitude and distance change between two samples 3 s apart), keys switch shots and the HUD says so, the
// director runs, ?lang=zh shows Chinese captions, and at 390×844 every on-screen button is reachable
// (elementFromPoint) with no horizontal overflow. --negative: a missing module must break the build, an undeclared
// package the audit, a page whose game never advances (paused via ?t and a frozen speed) must fail the liveness check,
// and a button covered by an overlay must fail the reachability check.
import { spawnSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync, cpSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, extname } from 'node:path';
import { checkBuild, checkAudit } from 'harbor-engine/gates/lib/clean.mjs';
import { root, gate } from './lib/common.mjs';

const DIST = join(root, 'dist');
const CHROME = process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'].find(existsSync);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.bin': 'application/octet-stream', '.glb': 'model/gltf-binary', '.deflate': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg', '.wgsl': 'text/plain', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' };

function serve(dir) {
  return new Promise((resolve) => {
    const s = createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
      const f = join(dir, p);
      if (!existsSync(f)) { res.statusCode = 404; return res.end(); }
      res.setHeader('Content-Type', MIME[extname(f)] || 'application/octet-stream'); res.end(readFileSync(f));
    });
    s.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${s.address().port}/`, close: () => s.close() }));
  });
}

async function browse(url, { viewport = { width: 1440, height: 900 }, query = '', cover = false } = {}) {
  const puppeteer = (await import('puppeteer-core')).default;
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const out = { errors: [], fails: [] };
  try {
    const page = await browser.newPage();
    await page.setViewport({ ...viewport, deviceScaleFactor: 1, hasTouch: viewport.width < 600, isMobile: viewport.width < 600 });
    page.on('pageerror', (e) => out.errors.push(String(e.message || e)));
    page.on('console', (m) => { if (m.type() === 'error') out.errors.push(m.text()); });
    await page.goto(url + '?noAudio' + query, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => window.__app && window.__app.booted, { timeout: 240000 });
    const gpu = await page.evaluate(() => !!navigator.gpu);
    if (!gpu) out.fails.push('chrome: no WebGPU');
    // start (click the overlay), then the game runs
    await page.evaluate(() => document.querySelector('.tw-start')?.click());
    await page.waitForFunction(() => document.documentElement.classList.contains('is-started') || !document.querySelector('.tw-start:not([hidden])'), { timeout: 20000 }).catch(() => {});
    if (cover) await page.evaluate(() => { const c = document.createElement('div'); c.id = 'cover'; c.style.cssText = 'position:fixed;inset:0;z-index:9999;background:transparent'; document.body.append(c); });
    const sample = () => page.evaluate(() => ({ alt: document.querySelector('.ap-alt')?.textContent, dist: document.querySelector('.ap-dist')?.textContent, shot: document.querySelector('.ap-shot em')?.textContent, sub: document.querySelector('.ap-sub p')?.textContent, t: window.__approach?.t, hud: !!document.querySelector('.ap-hud') }));
    const s1 = await sample(); await new Promise((r) => setTimeout(r, 3000)); const s2 = await sample();
    if (!s1.hud) out.fails.push('hud: no .ap-hud');
    if (!(s2.t > s1.t + 1)) out.fails.push(`liveness: game time ${s1.t} → ${s2.t} over 3 s`);
    if (s1.alt === s2.alt && s1.dist === s2.dist) out.fails.push(`liveness: HUD altitude/distance did not change (${s1.alt}, ${s1.dist})`);
    // keys switch shots
    await page.keyboard.press('Digit5'); await new Promise((r) => setTimeout(r, 400));
    const s3 = await sample();
    if (!/Tower|塔台/.test(s3.shot || '')) out.fails.push(`keys: after "5" the HUD says "${s3.shot}"`);
    await page.keyboard.press('Digit0'); await new Promise((r) => setTimeout(r, 300));
    const s4 = await page.evaluate(() => ({ auto: window.__approach?.auto, sub: document.querySelector('.ap-shot i')?.textContent }));
    if (!s4.auto) out.fails.push('keys: "0" did not hand back to the director');
    // canvas is drawing (not black)
    const shot = await page.screenshot({ type: 'png', encoding: 'binary' });
    const luma = await page.evaluate(() => { const c = document.querySelector('#app canvas'); if (!c) return -1; const cv = document.createElement('canvas'); cv.width = 64; cv.height = 36; const g = cv.getContext('2d'); try { g.drawImage(c, 0, 0, 64, 36); const d = g.getImageData(0, 0, 64, 36).data; let s = 0; for (let k = 0; k < d.length; k += 4) s += (d[k] + d[k + 1] + d[k + 2]) / 3; return s / (d.length / 4); } catch { return -2; } });
    out.luma = luma; out.png = shot;
    if (luma >= 0 && luma < 8) out.fails.push(`canvas: mean luma ${luma.toFixed(1)} (black)`);
    // language
    if (/lang=zh/.test(query)) { const t = await page.evaluate(() => document.querySelector('.ap-help')?.textContent + document.querySelector('.ap-shot em')?.textContent); if (!/[一-鿿]/.test(t || '')) out.fails.push('lang: ?lang=zh shows no Chinese'); }
    // reachability of the on-screen buttons (touch layout) and no horizontal overflow
    const reach = await page.evaluate(() => {
      const bad = [], btns = [...document.querySelectorAll('.ap-touch button')].filter((b) => getComputedStyle(b).display !== 'none' && b.offsetParent !== null);
      for (const b of btns) { const r = b.getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); if (el !== b && !b.contains(el)) bad.push(b.textContent.trim() + '←' + (el ? el.id || el.className : 'nothing')); }
      return { n: btns.length, bad, overflow: document.documentElement.scrollWidth > window.innerWidth + 1 };
    });
    if (viewport.width < 600) { if (reach.n < 6) out.fails.push(`touch: only ${reach.n} on-screen buttons`); if (reach.bad.length) out.fails.push(`touch: buttons not reachable: ${reach.bad.join(', ')}`); if (reach.overflow) out.fails.push('layout: horizontal overflow at 390 px'); }
    out.sample = s2;
  } finally { await browser.close(); }
  return out;
}

async function pageChecks({ cover = false, frozen = false } = {}) {
  const srv = await serve(DIST);
  const fail = [];
  try {
    const desk = await browse(srv.url, { query: frozen ? '&t=100&speed=0' : '' });
    fail.push(...desk.fails.map((f) => 'desktop: ' + f));
    if (desk.errors.length) fail.push(`desktop: ${desk.errors.length} page errors: ${desk.errors.slice(0, 2).join(' | ')}`);
    if (desk.png) { mkdirSync(join(root, 'shots'), { recursive: true }); writeFileSync(join(root, 'shots/chrome-1440.png'), desk.png); }
    const phone = await browse(srv.url, { viewport: { width: 390, height: 844 }, query: '&lang=zh&touch', cover });
    fail.push(...phone.fails.map((f) => 'phone: ' + f));
    if (phone.errors.length) fail.push(`phone: ${phone.errors.length} page errors: ${phone.errors.slice(0, 2).join(' | ')}`);
    if (phone.png) writeFileSync(join(root, 'shots/chrome-390.png'), phone.png);
    console.log(`  desktop luma ${desk.luma?.toFixed?.(1)}, ${JSON.stringify(desk.sample)}; phone luma ${phone.luma?.toFixed?.(1)}`);
  } finally { srv.close(); }
  return fail;
}

function build() {
  const r = spawnSync(join(root, 'node_modules/.bin/vite'), ['build', '--logLevel', 'error'], { cwd: root, encoding: 'utf8' });
  return r.status === 0 ? [] : [`build: vite build failed — ${(r.stderr || r.stdout).trim().split('\n').slice(0, 2).join(' ')}`];
}

gate('A4', async () => { if (!CHROME) return ['chrome: no Google Chrome / Chromium found (CHROME=…)']; return [...checkAudit(), ...build(), ...(await pageChecks())]; }, [
  ['missing module breaks the build', () => { const f = join(root, 'src/main.js'), s = readFileSync(f, 'utf8'); writeFileSync(f, s + "\nimport './games/does-not-exist.js';\n"); try { return checkBuild(); } finally { writeFileSync(f, s); } }],
  ['undeclared package fails the audit', () => checkAudit([['src/games/x.js', "import x from 'left-pad';"]])],
  ['frozen game fails liveness', async () => pageChecks({ frozen: true })],
  ['covered buttons fail reachability', async () => pageChecks({ cover: true })],
]);
