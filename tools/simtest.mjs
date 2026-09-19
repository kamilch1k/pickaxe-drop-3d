/**
 * Solver playground: loads the physics lab, drops pickaxes on it and reports
 * whether the hand-written simulation stayed sane (no NaN, no tunnelling, no
 * runaway spin, impacts happening, bodies settling).
 *
 * Usage: node tools/simtest.mjs [url] [count] [tool]
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const URL = process.argv[2] ?? 'http://localhost:5177/';
const COUNT = Number(process.argv[3] ?? 12);
const TOOL = process.argv[4] ?? 'wooden';
const OUT = 'shots';
const CHROME =
  process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
mkdirSync(OUT, { recursive: true });
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
await sleep(3500);
await page.evaluate(() => window.__game.dev.grant(9_000_000));
await page.evaluate(() => window.__game.dev.lowQuality());
await page.evaluate(() => window.__game.dev.pickaxeDebug(true));
console.log('lab:', await page.evaluate(() => window.__game.dev.lab()));
await sleep(2600);
await page.screenshot({ path: `${OUT}/sim-00-lab.png` });

const before = await page.evaluate(() => ({
  voxels: window.__game.remainingVoxels,
  hits: window.__game.dropStats.targetHits,
}));

await page.evaluate(
  ([n, t]) => window.__game.dev.dropMany(n, t),
  [COUNT, TOOL],
);

let maxSpin = 0;
let maxSpeed = 0;
let minY = Infinity;
let maxOffAxis = 0;
let nan = false;
let settled = 0;
const timeline = [];

for (let i = 0; i < 26; i++) {
  await sleep(250);
  const snap = await page.evaluate(() => {
    const info = window.__game.dev.simInfo();
    const drops = window.__game.dev.dropInfo();
    return { info, drops, left: window.__game.remainingVoxels };
  });
  for (const d of snap.info.drops) {
    if (!Number.isFinite(d.speed) || !Number.isFinite(d.spin) || !Number.isFinite(d.y)) nan = true;
    maxSpin = Math.max(maxSpin, d.spin);
    maxSpeed = Math.max(maxSpeed, d.speed);
    minY = Math.min(minY, d.y);
    if (d.sleeping || d.stuck) settled++;
  }
  for (const d of snap.drops) {
    if (d.state === 'falling') maxOffAxis = Math.max(maxOffAxis, Math.hypot(d.vx, d.vz));
  }
  timeline.push({
    t: i * 0.25,
    live: snap.info.bodies,
    left: snap.left,
    sleeping: snap.info.drops.filter((d) => d.sleeping).length,
    stuck: snap.info.drops.filter((d) => d.stuck).length,
    topSpeed: Math.max(0, ...snap.info.drops.map((d) => d.speed)),
    topSpin: Math.max(0, ...snap.info.drops.map((d) => d.spin)),
    lowest: snap.info.drops.length ? Math.min(...snap.info.drops.map((d) => d.y)) : null,
  });
  if (i === 2) await page.screenshot({ path: `${OUT}/sim-01-falling.png` });
  if (i === 6) await page.screenshot({ path: `${OUT}/sim-02-impact.png` });
}

await page.evaluate(() => window.__game.dev.pickaxeDebug(true)); // keep overlay on for the shot
await page.screenshot({ path: `${OUT}/sim-03-settled.png` });

const after = await page.evaluate(() => ({
  voxels: window.__game.remainingVoxels,
  hits: window.__game.dropStats.targetHits,
  ground: window.__game.dropStats.groundHits,
  perf: window.__game.dev.profileReport().render,
}));
const tuning = await page.evaluate(() => window.__game.dev.tuning());
const info = await page.evaluate(() => window.__game.dev.simInfo());
const buried = info.drops.filter((d) => d.y < 0.15);

console.log(`tool: ${TOOL}   dropped: ${COUNT}`);
console.log(`probes per body: ${info.probesPerBody}`);
console.log(`voxels destroyed: ${before.voxels - after.voxels}   mining impacts: ${after.hits - before.hits}`);
console.log(`ground hits: ${after.ground}`);
console.log(`max speed: ${maxSpeed.toFixed(1)}   max spin: ${maxSpin.toFixed(2)} rad/s`);
console.log(`lowest y reached: ${minY.toFixed(2)}   settled samples: ${settled}   NaN: ${nan}`);
console.log(`draw calls: ${after.perf.calls}  triangles: ${after.perf.triangles}`);
console.log(`bodies below the deck surface (y<0.15): ${buried.length}`);
for (const b of buried) {
  console.log(
    `  y=${b.y} x=${b.x} z=${b.z} vy=${b.vy} vh=${b.vh} spin=${b.spin} sleep=${b.sleeping} contact=[${b.contact}]`,
  );
}
console.log('tune:', JSON.stringify(tuning));
console.log('\ntimeline (t live left sleeping stuck speed spin lowest)');
for (const r of timeline) {
  console.log(
    `  ${r.t.toFixed(2)}  ${String(r.live).padStart(2)}  ${String(r.left).padStart(4)}  ${r.sleeping}  ${r.stuck}  ${r.topSpeed.toFixed(1).padStart(5)}  ${r.topSpin.toFixed(2).padStart(5)}  ${r.lowest === null ? '-' : r.lowest.toFixed(2)}`,
  );
}
console.log(`\nerrors (${errors.length})`);
for (const e of errors.slice(0, 10)) console.log(e);
await browser.close();
process.exit(errors.length || nan ? 1 : 0);
