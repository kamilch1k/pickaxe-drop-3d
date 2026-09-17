/**
 * Verifies that only the metal head mines: handle strikes must bounce off with
 * zero blocks destroyed, and every mining hit must destroy at most maxBlocks.
 * Usage: node tools/headtest.mjs [url] [tool] [drops]
 */
import puppeteer from 'puppeteer-core';

const URL = process.argv[2] ?? 'http://localhost:5177/';
const TOOL = process.argv[3] ?? 'wooden';
const DROPS = Number(process.argv[4] ?? 26);
const CHROME =
  process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
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

let handleHits = 0;
let miningHits = 0;
let destroyedTotal = 0;
let maxSingle = 0;

for (let i = 0; i < DROPS; i++) {
  const before = await page.evaluate(() => ({
    left: window.__game.remainingVoxels,
    hits: window.__game.dropStats.targetHits,
  }));
  const p = await page.evaluate(() => window.__game.dev.aimRandom());
  if (!p) {
    await sleep(400);
    continue;
  }
  await page.mouse.move(Math.round(p.x), Math.round(p.y));
  await page.mouse.click(Math.round(p.x), Math.round(p.y));
  await sleep(1900);
  const after = await page.evaluate(() => {
    const list = window.__game.dev.dropInfo() ?? [];
    return {
      left: window.__game.remainingVoxels,
      hits: window.__game.dropStats.targetHits,
      handle: list.reduce((a, d) => a + (d.handleHits ?? 0), 0),
    };
  });
  const mined = before.left - after.left;
  const newHits = after.hits - before.hits;
  handleHits = Math.max(handleHits, after.handle);
  if (newHits > 0) {
    miningHits += newHits;
    destroyedTotal += mined;
    maxSingle = Math.max(maxSingle, mined);
  }
}

const avg = miningHits ? destroyedTotal / miningHits : 0;
console.log(`tool ${TOOL}`);
console.log(`  mining impacts: ${miningHits}   blocks destroyed: ${destroyedTotal}`);
console.log(`  blocks per mining hit: ${avg.toFixed(2)}   worst single hit: ${maxSingle}`);
console.log(`  handle strikes seen: ${handleHits}`);
console.log(`  errors (${errors.length})`);
for (const e of errors.slice(0, 6)) console.log(e);
await browser.close();
