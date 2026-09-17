import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { VoxelGrid } from './VoxelGrid';
import type { DestroyedVoxel, DamageResult } from './VoxelGrid';
import type { TargetSpec } from '../content/targets';
import { MATERIAL_IDS, MATERIALS } from '../content/materials';
import { voxelMaterial } from '../scene/Textures';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { GRID_X, GRID_Y, GRID_Z, buildTarget } from './builders';
import { Rng, rand } from '../utils/rng';
import { clamp, easeOutCubic } from '../utils/math';

const BOX_GEO = new THREE.BoxGeometry(1, 1, 1);

export interface TargetHooks {
  onVoxelsDestroyed(voxels: DestroyedVoxel[], worldOf: (cell: number, out: THREE.Vector3) => THREE.Vector3): void;
  onDebris(pos: THREE.Vector3, matIdx: number, scale: number): void;
  /** Voxels that fell off on their own (unsupported chunks) - still pay out. */
  onCollapsed(
    voxels: DestroyedVoxel[],
    worldOf: (cell: number, out: THREE.Vector3) => THREE.Vector3,
  ): void;
  onDamaged(cell: number): void;
}

interface Bucket {
  matIdx: number;
  mesh: THREE.InstancedMesh;
  cells: number[];
}

export class Target {
  readonly spec: TargetSpec;
  readonly grid: VoxelGrid;
  readonly group = new THREE.Group();
  readonly voxelSize: number;
  private buckets = new Map<number, Bucket>();
  private cellSlot!: Int32Array;
  private body!: RAPIER.RigidBody;
  private initialCount = 0;
  private colliderDirty = true;
  private rebuildTimer = 0;
  private structureTimer = 0;
  private structureDirty = false;
  private hooks: TargetHooks;
  private holeCount = 0;
  private spawnT = -1;
  private spawnBounce = 0;
  private measureCache: { radius: number; height: number } | null = null;
  private measureAge = 0;
  private disposed = false;

  constructor(
    spec: TargetSpec,
    private physics: PhysicsWorld,
    hooks: TargetHooks,
    seed = 12345,
  ) {
    this.spec = spec;
    this.hooks = hooks;
    this.voxelSize = spec.voxelSize;
    this.grid = buildTarget(spec.builder, new Rng(seed));
    for (const i of this.grid.hp.keys()) {
      if (this.grid.active[i] === 1) {
        this.grid.hp[i] *= spec.hpScale;
        this.grid.maxHp[i] *= spec.hpScale;
      }
    }
    this.grid.totalValue = 0;
    for (let i = 0; i < this.grid.size; i++) {
      if (this.grid.active[i] === 1) this.grid.totalValue += this.grid.valueAt(i);
    }
    this.grid.seal();
    this.initialCount = this.grid.count;
    this.buildMeshes();
    this.createBody();
  }

  /* ------------------------------------------------------------- geometry */

  private buildMeshes(): void {
    const { grid } = this;
    const list: number[][] = [];
    for (let m = 0; m < MATERIAL_IDS.length; m++) list.push([]);
    this.cellSlot = new Int32Array(grid.size).fill(-1);
    for (let i = 0; i < grid.size; i++) {
      if (grid.active[i] === 1) list[grid.mat[i]].push(i);
    }

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const rng = new Rng(9081);

    for (let m = 0; m < MATERIAL_IDS.length; m++) {
      const cells = list[m];
      if (cells.length === 0) continue;
      const def = MATERIALS[MATERIAL_IDS[m]];
      const mesh = new THREE.InstancedMesh(BOX_GEO, voxelMaterial(def), cells.length);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cells.length * 3), 3);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.count = cells.length;
      for (let s = 0; s < cells.length; s++) {
        const cell = cells[s];
        this.cellSlot[cell] = s;
        this.composeMatrix(cell, dummy);
        mesh.setMatrixAt(s, dummy.matrix);
        const shade = rng.range(0.88, 1.12);
        const hueShift = def.fx === 'organic' ? rng.range(0.94, 1.06) : 1;
        color.setRGB(
          clamp(shade * hueShift, 0, 1.4),
          clamp(shade, 0, 1.4),
          clamp(shade * (def.fx === 'organic' ? 0.98 : 1), 0, 1.4),
        );
        mesh.setColorAt(s, color);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      this.group.add(mesh);
      this.buckets.set(m, { matIdx: m, mesh, cells });
    }
  }

  private composeMatrix(cell: number, dummy: THREE.Object3D): void {
    const vs = this.voxelSize;
    const x = cell % GRID_X;
    const rest = (cell - x) / GRID_X;
    const z = rest % GRID_Z;
    const y = (rest - z) / GRID_Z;
    dummy.position.set(
      (x - GRID_X / 2 + 0.5) * vs,
      (y + 0.5) * vs,
      (z - GRID_Z / 2 + 0.5) * vs,
    );
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(vs);
    if (this.spawnT > 0) {
      const delay = (y / GRID_Y) * 0.42 + ((x * 7 + z * 13) % 11) * 0.012;
      const t = clamp((1 - this.spawnT - delay) / 0.5, 0, 1);
      const e = easeOutCubic(t);
      dummy.position.y += (1 - e) * 26 + Math.sin(e * Math.PI) * this.spawnBounce;
      dummy.position.y += (1 - t) * 0.35 * Math.sin((x + z) * 1.7);
    }
    dummy.updateMatrix();
  }

  worldOf(cell: number, out = new THREE.Vector3()): THREE.Vector3 {
    const vs = this.voxelSize;
    const x = cell % GRID_X;
    const rest = (cell - x) / GRID_X;
    const z = rest % GRID_Z;
    const y = (rest - z) / GRID_Z;
    return out.set(
      (x - GRID_X / 2 + 0.5) * vs,
      (y + 0.5) * vs,
      (z - GRID_Z / 2 + 0.5) * vs,
    );
  }

  /* --------------------------------------------------------------- physics */

  private createBody(): void {
    this.body = this.physics.world.createRigidBody(this.physics.RAPIER.RigidBodyDesc.fixed());
    this.rebuildColliders();
  }

  rebuilds = 0;
  lastDamage: unknown = null;

  private rebuildColliders(): void {
    this.rebuilds++;
    this.physics.removeCollidersOf(this.body);
    const boxes = this.grid.buildCollisionBoxes(760);
    const vs = this.voxelSize;
    const desc = this.physics.RAPIER.ColliderDesc;
    for (const b of boxes) {
      const hx = ((b.max[0] - b.min[0]) * vs) / 2;
      const hy = ((b.max[1] - b.min[1]) * vs) / 2;
      const hz = ((b.max[2] - b.min[2]) * vs) / 2;
      const cx = (b.min[0] - GRID_X / 2 + (b.max[0] - b.min[0]) / 2) * vs;
      const cy = (b.min[1] + (b.max[1] - b.min[1]) / 2) * vs;
      const cz = (b.min[2] - GRID_Z / 2 + (b.max[2] - b.min[2]) / 2) * vs;
      const col = desc
        .cuboid(hx, hy, hz)
        .setTranslation(cx, cy, cz)
        .setFriction(0.94)
        .setRestitution(0.03)
        .setActiveEvents(this.physics.RAPIER.ActiveEvents.COLLISION_EVENTS);
      const c = this.physics.world.createCollider(col, this.body);
      this.physics.registerCollider(c.handle, { kind: 'target', ref: this });
    }
    this.colliderDirty = false;
    this.rebuildTimer = 0.15;
  }

  /* ---------------------------------------------------------------- damage */

  /** Convert a world point into continuous voxel-grid coordinates. */
  toGrid(v: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return out.set(
      v.x / this.voxelSize + GRID_X / 2 - 0.5,
      v.y / this.voxelSize - 0.5,
      v.z / this.voxelSize + GRID_Z / 2 - 0.5,
    );
  }

  /**
   * Fast voxel raycast (Amanatides & Woo DDA) straight against the occupancy
   * grid. This replaces raycasting thousands of InstancedMesh instances every
   * mouse move, which was the single biggest CPU cost in the game.
   */
  raycastVoxels(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxDist = 160,
  ): { point: THREE.Vector3; normal: THREE.Vector3; cell: number } | null {
    const vs = this.voxelSize;
    const ox = origin.x / vs + GRID_X / 2 - 0.5;
    const oy = origin.y / vs - 0.5;
    const oz = origin.z / vs + GRID_Z / 2 - 0.5;

    let dvx = dir.x / vs;
    let dvy = dir.y / vs;
    let dvz = dir.z / vs;
    const dl = Math.hypot(dvx, dvy, dvz);
    if (dl < 1e-6) return null;
    dvx /= dl;
    dvy /= dl;
    dvz /= dl;

    let ix = Math.floor(ox);
    let iy = Math.floor(oy);
    let iz = Math.floor(oz);
    const stepX = dvx > 0 ? 1 : -1;
    const stepY = dvy > 0 ? 1 : -1;
    const stepZ = dvz > 0 ? 1 : -1;
    const tDeltaX = Math.abs(1 / (dvx || 1e-9));
    const tDeltaY = Math.abs(1 / (dvy || 1e-9));
    const tDeltaZ = Math.abs(1 / (dvz || 1e-9));
    let tMaxX = dvx === 0 ? Infinity : (dvx > 0 ? ix + 1 - ox : ox - ix) * tDeltaX;
    let tMaxY = dvy === 0 ? Infinity : (dvy > 0 ? iy + 1 - oy : oy - iy) * tDeltaY;
    let tMaxZ = dvz === 0 ? Infinity : (dvz > 0 ? iz + 1 - oz : oz - iz) * tDeltaZ;

    const maxT = maxDist / vs;
    let t = 0;
    let face = -1;
    const out = new THREE.Vector3();
    const normal = new THREE.Vector3();
    for (let guard = 0; guard < 512 && t <= maxT; guard++) {
      if (ix >= 0 && iy >= 0 && iz >= 0 && ix < GRID_X && iy < GRID_Y && iz < GRID_Z) {
        const cell = this.grid.index(ix, iy, iz);
        if (this.grid.active[cell] === 1) {
          out.copy(origin).addScaledVector(dir, t * vs);
          if (face === 0) normal.set(-stepX, 0, 0);
          else if (face === 1) normal.set(0, -stepY, 0);
          else if (face === 2) normal.set(0, 0, -stepZ);
          else normal.set(0, 1, 0);
          return { point: out, normal, cell };
        }
      }
      if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
        ix += stepX;
        t = tMaxX;
        tMaxX += tDeltaX;
        face = 0;
      } else if (tMaxY <= tMaxZ) {
        iy += stepY;
        t = tMaxY;
        tMaxY += tDeltaY;
        face = 1;
      } else {
        iz += stepZ;
        t = tMaxZ;
        tMaxZ += tDeltaZ;
        face = 2;
      }
    }
    return null;
  }

  /**
   * Finds the solid block nearest to a world point and snaps the point to that
   * block's exact centre. This is what makes a hit remove the block the tool
   * actually touched instead of an arbitrary sphere in space.
   */
  snapToBlock(p: THREE.Vector3, maxSearch = 3): boolean {
    const g = this.toGrid(p, GRID_SCRATCH);
    const baseX = Math.round(g.x);
    const baseZ = Math.round(g.z);
    const baseY = Math.round(g.y);
    let best = -1;
    let bestD = Infinity;
    for (let ring = 0; ring <= maxSearch; ring++) {
      for (let ox = -ring; ox <= ring; ox++) {
        for (let oz = -ring; oz <= ring; oz++) {
          for (let oy = -ring; oy <= ring; oy++) {
            if (
              ring > 0 &&
              Math.abs(ox) !== ring &&
              Math.abs(oz) !== ring &&
              Math.abs(oy) !== ring
            ) {
              continue;
            }
            const x = baseX + ox;
            const y = baseY + oy;
            const z = baseZ + oz;
            if (!this.grid.isActiveAt(x, y, z)) continue;
            const d = ox * ox + oy * oy + oz * oz;
            if (d < bestD) {
              bestD = d;
              best = this.grid.index(x, y, z);
            }
          }
        }
      }
      if (best >= 0) break;
    }
    if (best < 0) return false;
    this.worldOf(best, p);
    return true;
  }

  /**
   * Pulls a world point onto the nearest solid voxel of the same column.
   * Physics contacts are reported a frame late (the body has already been
   * pushed back out), so without this the crater would float above the
   * surface at low frame rates.
   */
  snapToSurface(p: THREE.Vector3, maxSearch = 7): boolean {
    const g = this.toGrid(p, GRID_SCRATCH);
    const baseX = Math.round(g.x);
    const baseZ = Math.round(g.z);
    const startY = Math.round(g.y);
    const vs = this.voxelSize;
    for (let ring = 0; ring <= 2; ring++) {
      for (let ox = -ring; ox <= ring; ox++) {
        for (let oz = -ring; oz <= ring; oz++) {
          if (ring > 0 && Math.abs(ox) !== ring && Math.abs(oz) !== ring) continue;
          const x = baseX + ox;
          const z = baseZ + oz;
          for (let d = 0; d <= maxSearch; d++) {
            for (const y of d === 0 ? [startY] : [startY - d, startY + d]) {
              if (this.grid.isActiveAt(x, y, z)) {
                p.y = (y + 0.5) * vs;
                return true;
              }
            }
          }
        }
      }
    }
    return false;
  }

  damage(
    worldPoint: THREE.Vector3,
    radiusWorld: number,
    damage: number,
    maxKill = 900,
    footprintWorld = 0,
  ): DamageResult {
    const g = this.toGrid(worldPoint, new THREE.Vector3());
    const rVox = Math.max(0.5, radiusWorld / this.voxelSize);
    const res = this.grid.damageSphere(
      g.x,
      g.y,
      g.z,
      rVox,
      damage,
      maxKill,
      footprintWorld / this.voxelSize,
    );
    if (res.destroyed.length) {
      for (const v of res.destroyed) this.removeInstance(v.cell, v.mat);
      this.colliderDirty = true;
      this.structureDirty = true;
      this.measureCache = null;
      this.hooks.onVoxelsDestroyed(res.destroyed, (cell, out) => this.worldOf(cell, out));
      this.holeCount += res.destroyed.length;
    }
    for (const cell of res.damaged) this.applyDamageTint(cell);
    if (import.meta.env.DEV) this.lastDamage = {
      gw: [Number(g.x.toFixed(2)), Number(g.y.toFixed(2)), Number(g.z.toFixed(2))],
      rVox: Number(rVox.toFixed(2)),
      damage: Number(damage.toFixed(1)),
      footprintVox: Number((footprintWorld / this.voxelSize).toFixed(2)),
      destroyed: res.destroyed.length,
      hit: res.hitCount,
    };
    return res;
  }

  /** Directly remove a voxel (used by explosions and floating-chunk detachment). */
  removeVoxel(v: DestroyedVoxel): void {
    this.removeInstance(v.cell, v.mat);
    this.measureCache = null;
    this.holeCount++;
  }

  private removeInstance(cell: number, matIdx: number): void {
    const bucket = this.buckets.get(matIdx);
    if (!bucket) return;
    const slot = this.cellSlot[cell];
    if (slot < 0) return;
    const cells = bucket.cells;
    const last = cells.length - 1;
    if (slot !== last) {
      const movedCell = cells[last];
      cells[slot] = movedCell;
      this.cellSlot[movedCell] = slot;
      bucket.mesh.getMatrixAt(last, MATRIX_SCRATCH);
      bucket.mesh.setMatrixAt(slot, MATRIX_SCRATCH);
      if (bucket.mesh.instanceColor) {
        const ca = bucket.mesh.instanceColor.array as Float32Array;
        ca[slot * 3] = ca[last * 3];
        ca[slot * 3 + 1] = ca[last * 3 + 1];
        ca[slot * 3 + 2] = ca[last * 3 + 2];
        bucket.mesh.instanceColor.needsUpdate = true;
      }
    }
    cells.pop();
    this.cellSlot[cell] = -1;
    bucket.mesh.count = cells.length;
    bucket.mesh.instanceMatrix.needsUpdate = true;
  }

  private applyDamageTint(cell: number): void {
    const matIdx = this.grid.mat[cell];
    const bucket = this.buckets.get(matIdx);
    if (!bucket || !bucket.mesh.instanceColor) return;
    const slot = this.cellSlot[cell];
    if (slot < 0) return;
    const ratio = clamp(this.grid.hp[cell] / Math.max(1, this.grid.maxHp[cell]), 0, 1);
    const dark = 0.5 + ratio * 0.55;
    const ca = bucket.mesh.instanceColor.array as Float32Array;
    ca[slot * 3] = dark * (0.94 + (1 - ratio) * 0.16);
    ca[slot * 3 + 1] = dark * (0.74 + ratio * 0.3);
    ca[slot * 3 + 2] = dark * (0.66 + ratio * 0.38);
    bucket.mesh.instanceColor.needsUpdate = true;
  }

  /** Removes voxels that lost their support and turns them into debris. */
  private collapseUnsupported(): void {
    const floating = this.grid.findFloating();
    if (!floating.length) return;
    const limit = 42;
    const tmp = new THREE.Vector3();
    const paid: DestroyedVoxel[] = [];
    for (let i = 0; i < floating.length; i++) {
      const info = this.grid.detach(floating[i]);
      if (!info) continue;
      this.removeInstance(info.cell, info.mat);
      paid.push(info);
      if (i < limit) this.hooks.onDebris(this.worldOf(info.cell, tmp), info.mat, this.voxelSize);
    }
    this.hooks.onCollapsed(paid, (cell, out) => this.worldOf(cell, out));
    this.colliderDirty = true;
  }

  /* ----------------------------------------------------------------- frame */

  startSpawn(bounce = 1.4): void {
    this.spawnT = 1;
    this.spawnBounce = bounce;
  }

  update(dt: number): void {
    if (this.disposed) return;
    this.measureAge += dt;
    if (this.rebuildTimer > 0) this.rebuildTimer -= dt;
    if (this.structureTimer > 0) this.structureTimer -= dt;

    if (this.spawnT > 0) {
      this.spawnT = Math.max(0, this.spawnT - dt / 1.15);
      const dummy = new THREE.Object3D();
      for (const bucket of this.buckets.values()) {
        for (let s = 0; s < bucket.cells.length; s++) {
          this.composeMatrix(bucket.cells[s], dummy);
          bucket.mesh.setMatrixAt(s, dummy.matrix);
        }
        bucket.mesh.instanceMatrix.needsUpdate = true;
      }
      if (this.spawnT === 0) {
        for (const bucket of this.buckets.values()) {
          for (let s = 0; s < bucket.cells.length; s++) {
            this.composeMatrix(bucket.cells[s], dummy);
            bucket.mesh.setMatrixAt(s, dummy.matrix);
          }
          bucket.mesh.instanceMatrix.needsUpdate = true;
        }
      }
      return;
    }

    if (this.colliderDirty && this.rebuildTimer <= 0) this.rebuildColliders();
    if (this.structureDirty && this.structureTimer <= 0) {
      this.structureDirty = false;
      this.structureTimer = 0.28;
      this.collapseUnsupported();
    }
  }

  frameTarget(): { center: THREE.Vector3; radius: number; height: number } {
    const m = this.measure();
    return { center: new THREE.Vector3(0, m.height * 0.5, 0), radius: m.radius, height: m.height };
  }

  /** Real bounds of the remaining shape (cached until something breaks). */
  measure(): { radius: number; height: number } {
    if (this.measureCache && this.measureAge < 0.35) return this.measureCache;
    this.measureAge = 0;
    let maxR2 = 0;
    let maxY = 0;
    for (let i = 0; i < this.grid.size; i++) {
      if (this.grid.active[i] !== 1) continue;
      const x = i % GRID_X;
      const rest = (i - x) / GRID_X;
      const z = rest % GRID_Z;
      const y = (rest - z) / GRID_Z;
      const dx = x - GRID_X / 2;
      const dz = z - GRID_Z / 2;
      const r2 = dx * dx + dz * dz;
      if (r2 > maxR2) maxR2 = r2;
      if (y > maxY) maxY = y;
    }
    const vs = this.voxelSize;
    this.measureCache = {
      radius: Math.max(Math.sqrt(maxR2) * vs + vs, 2),
      height: Math.max(maxY * vs + vs * 2, 2),
    };
    return this.measureCache;
  }

  /** Kept for camera fallbacks. */
  liveRadius(): number {
    return this.measure().radius;
  }

  get colliderCount(): number {
    return this.body.numColliders();
  }

  get percentDestroyed(): number {
    return clamp(1 - this.grid.count / Math.max(1, this.initialCount), 0, 1);
  }

  get remaining(): number {
    return this.grid.count;
  }

  get isCleared(): boolean {
    return this.grid.count <= 0 || this.percentDestroyed >= 0.995;
  }

  /** Blow the rest of the target apart for the finale. */
  finaleBurst(): DestroyedVoxel[] {
    const all: DestroyedVoxel[] = [];
    const tmp = new THREE.Vector3();
    const cells: number[] = [];
    for (let i = 0; i < this.grid.size; i++) if (this.grid.active[i] === 1) cells.push(i);
    // shuffle so the burst looks chaotic
    for (let i = cells.length - 1; i > 0; i--) {
      const j = (rand(0, 1) * (i + 1)) | 0;
      const t = cells[i];
      cells[i] = cells[j];
      cells[j] = t;
    }
    for (let i = 0; i < cells.length; i++) {
      const info = this.grid.detach(cells[i]);
      if (!info) continue;
      this.removeInstance(info.cell, info.mat);
      if (i < 260) this.hooks.onDebris(this.worldOf(info.cell, tmp), info.mat, this.voxelSize);
      all.push(info);
    }
    this.measureCache = null;
    this.colliderDirty = true;
    this.measureCache = null;
    return all;
  }

  dispose(): void {
    this.disposed = true;
    this.physics.removeBody(this.body);
    for (const b of this.buckets.values()) {
      this.group.remove(b.mesh);
      b.mesh.dispose();
    }
    this.buckets.clear();
    this.group.removeFromParent();
  }
}

const MATRIX_SCRATCH = new THREE.Matrix4();
const GRID_SCRATCH = new THREE.Vector3();
