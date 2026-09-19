import { VoxelGrid } from './VoxelGrid';
import { MATERIAL_IDS } from '../content/materials';
import { ValueNoise } from '../utils/noise';
import { Rng } from '../utils/rng';

function matIndex(id: string): number {
  return MATERIAL_IDS.indexOf(id);
}

export class Writer {
  constructor(
    readonly g: VoxelGrid,
    readonly ox: number,
    readonly oz: number,
    /** uniform shrink applied to every authored coordinate */
    readonly shrink = 1,
  ) {}

  set(x: number, y: number, z: number, mat: string, hpMul = 1): void {
    const s = this.shrink;
    this.g.set(Math.round(x * s + this.ox), Math.round(y * s), Math.round(z * s + this.oz), mat, hpMul);
  }

  get(x: number, y: number, z: number): boolean {
    const s = this.shrink;
    return this.g.isActiveAt(
      Math.round(x * s + this.ox),
      Math.round(y * s),
      Math.round(z * s + this.oz),
    );
  }

  box(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    mat: string,
    hpMul = 1,
  ): void {
    for (let x = Math.round(x0); x <= Math.round(x1); x++)
      for (let y = Math.round(y0); y <= Math.round(y1); y++)
        for (let z = Math.round(z0); z <= Math.round(z1); z++) this.set(x, y, z, mat, hpMul);
  }

  sphere(cx: number, cy: number, cz: number, r: number, mat: string, hpMul = 1): void {
    const ri = Math.ceil(r);
    for (let x = -ri; x <= ri; x++)
      for (let y = -ri; y <= ri; y++)
        for (let z = -ri; z <= ri; z++) {
          if (x * x + y * y + z * z <= r * r) this.set(cx + x, cy + y, cz + z, mat, hpMul);
        }
  }

  ellipsoid(
    cx: number,
    cy: number,
    cz: number,
    rx: number,
    ry: number,
    rz: number,
    mat: string,
    hpMul = 1,
  ): void {
    const mx = Math.ceil(rx);
    const my = Math.ceil(ry);
    const mz = Math.ceil(rz);
    for (let x = -mx; x <= mx; x++)
      for (let y = -my; y <= my; y++)
        for (let z = -mz; z <= mz; z++) {
          const d = (x * x) / (rx * rx) + (y * y) / (ry * ry) + (z * z) / (rz * rz);
          if (d <= 1) this.set(cx + x, cy + y, cz + z, mat, hpMul);
        }
  }

  /** Vertical tapered spike used for crystals. */
  spike(
    cx: number,
    cz: number,
    y0: number,
    height: number,
    r0: number,
    r1: number,
    mat: string,
    hpMul = 1,
    jitter = 0.35,
  ): void {
    for (let i = 0; i <= height; i++) {
      const t = i / height;
      const r = r0 + (r1 - r0) * t;
      const jx = (Math.sin(i * 1.7 + cx) * jitter) | 0;
      const jz = (Math.cos(i * 2.1 + cz) * jitter) | 0;
      const ri = Math.round(r);
      for (let x = -ri; x <= ri; x++)
        for (let z = -ri; z <= ri; z++) {
          if (x * x + z * z <= r * r + 0.25) this.set(cx + x + jx * 0.4, y0 + i, cz + z + jz * 0.4, mat, hpMul);
        }
      if (r < 1.2) this.set(cx + Math.round(jx * 0.4), y0 + i, cz + Math.round(jz * 0.4), mat, hpMul);
    }
  }

  /** Random-walk blob, perfect for ore veins. */
  vein(
    rng: Rng,
    x: number,
    y: number,
    z: number,
    steps: number,
    mat: string,
    size: number,
    hpMul = 1,
  ): void {
    for (let s = 0; s < steps; s++) {
      const r = rng.int(0, Math.max(0, size - 1));
      for (let dx = -r; dx <= r; dx++)
        for (let dy = -r; dy <= r; dy++)
          for (let dz = -r; dz <= r; dz++)
            if (dx * dx + dy * dy + dz * dz <= r * r + 0.5)
              this.set(x + dx, y + dy, z + dz, mat, hpMul);
      x += rng.int(-1, 1);
      y += rng.chance(0.35) ? rng.int(-1, 1) : 0;
      z += rng.int(-1, 1);
      if (y < 0) y = 0;
    }
  }

  /** Recolour a set of already-placed voxels that match a predicate. */
  paint(pred: (mat: number) => boolean, mat: string, limit: number, rng: Rng): void {
    let done = 0;
    const order = new Int32Array(this.g.size);
    for (let i = 0; i < order.length; i++) order[i] = i;
    for (let i = order.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      const t = order[i];
      order[i] = order[j];
      order[j] = t;
    }
    for (const cell of order) {
      if (done >= limit) break;
      if (this.g.active[cell] !== 1) continue;
      if (!pred(this.g.mat[cell])) continue;
      const def = this.g.materialIdAt(cell);
      if (def === mat) continue;
      this.g.mat[cell] = matIndex(mat);
      done++;
    }
  }
}

export type BuilderId =
  | 'oreChunk'
  | 'goldVein'
  | 'crystalFormation'
  | 'treasureBlock'
  | 'memeCreature'
  | 'obsidianBeast'
  | 'mythicCore'
  | 'physicsLab';

export const GRID_X = 40;
export const GRID_Y = 46;
export const GRID_Z = 40;

/**
 * Per-target uniform shrink of the authored shapes. Big blocks + fewer of them
 * keeps every target readable at the camera distance while keeping the block
 * count (and therefore the time to clear) small.
 */
export const SHRINK = {
  oreChunk: 0.52,
  goldVein: 0.48,
  crystalFormation: 0.57,
  treasureBlock: 0.52,
  memeCreature: 0.5,
  obsidianBeast: 0.56,
  mythicCore: 0.49,
} as const;

function makeGrid(shrink = 1): { grid: VoxelGrid; w: Writer } {
  const grid = new VoxelGrid(GRID_X, GRID_Y, GRID_Z);
  const w = new Writer(grid, Math.floor(GRID_X / 2), Math.floor(GRID_Z / 2), shrink);
  return { grid, w };
}

/* ------------------------------------------------------------------ rocks */

function buildOreChunk(rng: Rng) {
  const { grid, w } = makeGrid(SHRINK.oreChunk);
  const noise = new ValueNoise(24, rng);
  const R = 8.0;
  const H = 10.6;
  for (let x = -13; x <= 13; x++) {
    for (let z = -13; z <= 13; z++) {
      const d = Math.sqrt(x * x * 1.06 + z * z * 1.02);
      if (d > R) continue;
      const n = noise.fbm(x * 0.21 + 5, z * 0.21 + 5, 3) * 3.1;
      const dome = H * Math.sqrt(Math.max(0, 1 - Math.pow(d / R, 2.1)));
      const top = Math.floor(dome + n - 3.6);
      for (let y = 0; y <= top; y++) {
        let mat = 'stone';
        const depth = top - y;
        if (top > 5 && depth === 0) mat = rng.chance(0.4) ? 'deepstone' : 'stone';
        else if (y > 0 && rng.chance(0.12)) mat = 'deepstone';
        w.set(x, y, z, mat);
      }
    }
  }
  // satellite boulders
  for (let i = 0; i < 6; i++) {
    const a = rng.range(0, Math.PI * 2);
    const dist = rng.range(8.6, 11.4);
    const rx = rng.range(1.6, 2.8);
    const ry = rng.range(1.2, 2.1);
    const rz = rng.range(1.6, 2.8);
    w.ellipsoid(Math.cos(a) * dist, ry - 0.5, Math.sin(a) * dist, rx, ry, rz, 'stone');
  }
  // copper + coal veins
  for (let i = 0; i < 7; i++) {
    const a = rng.range(0, Math.PI * 2);
    const dist = rng.range(0, 8);
    w.vein(
      rng,
      Math.round(Math.cos(a) * dist),
      rng.int(0, 4),
      Math.round(Math.sin(a) * dist),
      5,
      i % 3 === 0 ? 'coal' : 'copper',
      1,
    );
  }
  // hidden gold pocket
  w.vein(rng, rng.int(-2, 2), rng.int(0, 1), rng.int(-2, 2), 4, 'gold', 1);
  return grid;
}

function buildGoldVein(rng: Rng) {
  const { grid, w } = makeGrid(SHRINK.goldVein);
  const noise = new ValueNoise(24, rng);
  const R = 11.2;
  const H = 11.5;
  for (let x = -13; x <= 13; x++) {
    for (let z = -13; z <= 13; z++) {
      const d = Math.sqrt(x * x * 1.04 + z * z * 1.1);
      if (d > R) continue;
      const n = noise.fbm(x * 0.21 + 21, z * 0.21 + 33, 3) * 3.6;
      const dome = H * Math.sqrt(Math.max(0, 1 - Math.pow(d / R, 2.2)));
      const top = Math.floor(dome + n - 2.2);
      for (let y = 0; y <= top; y++) {
        let mat = 'stone';
        if (y > 0 && rng.chance(0.16)) mat = 'deepstone';
        if (top > 8 && top - y === 0) mat = rng.chance(0.45) ? 'iron' : 'deepstone';
        w.set(x, y, z, mat);
      }
    }
  }
  for (let i = 0; i < 9; i++) {
    const a = rng.range(0, Math.PI * 2);
    const dist = rng.range(0, 8.5);
    const y = rng.int(1, 7);
    w.vein(rng, Math.round(Math.cos(a) * dist), y, Math.round(Math.sin(a) * dist), 6, 'gold', 1);
  }
  for (let i = 0; i < 5; i++) {
    const a = rng.range(0, Math.PI * 2);
    const dist = rng.range(3, 9);
    w.vein(rng, Math.round(Math.cos(a) * dist), rng.int(0, 3), Math.round(Math.sin(a) * dist), 4, 'iron', 1);
  }
  w.ellipsoid(0, 2.4, 0, 3.2, 2.4, 3.2, 'gold', 1);
  w.ellipsoid(0, 2.4, 0, 1.6, 1.4, 1.6, 'emerald', 1);
  return grid;
}

function buildCrystalFormation(rng: Rng) {
  const { grid, w } = makeGrid(SHRINK.crystalFormation);
  // dark base
  w.ellipsoid(0, -1.6, 0, 12.4, 4.4, 12.4, 'deepstone');
  w.ellipsoid(0, 0.6, 0, 10.6, 2.6, 10.6, 'deepstone');
  for (let i = 0; i < 8; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(6, 12);
    w.ellipsoid(Math.cos(a) * d, rng.range(-0.4, 1), Math.sin(a) * d, rng.range(1.6, 3), rng.range(1, 2.2), rng.range(1.6, 3), rng.chance(0.4) ? 'obsidian' : 'deepstone');
  }
  const spot = [
    [0, 0, 13.5, 2.6, 'diamond'],
    [-6, -3, 9, 2.1, 'emerald'],
    [5, 4, 10.5, 2.2, 'ruby'],
    [-4, 6, 7.5, 1.8, 'emerald'],
    [7, -5, 8, 1.9, 'ruby'],
    [-8, -6, 5.5, 1.5, 'diamond'],
    [8, 6, 5, 1.5, 'emerald'],
    [2, -8, 6.5, 1.6, 'ruby'],
    [-2, 8, 6, 1.5, 'emerald'],
  ] as [number, number, number, number, string][];
  for (const [x, z, h, r, mat] of spot) {
    const base = -1;
    w.spike(x, z, base, Math.round(h * 2.1), r, 0.9, mat, 1, 0.4);
  }
  // glowing core
  w.ellipsoid(0, 5, 0, 2.6, 3.4, 2.6, 'diamond');
  w.ellipsoid(0, 8.5, 0, 1.6, 2, 1.6, 'mythic');
  w.spike(0, 0, 10, 8, 1.4, 0.6, 'mythic', 1, 0.2);
  for (let i = 0; i < 10; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(2, 9);
    w.vein(rng, Math.round(Math.cos(a) * d), rng.int(1, 6), Math.round(Math.sin(a) * d), 4, rng.chance(0.5) ? 'emerald' : 'ruby', 1);
  }
  return grid;
}

function buildTreasureBlock(rng: Rng) {
  const { grid, w } = makeGrid(SHRINK.treasureBlock);
  // iron chest frame
  w.box(-8, 0, -8, 8, 0, 8, 'iron');
  w.box(-8, 0, -8, 8, 12, 8, 'iron');
  for (let y = 1; y < 12; y++) {
    for (let x = -8; x <= 8; x++) {
      for (let z = -8; z <= 8; z++) {
        const edgeX = x === -8 || x === 8;
        const edgeZ = z === -8 || z === 8;
        if (edgeX || edgeZ) {
          w.set(x, y, z, y === 11 || y === 1 ? 'iron' : rng.chance(0.12) ? 'obsidian' : 'iron');
        } else if (y > 0) {
          w.set(x, y, z, 'gold');
        }
      }
    }
  }
  // gem inlay pattern on the front face
  const face = -8;
  w.box(-1, 2, face - 1, 1, 9, face - 1, 'obsidian');
  for (let y = 2; y <= 9; y++) {
    w.set(0, y, face - 2, 'diamond');
    if (y % 3 === 0) {
      w.set(-2, y, face - 2, 'emerald');
      w.set(2, y, face - 2, 'ruby');
    }
  }
  w.box(-4, 5, face - 2, -2, 7, face - 2, 'emerald');
  w.box(2, 5, face - 2, 4, 7, face - 2, 'ruby');
  // crown of gems on the lid
  w.box(-6, 13, -6, 6, 13, 6, 'gold');
  for (let x = -5; x <= 5; x += 2) {
    for (let z = -5; z <= 5; z += 2) {
      const m = (x + z) % 4 === 0 ? 'diamond' : (x + z) % 3 === 0 ? 'ruby' : 'emerald';
      w.set(x, 14, z, m);
    }
  }
  w.box(-2, 14, -2, 2, 14, 2, 'mythic');
  w.box(-3, 15, -3, 3, 15, 3, 'gold');
  w.ellipsoid(0, 16.5, 0, 1.6, 1.6, 1.6, 'mythic');
  // stray treasure spilling out
  for (let i = 0; i < 14; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(9.5, 12);
    w.ellipsoid(Math.cos(a) * d, 0.5, Math.sin(a) * d, 1.2, 1, 1.2, rng.chance(0.35) ? 'diamond' : 'gold');
  }
  return grid;
}

/* --------------------------------------------------------------- creature */

function buildMemeCreature(rng: Rng) {
  const { grid, w } = makeGrid(SHRINK.memeCreature);
  // tiny legs
  w.box(-3.4, 0, -2.5, -1.4, 6, 2.5, 'furDark');
  w.box(1.4, 0, -2.5, 3.4, 6, 2.5, 'furDark');
  // shoes
  w.box(-4.2, 0, -3.6, -0.8, 1.4, 3.6, 'cloth');
  w.box(0.8, 0, -3.6, 4.2, 1.4, 3.6, 'cloth');
  // body
  w.box(-5, 6, -3.6, 5, 15, 3.6, 'fur');
  w.box(-4, 15, -3, 4, 17, 3, 'fur');
  // belly patch
  w.box(-2.6, 7, 3.6, 2.6, 13, 4.2, 'candy');
  // stubby arms
  w.box(-10.5, 11, -2.4, -5, 14, 2.4, 'fur');
  w.box(5, 11, -2.4, 10.5, 14, 2.4, 'fur');
  // hands with fingers
  for (const sx of [-1, 1]) {
    const hx = sx * 12;
    w.box(hx - 2.2, 10.4, -2.6, hx + 2.2, 13.4, 2.6, 'furDark');
    for (let f = -1; f <= 1; f++) w.box(hx + sx * 2.2, 10.4, f * 1.8 - 0.7, hx + sx * 3.6, 12.4, f * 1.8 + 0.7, 'furDark');
  }
  // giant head
  w.box(-7.5, 17, -6.5, 7.5, 30, 6.5, 'fur');
  w.box(-6.5, 30, -5.5, 6.5, 32, 5.5, 'fur');
  // ears
  w.box(-9.2, 25, -2.6, -7.5, 30, 2.6, 'furDark');
  w.box(7.5, 25, -2.6, 9.2, 30, 2.6, 'furDark');
  // goofy mismatched eyes
  w.box(-5.4, 24, 6.5, -1.6, 28.4, 7.2, 'eye');
  w.box(0.6, 23, 6.5, 5.4, 28, 7.2, 'eye');
  w.box(-4.2, 25.4, 6.5, -2.6, 27.2, 7.5, 'pupil');
  w.box(1.8, 24.4, 6.5, 3.6, 26.4, 7.5, 'pupil');
  // eyebrow ridges
  w.box(-6, 28.6, 6.4, -1, 29.6, 7.2, 'furDark');
  w.box(0.4, 28.4, 6.4, 5.8, 29.4, 7.2, 'furDark');
  // mouth
  w.box(-4.6, 18.2, 6.4, 4.6, 21.6, 7.2, 'pupil');
  for (let x = -4; x <= 4; x += 2) {
    w.box(x - 0.7, 21.6, 6.5, x + 0.7, 22.6, 7.3, 'teeth');
    w.box(x - 0.7, 17.2, 6.5, x + 0.7, 18.2, 7.3, 'teeth');
  }
  w.box(-2.6, 18, 6.8, 2.6, 20, 7.6, 'tongue');
  // snout
  w.box(-2.4, 22.4, 6.8, 2.4, 24.6, 8.4, 'candy');
  // crown
  w.box(-6, 32, -5, 6, 33.4, 5, 'crown');
  for (let x = -5; x <= 5; x += 2.5) {
    for (let z = -4.5; z <= 4.5; z += 3) w.spike(x, z, 34, 3, 0.9, 0.4, 'crown', 1, 0.05);
  }
  w.ellipsoid(0, 33.4, 0, 1.6, 1.6, 1.6, 'ruby');
  // a couple of stray gems floating in the fur for spice
  for (let i = 0; i < 8; i++) {
    const x = rng.int(-9, 9);
    const y = rng.int(8, 30);
    const z = rng.chance(0.5) ? rng.int(-6, -4) : rng.int(4, 6);
    w.set(x, y, z, rng.chance(0.5) ? 'diamond' : 'ruby');
  }
  return grid;
}

function buildObsidianBeast(rng: Rng) {
  const { grid, w } = makeGrid(SHRINK.obsidianBeast);
  // legs
  w.box(-5, 0, -3, -1.6, 9, 3, 'obsidian');
  w.box(1.6, 0, -3, 5, 9, 3, 'obsidian');
  w.box(-6, 0, -4, -0.6, 1.6, 4, 'deepstone');
  w.box(0.6, 0, -4, 6, 1.6, 4, 'deepstone');
  // torso
  w.box(-7, 9, -4.4, 7, 20, 4.4, 'obsidian');
  w.box(-5.4, 20, -3.4, 5.4, 23, 3.4, 'obsidian');
  // chest glow
  w.ellipsoid(0, 14, 3.4, 3.4, 3.4, 2, 'mythic');
  w.ellipsoid(0, 14, 2.6, 1.6, 1.6, 1.2, 'ruby');
  // shoulders
  w.ellipsoid(-8, 20, 0, 3.6, 3.2, 3.6, 'obsidian');
  w.ellipsoid(8, 20, 0, 3.6, 3.2, 3.6, 'obsidian');
  // arms reaching forward
  w.box(-11, 12, -3, -7, 19, 3, 'obsidian');
  w.box(7, 12, -3, 11, 19, 3, 'obsidian');
  w.ellipsoid(-9.6, 10.4, 1, 3, 3, 3.4, 'deepstone');
  w.ellipsoid(9.6, 10.4, 1, 3, 3, 3.4, 'deepstone');
  // claws
  for (const sx of [-1, 1]) {
    const bx = sx * 10.4;
    for (let i = -1; i <= 1; i++) {
      for (let y = 0; y < 5; y++) {
        const r = 1 - y * 0.17;
        for (let a = -1; a <= 1; a++)
          for (let b = -1; b <= 1; b++)
            if (a * a + b * b <= r * r + 0.4) w.set(bx + i * 1.9 + a, 8 + y, 4.5 + b, 'ruby');
      }
    }
  }
  // head
  w.box(-5.4, 23, -4.4, 5.4, 31, 4.4, 'obsidian');
  w.box(-4.4, 31, -3.4, 4.4, 33, 3.4, 'obsidian');
  // horns
  w.spike(-6, 0, 30, 7, 1.6, 0.4, 'deepstone', 1, 0.1);
  w.spike(6, 0, 30, 7, 1.6, 0.4, 'deepstone', 1, 0.1);
  w.spike(-3, -1, 33, 5, 1.2, 0.3, 'deepstone', 1, 0.1);
  w.spike(3, 1, 33, 5, 1.2, 0.3, 'deepstone', 1, 0.1);
  // burning eyes
  w.box(-4.4, 26, 4.4, -1.8, 28.6, 5.2, 'mythic');
  w.box(1.8, 26, 4.4, 4.4, 28.6, 5.2, 'mythic');
  w.box(-3.8, 26.8, 4.8, -2.4, 28, 5.6, 'crown');
  w.box(2.4, 26.8, 4.8, 3.8, 28, 5.6, 'crown');
  // jagged maw
  w.box(-4.4, 23.4, 4.2, 4.4, 25.2, 5, 'pupil');
  for (let x = -4; x <= 4; x += 1.6) {
    w.set(x, 25.6, 5.2, 'teeth');
    w.set(x, 23.2, 5.2, 'teeth');
  }
  // back spines
  for (let i = 0; i < 7; i++) {
    const y = 24 + i * 1.6;
    w.spike(0, 5.6, y, 3, 1.1, 0.3, 'ruby', 1, 0.1);
  }
  for (let i = 0; i < 5; i++) {
    const a = rng.range(0, Math.PI * 2);
    w.vein(rng, Math.round(Math.cos(a) * 4), rng.int(10, 20), Math.round(Math.sin(a) * 3), 4, 'obsidian', 1);
  }
  return grid;
}

function buildMythicCore(rng: Rng) {
  const { grid, w } = makeGrid(SHRINK.mythicCore);
  // stepped pedestal
  w.box(-13, 0, -13, 13, 1, 13, 'deepstone');
  w.box(-11, 2, -11, 11, 4, 11, 'obsidian');
  w.box(-9, 5, -9, 9, 6, 9, 'deepstone');
  w.box(-7, 7, -7, 7, 8, 7, 'obsidian');
  // pillars
  for (const [px, pz] of [
    [-10, -10],
    [10, -10],
    [-10, 10],
    [10, 10],
  ]) {
    w.box(px - 1.4, 4, pz - 1.4, px + 1.4, 20, pz + 1.4, 'obsidian');
    w.box(px - 1.4, 20, pz - 1.4, px + 1.4, 21, pz + 1.4, 'mythic');
    w.ellipsoid(px, 23, pz, 1.6, 1.6, 1.6, 'diamond');
  }
  // pedestal gem
  w.ellipsoid(0, 11, 0, 4.4, 3.4, 4.4, 'obsidian');
  w.ellipsoid(0, 11.5, 0, 2.6, 2.2, 2.6, 'mythic');
  // floating core
  w.ellipsoid(0, 25, 0, 7.4, 8.4, 7.4, 'diamond');
  w.ellipsoid(0, 25, 0, 5.4, 6.2, 5.4, 'mythic');
  w.ellipsoid(0, 26, 0, 3.2, 3.6, 3.2, 'crown');
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const d = 6.6;
    w.ellipsoid(Math.cos(a) * d, 25 + Math.sin(i * 1.7) * 4, Math.sin(a) * d, 1.4, 1.4, 1.4, i % 3 === 0 ? 'ruby' : 'emerald');
  }
  for (let i = 0; i < 24; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(3, 12);
    w.vein(rng, Math.round(Math.cos(a) * d), rng.int(9, 17), Math.round(Math.sin(a) * d), 5, rng.chance(0.5) ? 'diamond' : 'mythic', 1);
  }
  // spikes below the floating core so it looks suspended
  for (let y = 0; y < 8; y++) {
    const r = 7.4 - y * 0.75;
    const ri = Math.round(r);
    for (let x = -ri; x <= ri; x++)
      for (let z = -ri; z <= ri; z++)
        if (x * x + z * z <= r * r + 0.3)
          w.set(x, 18 + y, z, y < 3 ? 'mythic' : 'diamond');
  }
  w.ellipsoid(0, 18, 0, 7.4, 3.2, 7.4, 'diamond');
  w.ellipsoid(0, 17, 0, 4.4, 2.2, 4.4, 'mythic');
  return grid;
}

/* -------------------------------------------------------------- test lab */

/**
 * Dev-only playground for the hand-written pickaxe solver: a flat floor, one
 * lone block, a wall and a pile. Deliberately simple geometry so a bad bounce,
 * a missed probe or a tunnelling pickaxe is obvious at a glance.
 */
function buildPhysicsLab(rng: Rng) {
  const { grid, w } = makeGrid(1);
  // 1. flat floor
  w.box(-11, 0, -11, 11, 0, 11, 'deepstone');
  // 2. a single block, all on its own
  w.box(6, 1, 6, 8, 3, 8, 'stone');
  // 3. a thin wall
  w.box(-7, 1, -8, 3, 12, -8, 'deepstone');
  // 4. a pile of blocks (with a few ores for the fx)
  for (let y = 0; y < 4; y++) {
    const r = 3 - y;
    for (let x = -r; x <= r; x++) {
      for (let z = -r; z <= r; z++) {
        if (x * x + z * z > r * r + 0.4) continue;
        const roll = rng.range(0, 1);
        const mat = roll < 0.1 ? 'gold' : roll < 0.24 ? 'copper' : 'stone';
        w.set(-6 + x, 1 + y, 5 + z, mat);
      }
    }
  }
  return grid;
}

export function buildTarget(id: BuilderId, rng: Rng): VoxelGrid {
  switch (id) {
    case 'oreChunk':
      return buildOreChunk(rng);
    case 'goldVein':
      return buildGoldVein(rng);
    case 'crystalFormation':
      return buildCrystalFormation(rng);
    case 'treasureBlock':
      return buildTreasureBlock(rng);
    case 'memeCreature':
      return buildMemeCreature(rng);
    case 'obsidianBeast':
      return buildObsidianBeast(rng);
    case 'mythicCore':
      return buildMythicCore(rng);
    case 'physicsLab':
      return buildPhysicsLab(rng);
    default:
      return buildOreChunk(rng);
  }
}
