/**
 * Measures how many drops a target really takes when aiming like a player
 * (random surface voxels). Usage: node tools/pacing.mjs [url] [targetIndex] [tool]
 */
import puppeteer from 'puppeteer-core';

const URL = process.argv[2] ?? 'http://localhost:5177/';
const INDEX = Number(process.argv[3] ?? 0);
const TOOL = process.argv[4] ?? '';
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
    '--window-size=1024,640',
  ],
  defaultViewport: { width: 1024, height: 640 },
  protocolTimeout: 900000,
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
await page.evaluate(() => window.__game.dev.lowQuality());
if (TOOL) {
  await page.evaluate(() => window.__game.dev.grant(9_000_000));
  await page.evaluate((t) => {
    document.querySelector(`.tool-chip[data-id="${t}"]`)?.click();
  }, TOOL);
  await sleep(500);
}
if (INDEX > 0) {
  await page.evaluate((i) => window.__game.dev.setTarget(i), INDEX);
  await sleep(6000);
}

const fps = await page.evaluate(
  () =>
    new Promise((resolve) => {
      let frames = 0;
      const t0 = performance.now();
      const tick = () => {
        frames++;
        if (performance.now() - t0 < 1500) requestAnimationFrame(tick);
        else resolve((frames * 1000) / (performance.now() - t0));
      };
      requestAnimationFrame(tick);
    }),
);
console.log(`fps ${fps.toFixed(1)} · target ${INDEX} · tool ${TOOL || 'default'}`);

const start = await page.evaluate(() => ({
  left: window.__game.remainingVoxels,
  name: document.querySelector('.target-name')?.textContent,
  coins: document.querySelector('.coin-value')?.textContent,
}));
console.log('start:', JSON.stringify(start));

let drops = 0;
let prev = start.left;
let cleared = false;
for (let i = 0; i < 140 && !cleared; i++) {
  const p = await page.evaluate(() => window.__game.dev.aimRandom());
  if (!p) {
    await sleep(300);
    continue;
  }
  await page.mouse.click(Math.round(p.x), Math.round(p.y));
  drops++;
  await sleep(1100);
  const s = await page.evaluate(() => ({
    left: window.__game.remainingVoxels,
    name: document.querySelector('.target-name')?.textContent,
  }));
  if (s.name !== start.name) {
    cleared = true;
    console.log(`CLEARED in ${drops} drops`);
    break;
  }
  if (i % 10 === 9) {
    console.log(`  ${drops} drops → ${s.left} left (last 10: ${prev - s.left})`);
  }
  prev = s.left;
}
const end = await page.evaluate(() => ({
  left: window.__game.remainingVoxels,
  name: document.querySelector('.target-name')?.textContent,
  coins: document.querySelector('.coin-value')?.textContent,
}));
console.log('end:', JSON.stringify(end), 'drops:', drops);
console.log(`errors (${errors.length})`);
for (const e of errors.slice(0, 8)) console.log(e);
await browser.close();
