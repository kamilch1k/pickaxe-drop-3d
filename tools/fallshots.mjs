/**
 * Captures a single falling pickaxe at several moments to eyeball in-plane spin.
 * Usage: node tools/fallshots.mjs [url] [tool]
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const URL = process.argv[2] ?? 'http://localhost:5177/';
const TOOL = process.argv[3] ?? 'wooden';
const OUT = 'shots';
mkdirSync(OUT, { recursive: true });
const CHROME =
  process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1600,900'],
  defaultViewport: { width: 1600, height: 900 },
  protocolTimeout: 600000,
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForSelector('#boot-start', { visible: true, timeout: 30000 });
await page.click('#boot-start');
await page.waitForFunction(() => !document.getElementById('boot'), { timeout: 30000 });
await sleep(4000);
await page.evaluate((t) => {
  if (t !== 'wooden') window.__game.dev.grant(9_000_000);
  document.querySelector(`.tool-chip[data-id="${t}"]`)?.click();
}, TOOL);
await sleep(400);

const p = await page.evaluate(() => window.__game.dev.aimRandom());
await page.mouse.move(Math.round(p.x), Math.round(p.y));
await sleep(300);
await page.mouse.click(Math.round(p.x), Math.round(p.y));
for (let i = 0; i < 5; i++) {
  await sleep(i === 0 ? 120 : 260);
  await page.screenshot({ path: `${OUT}/fall-${TOOL}-${i}.png` });
}
console.log('captured 5 frames');
await browser.close();
