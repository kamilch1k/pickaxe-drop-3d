/**
 * Planar contract test for the hand-written pickaxe simulation.
 *
 * Ported from the Pickaxe Drop Astra constraints: a dropped pickaxe must stay in
 * its interaction plane no matter what - no depth drift, no depth velocity, no
 * rotation about any axis other than the plane normal - while still tumbling,
 * mining and settling.
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
let maxLane = 0;
let maxVz = 0;
let maxSpeed = 0;
const tuning = await page.evaluate(() => window.__game.dev.tuning());

for (let i = 0; i < 60; i += 1) {
  await sleep(250);
  const info = await page.evaluate(() => window.__game.dev.simInfo());
  for (const d of info.drops) {
    if (![d.speed, d.spin, d.x, d.y, d.z, d.lane, d.vz].every(Number.isFinite)) nan = true;
    maxSpin = Math.max(maxSpin, Math.abs(d.spin));
    maxSpeed = Math.max(maxSpeed, d.speed);
    minY = Math.min(minY, d.y);
    maxLane = Math.max(maxLane, Math.abs(d.lane));
    maxVz = Math.max(maxVz, Math.abs(d.vz));
  }
  if (i > 40 && info.drops.every((d) => d.sleeping)) break;
}

const final = await page.evaluate(() => window.__game.dev.simInfo());
const awake = final.drops.filter((d) => !d.sleeping).length;

console.log(`tool: ${TOOL}   dropped: ${COUNT}   probes/body: ${final.probesPerBody}`);
console.log(`max speed: ${maxSpeed.toFixed(1)}   max |spin|: ${maxSpin.toFixed(2)} (clamp ${tuning.maxAngularVelocity})`);
console.log(`lowest y reached: ${minY.toFixed(2)}   still awake: ${awake} / ${final.drops.length}`);
console.log(`max |z - plane|: ${maxLane.toExponential(2)} (lane ${final.drops[0]?.halfDepth ?? '-'})   max |vz|: ${maxVz.toExponential(2)}`);
const ok =
  !nan &&
  maxSpin <= tuning.maxAngularVelocity + 1e-6 &&
  maxVz < 1e-6 &&
  maxLane <= (final.drops[0]?.halfDepth ?? 1) + 1e-6 &&
  minY > -0.3 &&
  awake === 0;
console.log(`NaN: ${nan}   spin in clamp: ${ok || maxSpin <= tuning.maxAngularVelocity + 1e-6}   depth lock: ${maxVz < 1e-6}`);
console.log(ok ? 'PASS: planar solver stays in its plane and settles' : 'FAIL: planar contract violated');
console.log(`errors (${errors.length})`);
for (const e of errors.slice(0, 8)) console.log(e);
await browser.close();
process.exit(ok && errors.length === 0 ? 0 : 1);
