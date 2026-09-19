/**
 * "Feel" measurement for the custom pickaxe solver on a real target.
 * Reports the mix of impact classifications (head vs handle), whether drops
 * ever mined, how often they stick on a hard target, and how they settle.
 *
 * Usage: node tools/feeltest.mjs [url] [targetIndex] [tool] [drops]
 */
import puppeteer from 'puppeteer-core';

const URL = process.argv[2] ?? 'http://localhost:5177/';
const TARGET_ARG = process.argv[3] ?? '0';
const LAB = TARGET_ARG === 'lab';
const TARGET = LAB ? 0 : Number(TARGET_ARG);
const TOOL = process.argv[4] ?? 'wooden';
const DROPS = Number(process.argv[5] ?? 20);
const BATCH = (process.argv[6] ?? 'click') === 'batch';
const CHROME =
  process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
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
if (LAB) await page.evaluate(() => window.__game.dev.lab());
else await page.evaluate((i) => window.__game.dev.setTarget(i), TARGET);
await page.evaluate(() => window.__game.dev.pickaxeDebug(true));
await sleep(6000);

await page.evaluate(() => window.__game.dev.simReset());
const before = await page.evaluate(() => ({
  voxels: window.__game.remainingVoxels,
  hits: window.__game.dropStats.targetHits,
}));

if (BATCH) {
  await page.evaluate(([n, t]) => window.__game.dev.dropMany(n, t), [DROPS, TOOL]);
  await sleep(4500);
} else {
  for (let i = 0; i < DROPS; i++) {
    const p = await page.evaluate(() => window.__game.dev.aimRandom());
    if (!p) {
      await sleep(300);
      continue;
    }
    await page.mouse.move(Math.round(p.x), Math.round(p.y));
    await page.mouse.click(Math.round(p.x), Math.round(p.y));
    await sleep(1200);
  }
}
await sleep(2500);
const after = await page.evaluate(() => ({
  voxels: window.__game.remainingVoxels,
  hits: window.__game.dropStats.targetHits,
  qualities: window.__game.dev.simInfo().qualities,
  probeKinds: window.__game.dev.simInfo().byKind,
  firstKinds: window.__game.dev.simInfo().firstKinds,
  stats: {
    head: window.__game.dev.simInfo().head,
    handleContacts: window.__game.dev.simInfo().handleContacts,
    broken: window.__game.dev.simInfo().broken,
  },
  drops: window.__game.dev.dropInfo(),
}));

const q = after.qualities ?? {};
const total = Object.values(q).reduce((a, b) => a + b, 0);
const pct = (k) => (total ? ((q[k] ?? 0) / total) * 100 : 0);
const kinds = after.probeKinds ?? {};
const kindTotal = Object.values(kinds).reduce((a, b) => a + b, 0) || 1;
const fk = after.firstKinds ?? {};
const fTotal = Object.values(fk).reduce((a, b) => a + b, 0) || 1;
console.log(`target ${LAB ? 'lab' : TARGET}   tool ${TOOL}   drops ${DROPS}`);
console.log(`mining impacts: ${after.hits - before.hits}   blocks destroyed: ${before.voxels - after.voxels}`);
console.log(
  `solver: strikes ${after.stats.head}   handle contacts ${after.stats.handleContacts}   blocks broken by the solver ${after.stats.broken}`,
);
console.log(`classified strikes: ${total}`);
console.log(
  `  all strikes: PERFECT ${pct('PERFECT_HEAD_HIT').toFixed(1)}%  HEAD ${pct('HEAD_HIT').toFixed(1)}%  SIDE ${pct('SIDE_HIT').toFixed(1)}%  GLANCE ${pct('GLANCING_HIT').toFixed(1)}%`,
);
console.log(
  `  strike probes: HEAD ${(((kinds.head ?? 0) / kindTotal) * 100).toFixed(1)}%  HANDLE ${(((kinds.handle ?? 0) / kindTotal) * 100).toFixed(1)}%`,
);
console.log(
  `  first strike: HEAD ${(((fk.head ?? 0) / fTotal) * 100).toFixed(1)}%  HANDLE ${(((fk.handle ?? 0) / fTotal) * 100).toFixed(1)}%`,
);
const headish = pct('PERFECT_HEAD_HIT') + pct('HEAD_HIT');
console.log(`head-ish strikes: ${headish.toFixed(1)}%`);
const asleep = after.drops.filter((d) => d.sleep).length;
const mined = after.drops.filter((d) => d.hasHit).length;
console.log(`live drops: ${after.drops.length}  asleep: ${asleep}  ever mined: ${mined}`);
console.log(`errors (${errors.length})`);
for (const e of errors.slice(0, 8)) console.log(e);
await browser.close();
