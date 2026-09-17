/**
 * Triggers a target clear and captures the transition + next target.
 * Usage: node tools/finale.mjs [url]
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const URL = process.argv[2] ?? 'http://localhost:5177/';
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

// unlock everything, pick the nuke and use it on the first target
await page.evaluate(() => window.__game.dev.grant(9_000_000));
await page.evaluate(() => {
  document.querySelector('.tool-chip[data-id="nuke"]')?.click();
});
await sleep(600);

const info = () =>
  page.evaluate(() => ({
    target: document.querySelector('.target-name')?.textContent,
    progress: document.querySelector('.target-sub')?.textContent,
    coins: document.querySelector('.coin-value')?.textContent,
    left: window.__game.remainingVoxels,
  }));

console.log('before:', JSON.stringify(await info()));
for (let i = 0; i < 4; i++) {
  const p = await page.evaluate(() => window.__game.dev.aimRandom());
  if (!p) {
    await sleep(400);
    continue;
  }
  await page.mouse.click(Math.round(p.x), Math.round(p.y));
  await sleep(4500);
  const s = await info();
  console.log(`nuke ${i + 1}:`, JSON.stringify(s));
  if (s.target !== 'Stone Ore Chunk') break;
}
await page.screenshot({ path: `${OUT}/x01-finale.png` });
await sleep(3000);
await page.screenshot({ path: `${OUT}/x02-transition.png` });
await sleep(6000);
await page.screenshot({ path: `${OUT}/x03-next-target.png` });
console.log('after:', JSON.stringify(await info()));
console.log(`errors (${errors.length})`);
for (const e of errors.slice(0, 10)) console.log(e);
await browser.close();
