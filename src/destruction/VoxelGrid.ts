import { COIN_SCALE, MATERIAL_IDS, MATERIALS } from '../content/materials';

export interface DestroyedVoxel {
  cell: number;
  mat: number;
  /** voxel coordinates */
  vx: number;
  vy: number;
  vz: number;
  value: number;
}

export interface DamageResult {
  destroyed: DestroyedVoxel[];
  damaged: number[];
  coins: number;
  hitCount: number;
}

export class VoxelGrid {
  readonly sx: number;
  readonly sy: number;
  readonly sz: number;
  readonly size: number;

  readonly active: Uint8Array;
  readonly mat: Uint8Array;
  readonly hp: Float32Array;
  readonly maxHp: Float32Array;
  readonly anchored: Uint8Array;

  count = 0;
  destroyed = 0;
  totalValue = 0;

  private visitStamp: Int32Array;
  private stack: Int32Array;
  private stamp = 0;

  constructor(sx: number, sy: number, sz: number) {
    this.sx = sx;
    this.sy = sy;
    this.sz = sz;
    this.size = sx * sy * sz;
    this.active = new Uint8Array(this.size);
    this.mat = new Uint8Array(this.size);
    this.hp = new Float32Array(this.size);
    this.maxHp = new Float32Array(this.size);
    this.anchored = new Uint8Array(this.size);
    this.visitStamp = new Int32Array(this.size);
    this.stack = new Int32Array(this.size);
  }

  index(x: number, y: number, z: number): number {
    return (y * this.sz + z) * this.sx + x;
  }

  inside(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.sx && y < this.sy && z < this.sz;
  }

  isActiveAt(x: number, y: number, z: number): boolean {
    if (!this.inside(x, y, z)) return false;
    return this.active[this.index(x, y, z)] === 1;
  }

  set(x: number, y: number, z: number, materialId: string, hpMul = 1): void {
    if (!this.inside(x, y, z)) return;
    const i = this.index(x, y, z);
    const def = MATERIALS[materialId] ?? MATERIALS.stone;
    const matIdx = MATERIAL_IDS.indexOf(def.id);
    const hp = def.hardness * hpMul;
    if (this.active[i] === 1) {
      // Later writes win: this is how veins and face details are painted on.
      if (this.mat[i] === matIdx && this.maxHp[i] === hp) return;
      this.totalValue -= this.valueAt(i);
      this.mat[i] = matIdx;
      this.hp[i] = hp;
      this.maxHp[i] = hp;
      this.totalValue += def.value * COIN_SCALE;
      return;
    }
    this.active[i] = 1;
    this.mat[i] = matIdx;
    this.hp[i] = hp;
    this.maxHp[i] = hp;
    this.count++;
    this.totalValue += def.value * COIN_SCALE;
    if (y === 0) this.anchored[i] = 1;
  }

  materialIdAt(cell: number): string {
    return MATERIAL_IDS[this.mat[cell]] ?? 'stone';
  }

  valueAt(cell: number): number {
    return (MATERIALS[MATERIAL_IDS[this.mat[cell]]]?.value ?? 1) * COIN_SCALE;
  }

  private kill(cell: number): void {
    this.active[cell] = 0;
    this.anchored[cell] = 0;
    this.count--;
    this.destroyed++;
  }

  /**
   * Apply a spherical blast. Damage falls off from the centre with a flat
   * inner core so even weak tools carve a clean crater.
   *
   * `footprint` (voxel units) keeps the voxels directly underneath a rolling
   * body alive: anything inside that column below the centre is skipped so a
   * sphere can ride the surface instead of digging itself in.
   *
   * `maxDestroy` genuinely caps how many blocks may be *destroyed* this hit -
   * the closest blocks break first and everything else is only chipped. This is
   * what makes the starter pickaxe break exactly one block.
   */
  damageSphere(
    cx: number,
    cy: number,
    cz: number,
    radius: number,
    damage: number,
    maxkill = 900,
    footprint = 0,
    maxDestroy = Infinity,
    flattenZ = 1,
  ): DamageResult {
    const out: DamageResult = { destroyed: [], damaged: [], coins: 0, hitCount: 0 };
    const r = Math.max(radius, 0.35);
    const skipR = footprint > 0 ? footprint * 0.62 : 0;
    const skipDepth = footprint > 0 ? footprint * 0.2 : 0;
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(this.sx - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(this.sy - 1, Math.ceil(cy + r));
    const z0 = Math.max(0, Math.floor(cz - r));
    const z1 = Math.min(this.sz - 1, Math.ceil(cz + r));

    const cells: number[] = [];
    const dists: number[] = [];
    const dmgs: number[] = [];
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const cell = this.index(x, y, z);
          if (this.active[cell] !== 1) continue;
          // Grid space: a voxel's centre sits exactly at its integer index, so
          // one block of distance == 1.0. This keeps `radiusBlocks` meaningful.
          const dx = x - cx;
          const dy = y - cy;
          // flattenZ squashes the blast along the tool's plane normal so a
          // flat blade does not gouge blocks it never touched in depth.
          const dz = (z - cz) * flattenZ;
          if (skipR > 0 && dy < -skipDepth && dx * dx + dz * dz < skipR * skipR) continue;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > r * r) continue;
          const t = Math.sqrt(d2) / r;
          const falloff = t < 0.32 ? 1 : 1 - Math.pow((t - 0.32) / 0.68, 1.25);
          const dmg = damage * falloff;
          if (dmg <= 0.2) continue;
          cells.push(cell);
          dists.push(d2);
          dmgs.push(dmg);
        }
      }
    }

    // nearest blocks die first, so a capped hit always bites the surface
    const order = cells.map((_, i) => i).sort((a, b) => dists[a] - dists[b]);
    let destroyed = 0;
    for (const i of order) {
      const cell = cells[i];
      if (this.active[cell] !== 1) continue;
      out.hitCount++;
      const dmg = dmgs[i];
      const dies = this.hp[cell] - dmg <= 0;
      if (dies && destroyed < maxDestroy && out.destroyed.length < maxkill) {
        const x = cell % this.sx;
        const rest = (cell - x) / this.sx;
        const z = rest % this.sz;
        const y = (rest - z) / this.sz;
        out.destroyed.push({
          cell,
          mat: this.mat[cell],
          vx: x,
          vy: y,
          vz: z,
          value: this.valueAt(cell),
        });
        out.coins += this.valueAt(cell);
        destroyed++;
        this.kill(cell);
      } else {
        this.hp[cell] = Math.max(1, this.hp[cell] - dmg);
        out.damaged.push(cell);
      }
    }
    return out;
  }

  /** Active voxels that are no longer connected to the anchor layer. */
  findFloating(): number[] {    this.stamp++;
    const stamp = this.stamp;
    const visit = this.visitStamp;
    const stack = this.stack;
    const sx = this.sx;
    const sz = this.sz;
    const sy = this.sy;
    let top = 0;

    for (let i = 0; i < this.size; i++) {
      if (this.active[i] === 1 && this.anchored[i] === 1 && visit[i] !== stamp) {
        visit[i] = stamp;
        stack[top++] = i;
      }
    }

    while (top > 0) {
      const i = stack[--top];
      const x = i % sx;
      const yz = (i - x) / sx;
      const z = yz % sz;
      const y = (yz - z) / sz;

      if (x > 0) {
        const n = i - 1;
        if (this.active[n] === 1 && visit[n] !== stamp) {
          visit[n] = stamp;
          stack[top++] = n;
        }
      }
      if (x < sx - 1) {
        const n = i + 1;
        if (this.active[n] === 1 && visit[n] !== stamp) {
          visit[n] = stamp;
          stack[top++] = n;
        }
      }
      if (z > 0) {
        const n = i - sx;
        if (this.active[n] === 1 && visit[n] !== stamp) {
          visit[n] = stamp;
          stack[top++] = n;
        }
      }
      if (z < sz - 1) {
        const n = i + sx;
        if (this.active[n] === 1 && visit[n] !== stamp) {
          visit[n] = stamp;
          stack[top++] = n;
        }
      }
      if (y > 0) {
        const n = i - sx * sz;
        if (this.active[n] === 1 && visit[n] !== stamp) {
          visit[n] = stamp;
          stack[top++] = n;
        }
      }
      if (y < sy - 1) {
        const n = i + sx * sz;
        if (this.active[n] === 1 && visit[n] !== stamp) {
          visit[n] = stamp;
          stack[top++] = n;
        }
      }
    }

    const out: number[] = [];
    for (let i = 0; i < this.size; i++) {
      if (this.active[i] === 1 && visit[i] !== stamp) out.push(i);
    }
    return out;
  }

  /**
   * Called once after a target is generated: any piece that is floating in the
   * freshly built structure (decorative boulders, a suspended core, ...) gets
   * anchored at its lowest point so it only collapses once the player actually
   * severs it.
   */
  seal(): void {
    const floating = this.findFloating();
    if (!floating.length) return;
    const isFloating = new Uint8Array(this.size);
    for (const cell of floating) isFloating[cell] = 1;
    const layer = this.sx * this.sz;
    for (const cell of floating) {
      const below = cell - layer;
      if (below >= 0 && isFloating[below] === 1) continue;
      this.anchored[cell] = 1;
    }
  }

  /** Detach a voxel (used when a floating island becomes debris). */
  detach(cell: number): DestroyedVoxel | null {    if (this.active[cell] !== 1) return null;
    const sx = this.sx;
    const sz = this.sz;
    const x = cell % sx;
    const yz = (cell - x) / sx;
    const z = yz % sz;
    const y = (yz - z) / sz;
    const info: DestroyedVoxel = {
      cell,
      mat: this.mat[cell],
      vx: x,
      vy: y,
      vz: z,
      value: this.valueAt(cell),
    };
    this.kill(cell);
    return info;
  }

  /** Highest active voxel in a column, or -1. */
  columnTop(x: number, z: number): number {
    if (x < 0 || z < 0 || x >= this.sx || z >= this.sz) return -1;
    for (let y = this.sy - 1; y >= 0; y--) {
      if (this.active[this.index(x, y, z)] === 1) return y;
    }
    return -1;
  }

  /** Greedy-merged boxes over the remaining voxels (used for collision). */
  buildCollisionBoxes(maxBoxes = 900): { min: [number, number, number]; max: [number, number, number] }[] {
    const { sx, sy, sz } = this;
    const mask = new Uint8Array(sx * sz);
    const visited = new Uint8Array(sx * sz);
    const groups = new Map<string, number[]>();
    const rects: [number, number, number, number, number][] = [];

    for (let y = 0; y < sy; y++) {
      mask.fill(0);
      visited.fill(0);
      let any = false;
      for (let z = 0; z < sz; z++) {
        const row = (y * sz + z) * sx;
        for (let x = 0; x < sx; x++) {
          if (this.active[row + x] === 1) {
            mask[z * sx + x] = 1;
            any = true;
          }
        }
      }
      if (!any) continue;

      for (let z = 0; z < sz; z++) {
        for (let x = 0; x < sx; x++) {
          if (mask[z * sx + x] !== 1 || visited[z * sx + x] === 1) continue;
          let w = 1;
          while (x + w < sx && mask[z * sx + x + w] === 1 && visited[z * sx + x + w] === 0) w++;
          let d = 1;
          outer: while (z + d < sz) {
            for (let i = 0; i < w; i++) {
              const idx = (z + d) * sx + x + i;
              if (mask[idx] !== 1 || visited[idx] === 1) break outer;
            }
            d++;
          }
          for (let zz = 0; zz < d; zz++) {
            const base = (z + zz) * sx + x;
            for (let xx = 0; xx < w; xx++) visited[base + xx] = 1;
          }
          rects.push([x, z, w, d, y]);
        }
      }

      for (const [x, z, w, d] of rects) {
        const key = `${x}:${z}:${w}:${d}`;
        const list = groups.get(key);
        if (list) list.push(y);
        else groups.set(key, [y]);
      }
      rects.length = 0;
    }

    const boxes: { min: [number, number, number]; max: [number, number, number] }[] = [];
    for (const [key, ys] of groups) {
      const [x, z, w, d] = key.split(':').map(Number) as [number, number, number, number];
      ys.sort((a, b) => a - b);
      let start = ys[0];
      let prev = ys[0];
      for (let i = 1; i <= ys.length; i++) {
        const cur = ys[i];
        if (i === ys.length || cur !== prev + 1) {
          boxes.push({ min: [x, start, z], max: [x + w, prev + 1, z + d] });
          if (boxes.length >= maxBoxes) return boxes;
          start = cur;
        }
        prev = cur;
      }
    }
    return boxes;
  }
}
