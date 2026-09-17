/**
 * Headless smoke + playtest driver.
 * Usage: node tools/smoke.mjs [url] [outDir]
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const URL = process.argv[2] ?? 'http://localhost:5177/';
const OUT = process.argv[3] ?? 'shots';
const CHROME =
  process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';

mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const logs = [];
const errors = [];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--window-size=1600,900',
    '--autoplay-policy=no-user-gesture-required',
  ],
  defaultViewport: { width: 1600, height: 900 },
  protocolTimeout: 240000,
});

const page = await browser.newPage();
page.on('console', (m) => {
  const t = `[${m.type()}] ${m.text()}`;
  logs.push(t);
  if (m.type() === 'error') errors.push(t);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${e.stack ?? ''}`));
page.on('requestfailed', (r) => errors.push(`[reqfail] ${r.url()} ${r.failure()?.errorText}`));

const step = async (name, fn) => {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    console.log(`FAIL ${name}: ${e.message}`);
    errors.push(`[step:${name}] ${e.message}`);
  }
};

await step('load page', async () => {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('#boot-start', { visible: true, timeout: 90000 });
});
await page.screenshot({ path: `${OUT}/01-boot.png` });

await step('start game', async () => {
  await page.click('#boot-start');
  await page.waitForFunction(() => !document.getElementById('boot'), { timeout: 30000 });
  await sleep(3000);
});
await page.screenshot({ path: `${OUT}/02-arena-intro.png` });

await sleep(3500);
await page.screenshot({ path: `${OUT}/03-arena.png` });

await step('drop on centre x8', async () => {
  for (let i = 0; i < 8; i++) {
    await page.mouse.click(800, 470);
    await sleep(900);
  }
});
await page.screenshot({ path: `${OUT}/04-impact.png` });

await step('drop around the target', async () => {
  const pts = [
    [700, 430],
    [900, 430],
    [800, 400],
    [700, 500],
    [900, 500],
    [800, 520],
  ];
  for (const [x, y] of pts) {
    await page.mouse.click(x, y);
    await sleep(700);
  }
});
await page.screenshot({ path: `${OUT}/05-more-impacts.png` });

await step('open upgrades and buy', async () => {
  await page.click('#btn-upgrades');
  await sleep(700);
  await page.screenshot({ path: `${OUT}/06-upgrades.png` });
  const btns = await page.$$('.buy-btn');
  if (btns.length) {
    await btns[0].click();
    await sleep(500);
  }
  await page.screenshot({ path: `${OUT}/07-upgrades-bought.png` });
  await page.click('.close-btn');
  await sleep(400);
});

await step('settings panel', async () => {
  await page.click('#btn-settings');
  await sleep(500);
  await page.screenshot({ path: `${OUT}/08-settings.png` });
  await page.click('.close-btn');
  await sleep(300);
});

await step('target log', async () => {
  await page.click('#btn-targets');
  await sleep(500);
  await page.screenshot({ path: `${OUT}/09-targets.png` });
  await page.click('.close-btn');
  await sleep(300);
});

await step('rapid click stress', async () => {
  for (let i = 0; i < 24; i++) {
    const x = 700 + Math.random() * 200;
    const y = 400 + Math.random() * 140;
    await page.mouse.click(x, y);
    await sleep(120);
  }
  await sleep(2500);
});
await page.screenshot({ path: `${OUT}/10-stress.png` });

await step('drag to orbit', async () => {
  await page.mouse.move(800, 450);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(950, 470, { steps: 12 });
  await page.mouse.up({ button: 'right' });
  await sleep(900);
});
await page.screenshot({ path: `${OUT}/11-orbit.png` });

const state = await page.evaluate(() => ({
  coins: document.querySelector('.coin-value')?.textContent,
  progress: document.querySelector('.target-sub')?.textContent,
  target: document.querySelector('.target-name')?.textContent,
  chips: document.querySelectorAll('.tool-chip').length,
  fps: window.__fps ?? null,
}));

await step('reload and check save', async () => {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#boot-start', { visible: true, timeout: 60000 });
  await page.click('#boot-start');
  await sleep(2500);
  await page.screenshot({ path: `${OUT}/12-after-reload.png` });
});
const saved = await page.evaluate(() => ({
  coins: document.querySelector('.coin-value')?.textContent,
  progress: document.querySelector('.target-sub')?.textContent,
}));

console.log('\n--- state before reload ---');
console.log(JSON.stringify(state, null, 2));
console.log('--- state after reload ---');
console.log(JSON.stringify(saved, null, 2));
console.log(`\n--- console errors (${errors.length}) ---`);
for (const e of errors.slice(0, 30)) console.log(e);
console.log(`\n--- console log tail ---`);
for (const l of logs.slice(-15)) console.log(l);

await browser.close();
process.exit(errors.length ? 1 : 0);
