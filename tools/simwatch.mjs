/**
 * Watch every live solver body's speed, spin and last contact over time, to
 * find runaway bodies. Usage: node tools/simwatch.mjs [url] [count] [tool]
 */
import puppeteer from 'puppeteer-core';

const URL = process.argv[2] ?? 'http://localhost:5177/';
const COUNT = Number(process.argv[3] ?? 10);
const TOOL = process.argv[4] ?? 'wooden';
const CHROME =
  process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1024, height: 640 },
  protocolTimeout: 600000,
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
await sleep(3000);
await page.evaluate(() => window.__game.dev.grant(9_000_000));
await page.evaluate(() => window.__game.dev.lowQuality());
await page.evaluate(() => window.__game.dev.lab());
await sleep(2600);
await page.evaluate(([n, t]) => window.__game.dev.dropMany(n, t), [COUNT, TOOL]);

for (let i = 0; i < 60; i++) {
  await sleep(200);
  const info = await page.evaluate(() => window.__game.dev.simInfo());
  const buried = info.drops
    .map((d, idx) => ({ ...d, idx }))
    .filter((d) => d.y < 0.2);
  if (buried.length) {
    console.log(
      `${(i * 0.2).toFixed(1)}s  BURIED ${buried
        .map(
          (d) =>
            `#${d.idx} y=${d.y} x=${d.x} z=${d.z} vy=${d.vy} vh=${d.vh} v=${d.speed} sleep=${d.sleeping ? 'Y' : 'n'} [${d.contact}]`,
        )
        .join(' | ')}`,
    );
  }
  const fast = info.drops
    .map((d, idx) => ({ ...d, idx }))
    .filter((d) => d.speed > 1.5 || d.spin > 2)
    .sort((a, b) => b.speed - a.speed)
    .slice(0, 3);
  const asleep = info.drops.filter((d) => d.sleeping).length;
  if (!fast.length) {
    console.log(`${(i * 0.2).toFixed(1)}s  all slow (${asleep}/${info.drops.length} asleep)`);
    continue;
  }
  console.log(
    `${(i * 0.2).toFixed(1)}s  asleep=${asleep}  ${fast
      .map(
        (d) =>
          `#${d.idx} v=${d.speed} spin=${d.spin} y=${d.y} x=${d.x} z=${d.z} vy=${d.vy} vh=${d.vh} [${d.contact}]`,
      )
      .join(' | ')}`,
  );
}
console.log(`errors (${errors.length})`);
for (const e of errors.slice(0, 6)) console.log(e);
await browser.close();
