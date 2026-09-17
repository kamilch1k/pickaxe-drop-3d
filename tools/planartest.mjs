/**
 * Planar-rigid-body verification for falling tools.
 * Checks the full 2.5D contract: X/Y free, Z locked, rotation about Z only.
 * Usage: node tools/planartest.mjs [url] [tool]
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const URL = process.argv[2] ?? 'http://localhost:5177/';
const TOOL = process.argv[3] ?? 'wooden';
const OUT = 'shots';
const CHROME =
  process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--no-sandbox',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--window-size=1280,720',
  ],
  defaultViewport: { width: 1280, height: 720 },
  protocolTimeout: 900000,
});
const page = await browser.newPage();
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`[console] ${m.text()}`);
});
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForSelector('#boot-start', { visible: true, timeout: 30000 });
await page.click('#boot-start');
await page.waitForFunction(() => !document.getElementById('boot'), { timeout: 30000 });
await sleep(4000);
await page.evaluate(() => window.__game.dev.lowQuality());
await page.evaluate((t) => {
  if (t !== 'wooden') window.__game.dev.grant(9_000_000);
  document.querySelector(`.tool-chip[data-id="${t}"]`)?.click();
}, TOOL);
await sleep(400);

const samples = [];
let maxOffAxis = 0;
let maxOffAxisVel = 0;
let maxZdrift = 0;
const drops = Number(process.argv[4] ?? 3);
/** per-drop z baseline, keyed by the drop's stable id */
const baselines = new Map();

for (let d = 0; d < drops; d++) {
  const p = await page.evaluate(() => window.__game.dev.aimRandom());
  if (!p) continue;
  await page.mouse.move(Math.round(p.x), Math.round(p.y));
  await page.mouse.click(Math.round(p.x), Math.round(p.y));
  for (let i = 0; i < 10; i++) {
    await sleep(200);
    const info = await page.evaluate(() => {
      const l = window.__game.dev.dropInfo();
      if (!l || !l.length) return null;
      // newest drop in flight
      return l.reduce((a, b) => (b.id > a.id ? b : a), l[0]);
    });
    if (!info) continue;
    if (!baselines.has(info.id)) baselines.set(info.id, info.z);
    maxZdrift = Math.max(maxZdrift, Math.abs(info.z - baselines.get(info.id)));
    if (Math.abs(info.vz) > 1e-9) maxOffAxisVel = Math.max(maxOffAxisVel, Math.abs(info.vz));
    maxOffAxis = Math.max(maxOffAxis, Math.hypot(info.angvel[0], info.angvel[1]));
    samples.push(info);
  }
  if (d === 0) await page.screenshot({ path: `${OUT}/planar-${TOOL}.png` });
  await sleep(700);
}

console.log(`tool: ${TOOL}   drops: ${drops}   samples: ${samples.length}   planes: ${baselines.size}`);
console.log(`max Z drift (per drop) ....... ${maxZdrift.toExponential(2)}  (must be 0)`);
console.log(`max |vz| ..................... ${maxOffAxisVel.toExponential(2)}  (must be 0)`);
console.log(`max off-axis |angvel x,y| .... ${maxOffAxis.toExponential(2)}  (must be 0)`);
const last = samples.at(-1);
console.log(`last sample: y=${last.y} vz=${last.vz} av=${JSON.stringify(last.angvel)}`);
const ok = maxZdrift < 1e-6 && maxOffAxisVel < 1e-9 && maxOffAxis < 1e-6;
console.log(ok ? 'PASS: planar rigid body (X/Y free, Z locked, Z-rotation only)' : 'FAIL');
console.log(`errors (${errors.length})`);
for (const e of errors.slice(0, 8)) console.log(e);
await browser.close();
process.exit(ok ? 0 : 1);
