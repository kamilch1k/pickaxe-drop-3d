/**
 * Focused playtest: find the target on screen, drop on it, verify voxels break.
 * Usage: node tools/playtest.mjs [url] [outDir]
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
page.on('requestfailed', (r) => errors.push(`[reqfail] ${r.url()} ${r.failure()?.errorText}`));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForSelector('#boot-start', { visible: true, timeout: 90000 });
await page.click('#boot-start');
await page.waitForFunction(() => !document.getElementById('boot'), { timeout: 30000 });
await sleep(5200);

/** Where is the target on screen? Sample a vertical/horizontal grid of colours. */
const centre = await page.evaluate(() => {
  const canvas = document.getElementById('game-canvas');
  const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  const w = canvas.width;
  const h = canvas.height;
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  // find the centroid of "bright grey" pixels (the stone rock)
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < h; y += 4) {
    for (let x = 0; x < w; x += 4) {
      const i = ((h - 1 - y) * w + x) * 4;
      const r = px[i];
      const g = px[i + 1];
      const b = px[i + 2];
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      if (mx > 110 && mx - mn < 26 && r >= g - 6 && g >= b - 6) {
        sx += x;
        sy += y;
        n++;
      }
    }
  }
  const dpr = w / window.innerWidth;
  return n > 200 ? { x: sx / n / dpr, y: sy / n / dpr, n } : null;
});
console.log('target centroid:', JSON.stringify(centre));

const aimX = centre?.x ?? 800;
const aimY = centre?.y ?? 560;

const dropAt = async (x, y, wait = 1150) => {
  await page.mouse.click(Math.round(x), Math.round(y));
  await sleep(wait);
};

const read = () =>
  page.evaluate(() => ({
    coins: document.querySelector('.coin-value')?.textContent,
    progress: document.querySelector('.target-sub')?.textContent,
  }));

console.log('start:', JSON.stringify(await read()));
await page.screenshot({ path: `${OUT}/p01-before.png` });

for (let i = 0; i < 6; i++) await dropAt(aimX, aimY);
console.log('after 6 centre drops:', JSON.stringify(await read()));
await page.screenshot({ path: `${OUT}/p02-centre-drops.png` });

for (let i = 0; i < 8; i++) {
  await dropAt(aimX + (Math.random() - 0.5) * 110, aimY + (Math.random() - 0.5) * 70);
}
console.log('after 14 drops:', JSON.stringify(await read()));
await page.screenshot({ path: `${OUT}/p03-spread-drops.png` });

// keep hammering until the first target falls (or we give up)
let cleared = false;
for (let i = 0; i < 130 && !cleared; i++) {
  await dropAt(aimX + (Math.random() - 0.5) * 170, aimY + (Math.random() - 0.5) * 110, 380);
  if (i % 12 === 11) {
    const s = await read();
    console.log(`  ...${i + 1} drops`, JSON.stringify(s));
    if (i === 11) await page.screenshot({ path: `${OUT}/p04-mid.png` });
  }
  const title = await page.$eval('.target-name', (e) => e.textContent);
  if (title !== 'Stone Ore Chunk') cleared = true;
}
console.log('cleared first target:', cleared);
await sleep(2500);
await page.screenshot({ path: `${OUT}/p05-after-clear.png` });
console.log('state:', JSON.stringify(await read()));

const chips = await page.$$eval('.tool-chip .name', (els) => els.map((e) => e.textContent));
console.log('dock:', JSON.stringify(chips));

// buy the iron pickaxe if affordable
const bought = await page.evaluate(() => {
  const chips = [...document.querySelectorAll('.tool-chip')];
  const iron = chips.find((c) => c.querySelector('.name')?.textContent?.includes('Iron'));
  if (iron) {
    iron.click();
    return true;
  }
  return false;
});
await sleep(800);
await page.screenshot({ path: `${OUT}/p06-iron.png` });
console.log('clicked iron chip:', bought, JSON.stringify(await read()));

console.log(`\nerrors (${errors.length}):`);
for (const e of errors.slice(0, 20)) console.log(e);
await browser.close();
