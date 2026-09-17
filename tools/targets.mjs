/**
 * Prints an ASCII front view of every target so the procedural silhouettes can
 * be reviewed without rendering. Usage: node tools/targets.mjs [url] [index]
 */
import puppeteer from 'puppeteer-core';

const URL = process.argv[2] ?? 'http://localhost:5177/';
const ONLY = process.argv[3] ? Number(process.argv[3]) : -1;
const CHROME =
  process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--no-sandbox',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--window-size=800,600',
  ],
  defaultViewport: { width: 800, height: 600 },
  protocolTimeout: 600000,
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForSelector('#boot-start', { visible: true, timeout: 90000 });
await page.click('#boot-start');
await page.waitForFunction(() => !document.getElementById('boot'), { timeout: 30000 });
await sleep(3500);
await page.evaluate(() => window.__game.dev.lowQuality());

const count = await page.evaluate(() =>
  document.querySelector('.target-name') ? 7 : 0,
);
void count;

for (let i = 0; i < 7; i++) {
  if (ONLY >= 0 && i !== ONLY) continue;
  await page.evaluate((idx) => window.__game.dev.setTarget(idx), i);
  await sleep(2600);
  const name = await page.$eval('.target-name', (e) => e.textContent);
  const info = await page.evaluate(() => ({
    left: window.__game.remainingVoxels,
    front: window.__game.dev.ascii('front'),
  }));
  console.log(`\n================ ${i}: ${name} (${info.left} voxels) ================`);
  console.log(info.front);
}

await browser.close();
