/**
 * Deterministic check of the stick path: force the stick dials wide open and
 * confirm pickaxes actually enter the STUCK state and then despawn.
 * Usage: node tools/sticktest.mjs [url]
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
await sleep(3500);
await page.evaluate(() => window.__game.dev.grant(9_000_000));
await page.evaluate(() => window.__game.dev.lowQuality());
await page.evaluate(() => window.__game.dev.setTarget(5)); // obsidian beast
await page.evaluate(() =>
  window.__game.dev.tuning({
    stickProbability: 1,
    stickAlignmentThreshold: -1,
    stickMinSpeed: 0,
    penetrationEnergyThreshold: 1e9, // never penetrate: force the stick branch
  }),
);
await sleep(6000);

let sawStuck = 0;
for (let i = 0; i < 8; i++) {
  const p = await page.evaluate(() => window.__game.dev.aimRandom());
  if (!p) {
    await sleep(300);
    continue;
  }
  await page.mouse.move(Math.round(p.x), Math.round(p.y));
  await page.mouse.click(Math.round(p.x), Math.round(p.y));
  await sleep(1400);
  const n = await page.evaluate(
    () => window.__game.dev.dropInfo().filter((d) => d.stuck).length,
  );
  sawStuck = Math.max(sawStuck, n);
  console.log(`drop ${i + 1}: stuck bodies = ${n}`);
}
await sleep(4000);
const end = await page.evaluate(() => ({
  drops: window.__game.dev.dropInfo(),
  stuckNow: window.__game.dev.dropInfo().filter((d) => d.stuck).length,
}));
console.log(`stuck now (after linger): ${end.stuckNow}   live drops: ${end.drops.length}`);
console.log(`stuck observed at peak: ${sawStuck}`);
console.log(`errors (${errors.length})`);
for (const e of errors.slice(0, 6)) console.log(e);
await browser.close();
process.exit(sawStuck > 0 && errors.length === 0 ? 0 : 1);
