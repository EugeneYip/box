#!/usr/bin/env node
// Screenshot harness for visual review.
//
// Single shot:
//   node tools/shot.mjs --port 5173 --q "seed=7&cam=128,128,60,30&hour=10&ui=0&title=0" --out shots/a.png
// Several shots in one browser session (faster; world is reloaded per shot):
//   node tools/shot.mjs --port 5173 --plan plan.json
//   plan.json = [{ "name": "coast", "q": "seed=7&cam=...", "eval": "game.usePower('meteor',120,120)", "wait": 1500 }]
// Options:
//   --w 1600 --h 900        viewport size (default 1600x900)
//   --frames 12             frames to render after load before capturing
//   --wait 800              extra ms after frames
//   --eval "js"             JS evaluated in the page after load (may be async)
//   --after "js"            JS evaluated right before the capture
//   --dpr 1                 deviceScaleFactor
//   --dir shots             output dir for --plan
// The page exposes window.game; errors from the page are printed to stderr.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node-tools/node_modules/playwright'));
}

const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a.startsWith('--')) {
    const k = a.slice(2);
    const v = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : 'true';
    opt[k] = v;
  }
}
const port = opt.port || process.env.PORT || 5173;
const base = opt.base || `http://127.0.0.1:${port}/`;
const W = +(opt.w || 1600),
  H = +(opt.h || 900);
const dpr = +(opt.dpr || 1);

let plan;
if (opt.plan) plan = JSON.parse(fs.readFileSync(opt.plan, 'utf8'));
else plan = [{ name: path.basename(opt.out || 'shot.png', '.png'), q: opt.q || '', eval: opt.eval, after: opt.after, wait: opt.wait, frames: opt.frames, out: opt.out || 'shots/shot.png' }];
const dir = opt.dir || 'shots';

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: dpr });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + (e.stack || e.message)));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text());
});

for (const s of plan) {
  const out = s.out || path.join(dir, (s.name || 'shot') + '.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const q = s.q || '';
  const url = base + (q ? (q.startsWith('?') ? q : '?' + q) : '');
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__ready === true || window.__error, null, { timeout: 180000 });
  if (s.eval) {
    await page.evaluate(`(async () => { ${s.eval} })()`);
  }
  const frames = +(s.frames || opt.frames || 12);
  const start = await page.evaluate(() => window.__frames || 0);
  await page.waitForFunction((n) => (window.__frames || 0) >= n || window.__error, start + frames, { timeout: 240000, polling: 50 });
  const wait = +(s.wait ?? opt.wait ?? 300);
  if (wait > 0) await page.waitForTimeout(wait);
  if (s.after) {
    await page.evaluate(`(async () => { ${s.after} })()`);
    const f = await page.evaluate(() => window.__frames || 0);
    await page.waitForFunction((n) => (window.__frames || 0) >= n || window.__error, f + 2, { timeout: 240000, polling: 50 });
  }
  const err = await page.evaluate(() => window.__error || null);
  if (err) errors.push('frame error: ' + err);
  // Freeze the render loop so the compositor can present the last frame.
  await page.evaluate(() => (window.__hold = true));
  await page.waitForTimeout(500);
  await page.screenshot({ path: out, timeout: 240000 });
  await page.evaluate(() => (window.__hold = false));
  const fps = await page.evaluate(() => window.__frames || 0);
  const ms = await page.evaluate(() => { const i = window.game?.pipeline?.renderer?.info?.render; return i ? i.calls + ' calls, ' + Math.round(i.triangles / 1000) + 'k tris' : ''; });
  console.log(`saved ${out}  (${((Date.now() - t0) / 1000).toFixed(1)}s, frames=${fps}, ${ms})`);
}
if (errors.length) {
  const uniq = [...new Set(errors)].slice(0, 40);
  console.error('--- page errors/warnings ---\n' + uniq.join('\n'));
}
await browser.close();
