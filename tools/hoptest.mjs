/**
 * Break-rebound contract (the Astra "hop"): smashing a block must kick the
 * pickaxe out of the crater instead of letting it drill down the column.
 *
 * Watches the newest drop around each mining hit and reports the upward speed
 * right after the bite and whether it actually rose afterwards.
 *
 * Usage: node tools/hoptest.mjs [url] [tool] [drops]
 */
import puppeteer from 'puppeteer-core';

const URL = process.argv[2] ?? 'http://localhost:5177/';
const TOOL = process.argv[3] ?? 'wooden';
const DROPS = Number(process.argv[4] ?? 18);
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
let hopped = 0;
let minVyAfter = Infinity;
let bestRise = 0;

for (let i = 0; i < DROPS; i += 1) {
  const before = await page.evaluate(() => window.__game.dev.simInfo().broken);
  const p = await page.evaluate(() => window.__game.dev.aimRandom());
  if (!p) {
    await sleep(300);
    continue;
  }
  await page.mouse.move(Math.round(p.x), Math.round(p.y));
  await page.mouse.click(Math.round(p.x), Math.round(p.y));

  // One drop at a time: the newest body is the only one that can bite here.
  let lowest = Infinity;
  let highest = -Infinity;
  let peakVy = -Infinity;
  let broke = false;
  for (let s = 0; s < 60; s += 1) {
    await sleep(60);
    const snap = await page.evaluate(() => window.__game.dev.simInfo());
    const d = snap.drops[snap.drops.length - 1];
    if (!d) break;
    if (snap.broken > before) broke = true;
    if (!broke) continue;
    lowest = Math.min(lowest, d.y);
    highest = Math.max(highest, d.y);
    peakVy = Math.max(peakVy, d.vy);
  }
  if (broke) {
    const rise = Math.max(0, highest - lowest);
    hits += 1;
    minVyAfter = Math.min(minVyAfter, peakVy);
    if (rise > 0.25 || peakVy > 3) hopped += 1;
    bestRise = Math.max(bestRise, rise);
    console.log(
      `  drop ${i + 1}: rose ${rise.toFixed(2)} m after the bite, peak vy ${peakVy.toFixed(2)} m/s`,
    );
  } else {
    console.log(`  drop ${i + 1}: no bite`);
  }
  await sleep(600);
}

console.log(`\ntool ${TOOL}: ${hits} bites observed`);
if (hits) {
  console.log(`  kicked upward (>3 m/s): ${hopped}/${hits}`);
  console.log(`  slowest rebound: ${minVyAfter.toFixed(2)} m/s`);
  console.log(`  largest rise after a bite: ${bestRise.toFixed(2)} m`);
}
console.log(`errors (${errors.length})`);
for (const e of errors.slice(0, 6)) console.log(e);
await browser.close();
