/**
 * Profiles the running game: per-subsystem CPU ms, draw calls, and entity
 * counts under heavy destruction.
 * Usage: node tools/profile.mjs [url]
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

const report = async (label) => {
  const r = await page.evaluate(() => window.__game.dev.profileReport());
  console.log(`\n== ${label} ==`);
  console.log('  frames', r.frames, ' avg ms:', JSON.stringify(r.avg));
  console.log('  render:', JSON.stringify(r.render));
  console.log('  counts:', JSON.stringify(r.counts));
};

await page.evaluate(() => window.__game.dev.grant(9_000_000));
await page.evaluate((i) => window.__game.dev.setTarget(i), 5); // obsidian beast
await sleep(7000);

// idle baseline
await page.evaluate(() => window.__game.dev.profile(true));
await sleep(3000);
await report('idle, beast loaded');
const probe = await page.evaluate(() => ({
  enabled: window.__game.dev.enabledBodies(),
}));
console.log('  enabled bodies:', JSON.stringify(probe));

// heavy: spam meteors + rain, wiggling the pointer to exercise the aim path
await page.evaluate(() => {
  document.querySelector('.tool-chip[data-id="rain"]')?.click();
});
for (let i = 0; i < 6; i++) {
  const p = await page.evaluate(() => window.__game.dev.aimRandom());
  if (p) {
    await page.mouse.move(Math.round(p.x), Math.round(p.y));
    await page.mouse.click(Math.round(p.x), Math.round(p.y));
  }
  await sleep(900);
  await page.mouse.move(500 + i * 40, 300 + i * 20);
  await sleep(200);
}
await page.evaluate(() => window.__game.dev.profile(true));
for (let i = 0; i < 24; i++) {
  const p = await page.evaluate(() => window.__game.dev.aimRandom());
  if (p) {
    await page.mouse.move(Math.round(p.x), Math.round(p.y));
    await page.mouse.click(Math.round(p.x), Math.round(p.y));
  }
  await sleep(450);
  await page.mouse.move(400 + ((i * 53) % 700), 250 + ((i * 37) % 400));
}
await report('heavy destruction + pointer motion');

await page.evaluate(() => {
  document.querySelector('.tool-chip[data-id="meteor"]')?.click();
});
for (let i = 0; i < 5; i++) {
  const p = await page.evaluate(() => window.__game.dev.aimRandom());
  if (p) await page.mouse.click(Math.round(p.x), Math.round(p.y));
  await sleep(1600);
}
await report('after meteors');

console.log(`\nerrors (${errors.length})`);
for (const e of errors.slice(0, 10)) console.log(e);
await browser.close();
