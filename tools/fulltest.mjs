/**
 * Full-loop gameplay test: clear the first target with the free tool, verify
 * the transition, then unlock everything and exercise every tool.
 * Usage: node tools/fulltest.mjs [url]
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const URL = process.argv[2] ?? 'http://localhost:5177/';
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

const state = () =>
  page.evaluate(() => ({
    coins: document.querySelector('.coin-value')?.textContent,
    progress: document.querySelector('.target-sub')?.textContent,
    target: document.querySelector('.target-name')?.textContent,
    left: window.__game.remainingVoxels,
  }));

const shoot = async (offset = 0.55, wait = 1400) => {
  const p = await page.evaluate((o) => {
    const g = window.__game;
    return (o === 'random' ? g.dev.aimRandom() : g.aimTargetScreen(o)) ?? g.aimTargetScreen(o);
  }, offset);
  if (!p) return false;
  await page.mouse.click(Math.round(p.x), Math.round(p.y));
  await sleep(wait);
  return true;
};

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForSelector('#boot-start', { visible: true, timeout: 90000 });
await page.click('#boot-start');
await page.waitForFunction(() => !document.getElementById('boot'), { timeout: 30000 });
await sleep(4500);
await page.evaluate(() => window.__game.dev.lowQuality());
await sleep(500);

console.log('== phase 1: clear target 1 with the wooden pickaxe ==');
let cleared = false;
for (let i = 0; i < 90 && !cleared; i++) {
  await shoot('random', 0);
  await sleep(1500);
  if (i % 10 === 9) {
    const s = await state();
    console.log(`  ${i + 1} drops:`, JSON.stringify(s));
    if (s.target !== 'Stone Ore Chunk') {
      cleared = true;
      await page.screenshot({ path: `${OUT}/f01-transition.png` });
    }
  }
}
console.log('cleared:', cleared);
await sleep(4200);
await page.screenshot({ path: `${OUT}/f02-next-target.png` });
console.log('after transition:', JSON.stringify(await state()));

console.log('== phase 2: unlock everything and try each tool ==');
await page.evaluate(() => window.__game.dev.grant(5_000_000));
await sleep(600);

const toolNames = await page.$$eval('.tool-chip', (els) =>
  els.map((e) => e.dataset.id),
);
console.log('tools available:', toolNames.join(', '));

const tryTool = async (id, offset = 0.55, wait = 2600, label = '') => {
  const ok = await page.evaluate((tid) => {
    const chip = document.querySelector(`.tool-chip[data-id="${tid}"]`);
    if (!chip) return false;
    chip.click();
    return true;
  }, id);
  if (!ok) {
    console.log(`  !! no chip for ${id}`);
    return;
  }
  await sleep(400);
  await shoot(offset, wait);
  await page.screenshot({ path: `${OUT}/f-tool-${id}.png` });
  const s = await state();
  console.log(`  ${id}${label}: ${s.progress} | ${s.coins}`);
};

for (const id of ['iron', 'golden', 'crystal', 'anvil']) {
  await tryTool(id);
}
for (const id of ['saw', 'drill', 'boulder', 'bomb']) {
  await tryTool(id, 0.55, 4200);
}
await page.screenshot({ path: `${OUT}/f03-mid-chaos.png` });

// jump to the late targets and use the big toys
for (const [idx, tool] of [
  [4, 'meteor'],
  [6, 'nuke'],
]) {
  await page.evaluate((i) => window.__game.dev.setTarget(i), idx);
  await sleep(9000);
  await page.screenshot({ path: `${OUT}/f04-target-${idx}.png` });
  await tryTool(tool, 0.55, 5200, ` on target ${idx}`);
  await page.screenshot({ path: `${OUT}/f05-${tool}-${idx}.png` });
}

console.log('== phase 3: upgrades + save ==');
await page.evaluate(() => window.__game.dev.setTarget(0));
await sleep(7000);
await page.click('#btn-upgrades');
await sleep(700);
const buys = await page.$$('.buy-btn');
for (let i = 0; i < Math.min(6, buys.length); i++) {
  const btn = (await page.$$('.buy-btn'))[i];
  if (!btn) break;
  await btn.click();
  await sleep(400);
}
await page.screenshot({ path: `${OUT}/f06-upgrades.png` });
await page.click('.close-btn');
await sleep(400);
const before = await state();

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#boot-start', { visible: true, timeout: 60000 });
await page.click('#boot-start');
await sleep(3000);
const after = await state();
console.log('before reload:', JSON.stringify(before));
console.log('after reload :', JSON.stringify(after));
await page.screenshot({ path: `${OUT}/f07-reload.png` });

console.log(`\nerrors (${errors.length}):`);
for (const e of errors.slice(0, 20)) console.log(e);
await browser.close();
