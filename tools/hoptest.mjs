/**
 * Penetration contract: destroying a block must NOT stop the pickaxe dead.
 * After every mining hit the tool should still be carrying real speed, either
 * continuing through the crater (penetration) or rebounding off it (bounce).
 *
 * This replaces the old "hop" test: the artificial upward pop after a bite was
 * removed with the Rapier path, and the hand-written solver produces the motion
 * from restitution + penetration instead.
 *
 * Usage: node tools/hoptest.mjs [url] [tool] [drops]
 */
import puppeteer from 'puppeteer-core';

const URL = process.argv[2] ?? 'http://localhost:5177/';
const TOOL = process.argv[3] ?? 'wooden';
const DROPS = Number(process.argv[4] ?? 20);
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

let hits = 0;
let moving = 0;
let minSpeedAfter = Infinity;
let sumSpeedAfter = 0;

for (let i = 0; i < DROPS; i++) {
  const before = await page.evaluate(() => window.__game.dropStats.targetHits);
  const p = await page.evaluate(() => window.__game.dev.aimRandom());
  if (!p) {
    await sleep(350);
    continue;
  }
  await page.mouse.move(Math.round(p.x), Math.round(p.y));
  await page.mouse.click(Math.round(p.x), Math.round(p.y));

  // sample the newest drop right after the bite lands
  let speed = 0;
  for (let s = 0; s < 16; s++) {
    await sleep(70);
    const hitNow = await page.evaluate(() => window.__game.dropStats.targetHits);
    if (hitNow > before) {
      const d = await page.evaluate(() => {
        const l = window.__game.dev.dropInfo();
        return l && l.length ? l.reduce((a, b) => (b.id > a.id ? b : a), l[0]) : null;
      });
      speed = d ? d.speed : 0;
      break;
    }
  }
  if (speed > 0) {
    hits++;
    sumSpeedAfter += speed;
    minSpeedAfter = Math.min(minSpeedAfter, speed);
    if (speed > 1.5) moving++;
    console.log(`  drop ${i + 1}: speed right after the bite ${speed.toFixed(2)} m/s`);
  }
}

console.log(`\ntool ${TOOL}: ${hits} bites measured`);
if (hits) {
  console.log(`  avg speed after a bite: ${(sumSpeedAfter / hits).toFixed(2)} m/s`);
  console.log(`  slowest after a bite ...: ${minSpeedAfter.toFixed(2)} m/s`);
  console.log(`  still moving (>1.5 m/s): ${moving}/${hits}`);
}
console.log(`errors (${errors.length})`);
for (const e of errors.slice(0, 6)) console.log(e);
await browser.close();
