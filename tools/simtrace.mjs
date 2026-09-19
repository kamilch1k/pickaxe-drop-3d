/**
 * Trace ONE pickaxe from release to rest on the flat physics-lab floor.
 * Prints a per-50ms line so contact cadence, energy pumping and settling are
 * visible directly. Usage: node tools/simtrace.mjs [url] [tool]
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
await page.evaluate(() => window.__game.dev.pickaxeDebug(true));
await page.evaluate(() => window.__game.dev.simReset());
// aim at a flat piece of the lab floor, well away from the pile and the wall
const p = await page.evaluate(() => {
  window.__game.dev.lab();
  return true;
});
void p;
await sleep(2600);

await page.evaluate(
  ([t]) => {
    const def = t;
    window.__game.dev.dropMany(1, def);
  },
  [TOOL],
);

let prev = null;
const rows = [];
for (let i = 0; i < 90; i++) {
  await sleep(50);
  const snap = await page.evaluate(() => {
    const info = window.__game.dev.simInfo();
    const first = info.drops[0] ?? null;
    return {
      d: first,
      contacts: info.contacts,
      kinds: info.contactKinds,
    };
  });
  if (!snap.d) break;
  const dc = prev ? snap.contacts - prev.contacts : snap.contacts;
  prev = snap.contacts;
  rows.push(
    `${(i * 0.05).toFixed(2)}  y=${String(snap.d.y).padStart(6)} x=${String(snap.d.x).padStart(6)} z=${String(snap.d.z).padStart(6)}  vy=${String(snap.d.vy).padStart(6)} vh=${String(snap.d.vh).padStart(6)}  spin=${String(snap.d.spin).padStart(5)}  contacts=${String(dc).padStart(3)}  sleep=${snap.d.sleeping ? 'Y' : 'n'} stuck=${snap.d.stuck ? 'Y' : 'n'}`,
  );
}
console.log(`tool: ${TOOL}`);
for (const r of rows) console.log(r);
const kinds = await page.evaluate(() => window.__game.dev.simInfo().contactKinds);
console.log('\ncontact kinds:');
for (const [k, v] of Object.entries(kinds ?? {})) console.log(`  ${v}  ${k}`);
console.log(`errors (${errors.length})`);
for (const e of errors.slice(0, 6)) console.log(e);
await browser.close();
