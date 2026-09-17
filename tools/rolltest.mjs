/**
 * Focused rolling-sphere behaviour test: drop a boulder and watch it chew.
 * Usage: node tools/rolltest.mjs [url] [targetIndex]
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const URL = process.argv[2] ?? 'http://localhost:5177/';
const INDEX = Number(process.argv[3] ?? 3);
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
  protocolTimeout: 600000,
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
await sleep(4000);
await page.evaluate(() => window.__game.dev.grant(9_000_000));
await page.evaluate((i) => window.__game.dev.setTarget(i), INDEX);
await sleep(7000);
await page.evaluate(() => window.__game.dev.lowQuality());
await page.evaluate((toolId) => {
  document.querySelector(`.tool-chip[data-id="${toolId}"]`)?.click();
}, process.env.TOOL || 'boulder');
await sleep(600);

const left = () => page.evaluate(() => window.__game.remainingVoxels);
const before = await left();
console.log('colliders:', JSON.stringify(await page.evaluate(() => window.__game.dev.colliderInfo())));
const p = await page.evaluate(() => window.__game.aimTargetScreen(0.82) ?? window.__game.dev.aimRandom());
console.log('start left:', before, 'aim:', JSON.stringify(p));
await page.mouse.click(Math.round(p.x), Math.round(p.y));
for (let i = 0; i < 10; i++) {
  await sleep(1200);
  const info = await page.evaluate(() => ({
    left: window.__game.remainingVoxels,
    stats: window.__game.dropStats,
    drops: window.__game.dev.dropInfo(),
    col: window.__game.dev.colliderInfo(),
  }));
  console.log(`  t+${((i + 1) * 1.2).toFixed(1)}s → ${info.left} left | ${JSON.stringify(info.drops)} | ${JSON.stringify(info.stats)}`);
  if (i === 2) await page.screenshot({ path: `${OUT}/roll-early.png` });
  if (i === 6) await page.screenshot({ path: `${OUT}/roll-mid.png` });
}
await page.screenshot({ path: `${OUT}/roll-late.png` });
console.log(`errors (${errors.length})`);
for (const e of errors.slice(0, 8)) console.log(e);
await browser.close();
