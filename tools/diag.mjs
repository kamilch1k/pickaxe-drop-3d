/**
 * Diagnostic: frame rate, drop stats per click, aim positions.
 * Usage: node tools/diag.mjs [url]
 */
import puppeteer from 'puppeteer-core';

const URL = process.argv[2] ?? 'http://localhost:5177/';
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
    '--window-size=1600,900',
  ],
  defaultViewport: { width: 1600, height: 900 },
  protocolTimeout: 600000,
});
const page = await browser.newPage();
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForSelector('#boot-start', { visible: true, timeout: 90000 });
await page.click('#boot-start');
await page.waitForFunction(() => !document.getElementById('boot'), { timeout: 30000 });
await sleep(4500);
await page.evaluate(() => window.__game.dev.lowQuality());
await sleep(400);

const fps = await page.evaluate(
  () =>
    new Promise((resolve) => {
      let frames = 0;
      const t0 = performance.now();
      const tick = () => {
        frames++;
        if (performance.now() - t0 < 2000) requestAnimationFrame(tick);
        else resolve((frames * 1000) / (performance.now() - t0));
      };
      requestAnimationFrame(tick);
    }),
);
console.log(`fps: ${fps.toFixed(1)}`);

const aim = await page.evaluate(() => window.__game.aimTargetScreen(0.55));
console.log('aim screen point:', JSON.stringify(aim));

for (let i = 0; i < 8; i++) {
  const p = await page.evaluate(() => window.__game.aimTargetScreen(0.45 + Math.random() * 0.3));
  await page.mouse.click(Math.round(p.x), Math.round(p.y));
  await sleep(1500);
  const s = await page.evaluate(() => ({
    stats: window.__game.dropStats,
    left: window.__game.remainingVoxels,
    coins: document.querySelector('.coin-value')?.textContent,
  }));
  console.log(`click ${i + 1}:`, JSON.stringify(s));
}
console.log(`errors (${errors.length}):`);
for (const e of errors) console.log(e);
await browser.close();
