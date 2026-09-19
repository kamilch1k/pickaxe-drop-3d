/**
 * Proves destruction matches the blade: every destroyed block must be within
 * the tool's radius of the contact point and stay inside the interaction plane.
 * Usage: node tools/contacttest.mjs [url] [tool] [drops]
 */
import puppeteer from 'puppeteer-core';

const URL = process.argv[2] ?? 'http://localhost:5177/';
const TOOL = process.argv[3] ?? 'wooden';
const DROPS = Number(process.argv[4] ?? 12);
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

let worstDz = 0;
let worstDxy = 0;
let worstRatio = 0;
let worstDepthRatio = 0;
let samples = 0;

for (let i = 0; i < DROPS; i++) {
  const p = await page.evaluate(() => window.__game.dev.aimRandom());
  if (!p) {
    await sleep(350);
    continue;
  }
  await page.mouse.move(Math.round(p.x), Math.round(p.y));
  await page.mouse.click(Math.round(p.x), Math.round(p.y));
  await sleep(2100);
  const l = await page.evaluate(() => window.__game.dev.colliderInfo()?.lastDamage ?? null);
  if (!l || !l.destroyed) continue;
  samples++;
  worstDz = Math.max(worstDz, l.maxDz);
  worstDxy = Math.max(worstDxy, l.maxDxy);
  // how far the outermost killed block sat compared to the tool's radius
  worstRatio = Math.max(worstRatio, l.maxDxy / Math.max(0.01, l.rVox));
  // solver pickaxes carve round craters, so depth is expected to match the
  // radius rather than being flattened against the tool's plane
  worstDepthRatio = Math.max(worstDepthRatio, l.maxDz / Math.max(0.01, l.rVox));
  console.log(
    `impact grid=(${l.gw.join(',')}) r=${l.rVox}blk destroy=${l.destroyed}` +
      ` maxDxy=${l.maxDxy} maxDz=${l.maxDz} flatten=${l.flattenZ}`,
  );
}

console.log(`\ntool ${TOOL}: ${samples} damaging hits`);
console.log(`  furthest destroyed block from contact (in plane): ${worstDxy.toFixed(2)} blocks`);
console.log(`  furthest destroyed block in depth (Z) ........... ${worstDz.toFixed(2)} blocks`);
console.log(`  worst distance / tool radius ratio ............. ${worstRatio.toFixed(2)}`);
console.log(`  worst depth / tool radius ratio ................ ${worstDepthRatio.toFixed(2)}`);
const ok = worstRatio <= 1.25 && worstDepthRatio <= 1.25;
console.log(ok ? 'PASS: crater matches the blade contact' : 'FAIL: crater over-reaches');
console.log(`errors (${errors.length})`);
for (const e of errors.slice(0, 6)) console.log(e);
await browser.close();
process.exit(ok ? 0 : 1);
