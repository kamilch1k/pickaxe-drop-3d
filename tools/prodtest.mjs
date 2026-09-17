/**
 * Production smoke test against the built bundle (no dev hooks available).
 * Usage: node tools/prodtest.mjs [url]
 */
import puppeteer from 'puppeteer-core';

const URL = process.argv[2] ?? 'http://localhost:4177/';
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
  protocolTimeout: 600000,
});
const page = await browser.newPage();
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`[console] ${m.text()}`);
});
page.on('requestfailed', (r) => errors.push(`[reqfail] ${r.url()} ${r.failure()?.errorText}`));

const state = () =>
  page.evaluate(() => ({
    coins: document.querySelector('.coin-value')?.textContent,
    progress: document.querySelector('.target-sub')?.textContent,
    target: document.querySelector('.target-name')?.textContent,
    hasDevHooks: typeof window.__game !== 'undefined',
  }));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForSelector('#boot-start', { visible: true, timeout: 90000 });
console.log('boot ok');
await page.click('#boot-start');
await page.waitForFunction(() => !document.getElementById('boot'), { timeout: 30000 });
await sleep(5000);
await page.screenshot({ path: 'shots/prod-01.png' });
console.log('start:', JSON.stringify(await state()));

// click around where the rock should be, with the pointer over the canvas
for (let i = 0; i < 14; i++) {
  const x = 560 + Math.round(Math.random() * 180);
  const y = 330 + Math.round(Math.random() * 90);
  await page.mouse.click(x, y);
  await sleep(1400);
}
await page.screenshot({ path: 'shots/prod-02.png' });
const after = await state();
console.log('after drops:', JSON.stringify(after));

// ui still responsive?
await page.click('#btn-upgrades');
await sleep(600);
const buyEnabled = await page.$$eval('.buy-btn', (els) => els.length);
await page.screenshot({ path: 'shots/prod-03.png' });
await page.click('.close-btn');
await sleep(300);
console.log('upgrade rows:', buyEnabled);

const ok = Number((after.coins ?? '0').replace(/[^0-9]/g, '')) > 0 && !after.hasDevHooks;
console.log(ok ? 'PASS: destruction + coins + no dev hooks' : 'FAIL');
console.log(`errors (${errors.length})`);
for (const e of errors.slice(0, 12)) console.log(e);
await browser.close();
process.exit(errors.length ? 1 : 0);
