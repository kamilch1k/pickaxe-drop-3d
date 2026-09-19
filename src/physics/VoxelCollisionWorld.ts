import { Vector3 } from 'three';
import { GRID_X, GRID_Y, GRID_Z } from '../destruction/builders';
import { MATERIALS } from '../content/materials';
import type { Target } from '../destruction/Target';
import { sweepAABB, makeSweepResult, type CollisionWorld, type SweepHit } from './PickaxeSimulator';

/**
 * The pickaxe solver only ever asks one question - "did this sphere cross
 * anything on its way from A to B?" - so the whole world lives behind this
 * class. It answers from two sources:
 *
 *   1. the arena deck, as a single AABB, and
 *   2. the live voxel grid of the current target.
 *
 * Voxel queries walk the small cell box the sweep covers, then run an exact
 * swept-sphere vs AABB test against each occupied cell. Nothing is tested
 * against meshes and nothing relies on "is this point inside a block", so a
 * fast pickaxe can never tunnel and a resting one is always pushed out.
 *
 * Swapping voxels for something else (or `workspace:Spherecast` in a Luau port)
 * only means replacing this file.
 */

export interface VoxelCollisionWorldOptions {
  /** top surface of the arena deck */
  groundY?: number;
  /** half extent of the deck in X/Z */
  groundHalf?: number;
  /** deck thickness below the surface */
  groundDepth?: number;
  /** voxel hardness that maps to resistance 1 */
  resistanceScale?: number;
}

export class VoxelCollisionWorld implements CollisionWorld {
  groundY: number;
  groundHalf: number;
  groundDepth: number;
  resistanceScale: number;

  private readonly deckMin = new Vector3();
  private readonly deckMax = new Vector3();
  private readonly cellMin = new Vector3();
  private readonly cellMax = new Vector3();
  private readonly result = makeSweepResult();
  private readonly getTarget: () => Target | null;

  constructor(getTarget: () => Target | null, opts: VoxelCollisionWorldOptions = {}) {
    this.getTarget = getTarget;
    this.groundY = opts.groundY ?? 0;
    this.groundHalf = opts.groundHalf ?? 16;
    this.groundDepth = opts.groundDepth ?? 2.6;
    this.resistanceScale = opts.resistanceScale ?? 100;
    this.deckMin.set(-this.groundHalf, this.groundY - this.groundDepth, -this.groundHalf);
    this.deckMax.set(this.groundHalf, this.groundY, this.groundHalf);
  }

  sweepSphere(from: Vector3, to: Vector3, radius: number): SweepHit | null {
    let best = this.sweepDeck(from, to, radius);
    const voxel = this.sweepVoxels(from, to, radius);
    if (voxel && (!best || voxel.t < best.t)) best = voxel;
    return best;
  }

  private sweepDeck(from: Vector3, to: Vector3, radius: number): SweepHit | null {
    const hit = sweepAABB(
      from,
      to,
      this.cellMin.set(this.deckMin.x - radius, this.deckMin.y - radius, this.deckMin.z - radius),
      this.cellMax.set(this.deckMax.x + radius, this.deckMax.y + radius, this.deckMax.z + radius),
      this.result,
    );
    if (!hit) return null;
    return {
      t: hit.t,
      point: new Vector3(
        from.x + (to.x - from.x) * hit.t,
        from.y + (to.y - from.y) * hit.t,
        from.z + (to.z - from.z) * hit.t,
      ),
      normal: hit.normal.clone(),
      depth: hit.depth,
      destructible: false,
      resistance: 0,
      node: 'ground',
    };
  }

  /**
   * Cell-box sweep: every occupied cell the swept sphere could possibly touch
   * is tested exactly, and the earliest contact wins.
   */
  private sweepVoxels(from: Vector3, to: Vector3, radius: number): SweepHit | null {
    const target = this.getTarget();
    if (!target) return null;
    const grid = target.grid;
    const vs = target.voxelSize;

    const minX = Math.min(from.x, to.x) - radius;
    const minY = Math.min(from.y, to.y) - radius;
    const minZ = Math.min(from.z, to.z) - radius;
    const maxX = Math.max(from.x, to.x) + radius;
    const maxY = Math.max(from.y, to.y) + radius;
    const maxZ = Math.max(from.z, to.z) + radius;

    const x0 = Math.max(0, Math.floor(minX / vs + GRID_X / 2));
    const x1 = Math.min(GRID_X - 1, Math.floor(maxX / vs + GRID_X / 2));
    const y0 = Math.max(0, Math.floor(minY / vs));
    const y1 = Math.min(GRID_Y - 1, Math.floor(maxY / vs));
    const z0 = Math.max(0, Math.floor(minZ / vs + GRID_Z / 2));
    const z1 = Math.min(GRID_Z - 1, Math.floor(maxZ / vs + GRID_Z / 2));

    let best: SweepHit | null = null;
    for (let y = y0; y <= y1; y += 1) {
      const cellMinY = y * vs;
      for (let z = z0; z <= z1; z += 1) {
        const cellMinZ = (z - GRID_Z / 2) * vs;
        for (let x = x0; x <= x1; x += 1) {
          const cell = grid.index(x, y, z);
          if (grid.active[cell] !== 1) continue;
          const cellMinX = (x - GRID_X / 2) * vs;
          this.cellMin.set(cellMinX - radius, cellMinY - radius, cellMinZ - radius);
          this.cellMax.set(
            cellMinX + vs + radius,
            cellMinY + vs + radius,
            cellMinZ + vs + radius,
          );
          const hit = sweepAABB(from, to, this.cellMin, this.cellMax, this.result);
          if (!hit) continue;
          if (best && hit.t >= best.t) continue;
          const hardness = MATERIALS[grid.materialIdAt(cell)]?.hardness ?? 10;
          best = {
            t: hit.t,
            point: new Vector3(
              from.x + (to.x - from.x) * hit.t,
              from.y + (to.y - from.y) * hit.t,
              from.z + (to.z - from.z) * hit.t,
            ),
            normal: hit.normal.clone(),
            depth: hit.depth,
            destructible: true,
            resistance: Math.min(1, Math.max(0.05, hardness / this.resistanceScale)),
            voxelCenter: target.worldOf(cell, new Vector3()),
            voxelId: cell,
            node: target,
          };
        }
      }
    }
    return best;
  }
}
