/**
 * Verifies the vertical drop + single-axis spin: samples a falling pickaxe's
 * rotation over time and reports the axis it actually rotates around, plus how
 * far it drifts sideways.
 * Usage: node tools/spintest.mjs [url] [tool]
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const URL = process.argv[2] ?? 'http://localhost:5177/';
const TOOL = process.argv[3] ?? 'wooden';
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
await sleep(4000);
await page.evaluate(() => window.__game.dev.lowQuality());
await page.evaluate((t) => {
  if (t !== 'wooden') window.__game.dev.grant(9_000_000);
  document.querySelector(`.tool-chip[data-id="${t}"]`)?.click();
}, TOOL);
await sleep(400);

// capture the camera azimuth so we can compare the measured spin axis to it
const cam = await page.evaluate(() => {
  const c = window.__game.dev.cameraInfo();
  return c;
});
console.log('camera dir:', JSON.stringify(cam));

const p = await page.evaluate(() => window.__game.aimTargetScreen(0.7) ?? window.__game.dev.aimRandom());
await page.mouse.move(Math.round(p.x), Math.round(p.y));
await page.mouse.click(Math.round(p.x), Math.round(p.y));

const samples = [];
for (let i = 0; i < 12; i++) {
  await sleep(220);
  const d = await page.evaluate(() => {
    const s = window.__game.dev.dropInfo();
    return s && s.length ? s[0] : null;
  });
  if (d) samples.push(d);
  if (i === 3) await page.screenshot({ path: `${OUT}/spin-${TOOL}-a.png` });
  if (i === 6) await page.screenshot({ path: `${OUT}/spin-${TOOL}-b.png` });
}

console.log('samples (y, rot, angvel):');
for (const s of samples) {
  console.log(
    '  x=' + String(s.x).padStart(6) + ' z=' + String(s.z).padStart(6) +
      ' y=' + String(s.y).padStart(6) +
      ' v=(' + s.vx + ',' + s.vy + ',' + s.vz + ')' +
      ' com=' + JSON.stringify(s.com) +
      ' av=' + JSON.stringify(s.angvel),
  );
}
// rotation axis between consecutive samples
for (let i = 1; i < samples.length; i++) {
  const a = samples[i - 1].rot;
  const b = samples[i].rot;
  // q = qb * conj(qa)  (world-space delta)
  const qa = { x: a[0], y: a[1], z: a[2], w: a[3] };
  const qb = { x: b[0], y: b[1], z: b[2], w: b[3] };
  const dq = {
    w: qb.w * qa.w + qb.x * qa.x + qb.y * qa.y + qb.z * qa.z,
    x: -qb.w * qa.x + qb.x * qa.w - qb.y * qa.z + qb.z * qa.y,
    y: -qb.w * qa.y + qb.x * qa.z + qb.y * qa.w - qb.z * qa.x,
    z: -qb.w * qa.z - qb.x * qa.y + qb.y * qa.x + qb.z * qa.w,
  };
  if (dq.w < 0) {
    dq.x = -dq.x;
    dq.y = -dq.y;
    dq.z = -dq.z;
    dq.w = -dq.w;
  }
  const ang = 2 * Math.acos(Math.min(1, Math.max(-1, dq.w))) * (180 / Math.PI);
  const s = Math.hypot(dq.x, dq.y, dq.z) || 1;
  const axis = [dq.x / s, dq.y / s, dq.z / s].map((v) => +v.toFixed(3));
  const dot = Math.abs(axis[0] * cam.x + axis[1] * cam.y + axis[2] * cam.z);
  console.log(
    `  step ${i}: dy=${(b === a ? 0 : samples[i].y - samples[i - 1].y).toFixed(2)} axis=${JSON.stringify(axis)} angle=${ang.toFixed(1)}° |dot with camera dir|=${dot.toFixed(3)}`,
  );
}

const drift = samples.length > 1 ? Math.abs(samples[samples.length - 1].x - samples[0].x) : 0;
console.log(`lateral drift: ${drift.toFixed(3)}`);
console.log(`errors (${errors.length})`);
for (const e of errors.slice(0, 8)) console.log(e);
await browser.close();
