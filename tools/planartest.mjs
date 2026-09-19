/**
 * Solver contract test for the hand-written pickaxe simulation.
 *
 * The pickaxes used to be planar rigid bodies (X/Y translation, Z-only spin).
 * They are now true 3D bodies driven by `PickaxeSimulator`, so this test checks
 * the contract that replaced it:
 *
 *   - no NaN / Infinity anywhere in the state
 *   - angular velocity stays inside the configured clamp
 *   - the tool never sinks through the arena deck or the lab floor
 *   - every dropped pickaxe eventually settles and falls asleep
 *
 * Usage: node tools/planartest.mjs [url] [tool]
 */
import puppeteer from 'puppeteer-core';

const URL = process.argv[2] ?? 'http://localhost:5177/';
const TOOL = process.argv[3] ?? 'wooden';
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
await sleep(3000);
await page.evaluate(() => window.__game.dev.grant(9_000_000));
await page.evaluate(() => window.__game.dev.lowQuality());
await page.evaluate(() => window.__game.dev.lab());
await sleep(2600);

const COUNT = 12;
await page.evaluate(([n, t]) => window.__game.dev.dropMany(n, t), [COUNT, TOOL]);

let nan = false;
let maxSpin = 0;
let minY = Infinity;
let maxSpeed = 0;
const maxAngular = (await page.evaluate(() => window.__game.dev.tuning())).maxAngularVelocity;

for (let i = 0; i < 40; i++) {
  await sleep(250);
  const info = await page.evaluate(() => window.__game.dev.simInfo());
  for (const d of info.drops) {
    if (![d.speed, d.spin, d.x, d.y, d.z].every(Number.isFinite)) nan = true;
    maxSpin = Math.max(maxSpin, d.spin);
    maxSpeed = Math.max(maxSpeed, d.speed);
    minY = Math.min(minY, d.y);
  }
  if (i > 24 && info.drops.every((d) => d.sleeping || d.stuck)) break;
}

const final = await page.evaluate(() => window.__game.dev.simInfo());
const awake = final.drops.filter((d) => !d.sleeping && !d.stuck).length;

console.log(`tool: ${TOOL}   dropped: ${COUNT}   probes/body: ${final.probesPerBody}`);
console.log(`max speed: ${maxSpeed.toFixed(1)}   max spin: ${maxSpin.toFixed(2)} (clamp ${maxAngular})`);
console.log(`lowest y reached: ${minY.toFixed(2)}   still awake at end: ${awake} / ${final.drops.length}`);
const ok = !nan && maxSpin <= maxAngular + 1e-6 && maxSpeed <= 200 && minY > -3 && awake === 0;
console.log(`NaN: ${nan}   spin within clamp: ${maxSpin <= maxAngular + 1e-6}   above deck: ${minY > -3}   all settled: ${awake === 0}`);
console.log(ok ? 'PASS: 3D solver stays bounded and settles' : 'FAIL: solver contract violated');
console.log(`errors (${errors.length})`);
for (const e of errors.slice(0, 8)) console.log(e);
await browser.close();
process.exit(ok && errors.length === 0 ? 0 : 1);
