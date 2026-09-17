/**
 * Visual QA: boots the game and captures frames at several viewports.
 * Usage: node tools/shots.mjs [url] [outDir]
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const URL = process.argv[2] ?? 'http://localhost:5177/';
const OUT = process.argv[3] ?? 'shots';
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
    '--window-size=1920,1080',
  ],
  defaultViewport: { width: 1920, height: 1080 },
  protocolTimeout: 600000,
});
const page = await browser.newPage();
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`[console] ${m.text()}`);
});

const capture = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`shot ${name}`);
};

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForSelector('#boot-start', { visible: true, timeout: 90000 });
await capture('v00-boot');
await page.click('#boot-start');
await page.waitForFunction(() => !document.getElementById('boot'), { timeout: 30000 });
await sleep(5500);
await capture('v01-arena-1080p');

// aim at the target and drop a couple of times, then capture mid-impact
const dropOnTarget = async (offset = 0.6) => {
  const p = await page.evaluate((o) => window.__game.aimTargetScreen(o), offset);
  if (!p) return null;
  await page.mouse.move(Math.round(p.x), Math.round(p.y));
  await sleep(600);
  await page.mouse.click(Math.round(p.x), Math.round(p.y));
  return p;
};
await dropOnTarget(0.6);
await sleep(700);
await capture('v02-falling');
await sleep(1200);
await capture('v03-impact');

for (let i = 0; i < 5; i++) {
  await dropOnTarget(0.5 + Math.random() * 0.3);
  await sleep(1500);
}
await capture('v04-crater');

// dialogs
await page.click('#btn-upgrades');
await sleep(800);
await capture('v05-upgrades');
await page.click('.close-btn');
await sleep(400);

// small viewport
await page.setViewport({ width: 1280, height: 720 });
await sleep(1200);
await capture('v06-1280x720');
await page.setViewport({ width: 900, height: 600 });
await sleep(1200);
await capture('v07-900x600');
await page.setViewport({ width: 1920, height: 1080 });
await sleep(1000);

// mid/late game: unlock everything and blow up the mythic core
await page.evaluate(() => {
  const g = window.__game;
  g.grantForTesting ? g.grantForTesting() : null;
});

console.log(`errors (${errors.length}):`);
for (const e of errors) console.log(e);
await browser.close();
