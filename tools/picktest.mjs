/**
 * Verifies pickaxe behaviour: one block per hit, planar spin, size vs blocks.
 * Usage: node tools/picktest.mjs [url] [tool]
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
    '--window-size=1600,900',
  ],
  defaultViewport: { width: 1600, height: 900 },
  protocolTimeout: 900000,
});
const page = await browser.newPage();
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`[console] ${m.text()}`);
});
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForSelector('#boot-start', { visible: true, timeout: 90000 });
await page.click('#boot-start');
await page.waitForFunction(() => !document.getElementById('boot'), { timeout: 30000 });
await sleep(4500);
await page.evaluate(() => window.__game.dev.lowQuality());
await page.evaluate((t) => {
  if (t !== 'wooden') window.__game.dev.grant(9_000_000);
  document.querySelector(`.tool-chip[data-id="${t}"]`)?.click();
}, TOOL);
await sleep(500);

const state = () =>
  page.evaluate(() => ({
    left: window.__game.remainingVoxels,
    stats: window.__game.dropStats,
  }));

const before = await state();
console.log(`tool ${TOOL} · start ${before.left} blocks`);

const yields = [];
let prev = before.left;
for (let i = 0; i < 26; i++) {
  const p = await page.evaluate(() => window.__game.dev.aimRandom());
  if (!p) {
    await sleep(300);
    continue;
  }
  await page.mouse.move(Math.round(p.x), Math.round(p.y));
  await page.mouse.click(Math.round(p.x), Math.round(p.y));
  if (i === 0) {
    await sleep(320);
    await page.screenshot({ path: `${OUT}/pk-${TOOL}-falling.png` });
    await sleep(600);
    await page.screenshot({ path: `${OUT}/pk-${TOOL}-landing.png` });
    await sleep(900);
  } else {
    await sleep(1500);
  }
  const s = await state();
  if (s.left < prev) yields.push(prev - s.left);
  prev = s.left;
  if (i < 3) {
    const d = await page.evaluate(() => ({
      last: window.__game.dev.colliderInfo()?.lastDamage,
      drops: window.__game.dev.dropInfo(),
    }));
    console.log('  diag:', JSON.stringify(d));
  }
}
const after = await state();
console.log('hits:', after.stats.targetHits, 'yields:', yields.join(','));
const avg = yields.length ? yields.reduce((a, b) => a + b, 0) / yields.length : 0;
console.log(`avg blocks/hit: ${avg.toFixed(2)} over ${yields.length} hits`);
console.log('remaining:', after.left, `(destroyed ${before.left - after.left})`);
await page.screenshot({ path: `${OUT}/pk-${TOOL}-after.png` });
console.log(`errors (${errors.length})`);
for (const e of errors.slice(0, 8)) console.log(e);
await browser.close();
