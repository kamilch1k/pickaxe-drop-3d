/**
 * Shows each target in the arena for visual review.
 * Usage: node tools/targetshots.mjs [url] [index...]
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const URL = process.argv[2] ?? 'http://localhost:5177/';
const INDEXES = process.argv.slice(3).map(Number).filter((n) => !Number.isNaN(n));
const OUT = 'shots';
const CHROME =
  process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  protocolTimeout: 600000,
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[console]', m.text());
});
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForSelector('#boot-start', { visible: true, timeout: 90000 });
await page.click('#boot-start');
await page.waitForFunction(() => !document.getElementById('boot'), { timeout: 30000 });
await sleep(4000);

const list = INDEXES.length ? INDEXES : [0, 1, 2, 3, 4, 5, 6];
for (const i of list) {
  await page.evaluate((idx) => window.__game.dev.setTarget(idx), i);
  await sleep(7000);
  await page.screenshot({ path: `${OUT}/t${i}.png` });
  const info = await page.evaluate(() => ({
    left: window.__game.remainingVoxels,
    name: document.querySelector('.target-name')?.textContent,
  }));
  console.log(`t${i}: ${info.name} — ${info.left} voxels`);
}
await browser.close();
