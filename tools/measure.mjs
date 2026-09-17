/**
 * Measures real per-drop yield by aiming exactly at the target through the
 * game's own dev hooks. Usage: node tools/measure.mjs [url] [drops]
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const URL = process.argv[2] ?? 'http://localhost:5177/';
const DROPS = Number(process.argv[3] ?? 40);
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
    '--autoplay-policy=no-user-gesture-required',
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
await sleep(5000);
await page.screenshot({ path: `${OUT}/m01-start.png` });

const read = () =>
  page.evaluate(() => ({
    coins: document.querySelector('.coin-value')?.textContent,
    progress: document.querySelector('.target-sub')?.textContent,
    target: document.querySelector('.target-name')?.textContent,
    left: window.__game?.remainingVoxels ?? -1,
  }));

const start = await read();
console.log('start:', JSON.stringify(start));

let prevLeft = start.left;
const yields = [];
for (let i = 0; i < DROPS; i++) {
  const p = await page.evaluate(() => window.__game?.aimTargetScreen(0.55) ?? null);
  if (!p) {
    console.log('no aim target');
    break;
  }
  await page.mouse.click(Math.round(p.x), Math.round(p.y));
  await sleep(1700);
  const s = await read();
  if (s.target !== start.target) {
    console.log(`target cleared after ${i + 1} drops`);
    break;
  }
  yields.push(prevLeft - s.left);
  prevLeft = s.left;
  if (i % 5 === 4) {
    console.log(
      `  drop ${i + 1}: last yields ${yields.slice(-5).join(',')} | left ${s.left} | ${s.progress} | ${s.coins}`,
    );
  }
}
const avg = yields.length ? yields.reduce((a, b) => a + b, 0) / yields.length : 0;
console.log(`avg yield ${avg.toFixed(1)} voxels/drop over ${yields.length} drops`);
console.log('final:', JSON.stringify(await read()));
await page.screenshot({ path: `${OUT}/m02-after.png` });
console.log(`errors (${errors.length}):`);
for (const e of errors.slice(0, 10)) console.log(e);
await browser.close();
