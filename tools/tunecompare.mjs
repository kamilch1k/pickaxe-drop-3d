/**
 * Compare solver tuning sets against the "how does it land" metric: the first
 * voxel contact of each drop, split by probe kind and alignment quality.
 * Usage: node tools/tunecompare.mjs [url] [dropsPerConfig]
 */
import puppeteer from 'puppeteer-core';

const URL = process.argv[2] ?? 'http://localhost:5177/';
const DROPS = Number(process.argv[3] ?? 30);
const CHROME =
  process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

const CONFIGS = [
  { name: 'E align 9 spin 2.5-6', patch: { alignmentStrength: 9, initialSpinMin: 2.5, initialSpinMax: 6 } },
  { name: 'F align 10 spin 2-6', patch: { alignmentStrength: 10, initialSpinMin: 2, initialSpinMax: 6 } },
  { name: 'G align 11 spin 2-5.5', patch: { alignmentStrength: 11, initialSpinMin: 2, initialSpinMax: 5.5 } },
];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1024, height: 640 },
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
await sleep(2800);

for (const cfg of CONFIGS) {
  await page.evaluate((p) => window.__game.dev.tuning(p), cfg.patch);
  await page.evaluate(() => window.__game.dev.simReset());
  await page.evaluate((n) => window.__game.dev.dropMany(n, 'wooden'), DROPS);
  await sleep(5200);
  const info = await page.evaluate(() => window.__game.dev.simInfo());
  const vk = info.firstVoxelKinds ?? {};
  const vq = info.firstVoxelQualities ?? {};
  const total = Object.values(vk).reduce((a, b) => a + b, 0) || 1;
  const p = (m) => (((m ?? 0) / total) * 100).toFixed(1);
  console.log(
    `${cfg.name.padEnd(24)} n=${String(total).padStart(3)}  HEAD ${p(vk.head)}%  HANDLE ${p(vk.handle)}%   PERFECT ${p(vq.PERFECT_HEAD_HIT)}%  HEAD ${p(vq.HEAD_HIT)}%  SIDE ${p(vq.SIDE_HIT)}%  GLANCE ${p(vq.GLANCING_HIT)}%  HANDLE ${p(vq.HANDLE_HIT)}%`,
  );
  await page.evaluate(() => window.__game.dev.lab());
  await sleep(2600);
}
console.log(`errors (${errors.length})`);
for (const e of errors.slice(0, 6)) console.log(e);
await browser.close();
