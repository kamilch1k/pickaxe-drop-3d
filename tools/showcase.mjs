/**
 * Captures the late-game toys in action for review.
 * Usage: node tools/showcase.mjs [url]
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
await page.evaluate(() => window.__game.dev.grant(9_000_000));
await sleep(400);

const shoot = async (tool, target, waitMs, tag) => {
  await page.evaluate((i) => window.__game.dev.setTarget(i), target);
  await sleep(6500);
  await page.evaluate((t) => {
    document.querySelector(`.tool-chip[data-id="${t}"]`)?.click();
  }, tool);
  await sleep(700);
  const p = await page.evaluate(() => window.__game.dev.aimRandom());
  if (!p) {
    console.log(`  ${tag}: no aim`);
    return;
  }
  await page.mouse.click(Math.round(p.x), Math.round(p.y));
  const shots = [0.15, 0.45, 0.8];
  for (const f of shots) {
    await sleep(waitMs * f);
    await page.screenshot({ path: `${OUT}/s-${tag}-${Math.round(f * 100)}.png` });
  }
  const s = await page.evaluate(() => ({
    progress: document.querySelector('.target-sub')?.textContent,
    coins: document.querySelector('.coin-value')?.textContent,
  }));
  console.log(`  ${tag}: ${s.progress} | ${s.coins}`);
};

console.log('showcase:');
await shoot('rain', 0, 7000, 'rain');
await shoot('boulder', 1, 7000, 'boulder');
await shoot('saw', 3, 7000, 'saw');
await shoot('drill', 3, 8000, 'drill');
await shoot('meteor', 4, 8000, 'meteor-ooga');
await shoot('nuke', 5, 9000, 'nuke-beast');

console.log(`errors (${errors.length})`);
for (const e of errors.slice(0, 10)) console.log(e);
await browser.close();
