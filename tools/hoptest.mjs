/**
 * Verifies the pickaxe hops upward after a successful mining hit.
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

let hops = 0;
let miningHits = 0;
let bestRise = 0;

for (let i = 0; i < DROPS; i++) {
  const before = await page.evaluate(() => window.__game.dropStats.targetHits);
  const p = await page.evaluate(() => window.__game.dev.aimRandom());
  if (!p) {
    await sleep(350);
    continue;
  }
  await page.mouse.move(Math.round(p.x), Math.round(p.y));
  await page.mouse.click(Math.round(p.x), Math.round(p.y));

  // watch the newest drop well past its landing moment for an upward phase
  let lowest = Infinity;
  let lowestAt = -1;
  let rose = 0;
  let peakVy = -99;
  const trace = [];
  for (let s = 0; s < 34; s++) {
    await sleep(200);
    const d = await page.evaluate(() => {
      const l = window.__game.dev.dropInfo();
      if (!l || !l.length) return null;
      return l.reduce((a, b) => (b.id > a.id ? b : a), l[0]);
    });
    if (!d) continue;
    trace.push(`${d.y.toFixed(1)}/${d.vy.toFixed(1)}`);
    if (d.y < lowest) {
      lowest = d.y;
      lowestAt = trace.length - 1;
    }
    rose = Math.max(rose, d.y - lowest);
    peakVy = Math.max(peakVy, d.vy);
  }
  const after = await page.evaluate(() => window.__game.dropStats.targetHits);
  if (after > before) {
    miningHits++;
    if (rose > 0.12) hops++;
    bestRise = Math.max(bestRise, rose);
    console.log(
      `  drop ${i + 1}: mined · rebound ${rose.toFixed(2)}u · peak vy ${peakVy.toFixed(2)} m/s`,
    );
    if (i === 0) console.log(`    trace y/vy: ${trace.join('  ')}`);
  }
}

console.log(`\ntool ${TOOL}: ${miningHits} mining hits, ${hops} with a visible upward rebound`);
console.log(`largest rebound: ${bestRise.toFixed(2)} units`);
console.log(`errors (${errors.length})`);
for (const e of errors.slice(0, 6)) console.log(e);
await browser.close();
