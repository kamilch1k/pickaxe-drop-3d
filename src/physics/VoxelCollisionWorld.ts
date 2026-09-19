import { Vector3 } from 'three';
import { GRID_X, GRID_Y, GRID_Z } from '../destruction/builders';
import { MATERIALS } from '../content/materials';
import type { Target } from '../destruction/Target';
import type { CollisionWorld, SweepHit } from './PickaxeSimulator';

/**
 * The pickaxe simulator only ever asks one question - "what did this segment
 * cross?" - so the whole world can live behind this class. It answers from two
 * sources:
 *
 *   1. the arena deck (an analytic horizontal plane), and
 *   2. the live voxel grid of the current target, walked with a voxel DDA
 *      (Amanatides & Woo). Nothing is tested against meshes, so a pickaxe
 *      falling fast can never tunnel: the sweep is a genuine segment query.
 *
 * If the game ever swaps voxels for something else, only this file changes -
 * the same seam is what a Luau `workspace:Raycast` version would implement.
 */

export interface VoxelCollisionWorldOptions {
  /** top surface of the arena deck */
  groundY?: number;
  /** half extent of the deck in X/Z */
  groundHalf?: number;
  /** voxel hardness that maps to resistance 1 */
  resistanceScale?: number;
}

interface GridPoint {
  x: number;
  y: number;
  z: number;
}

export class VoxelCollisionWorld implements CollisionWorld {
  groundY: number;
  groundHalf: number;
  resistanceScale: number;

  private readonly startGrid: GridPoint = { x: 0, y: 0, z: 0 };
  private readonly endGrid: GridPoint = { x: 0, y: 0, z: 0 };

  constructor(
    private getTarget: () => Target | null,
    opts: VoxelCollisionWorldOptions = {},
  ) {
    this.groundY = opts.groundY ?? 0;
    this.groundHalf = opts.groundHalf ?? 16;
    this.resistanceScale = opts.resistanceScale ?? 100;
  }

  sweepSegment(start: Vector3, end: Vector3): SweepHit | null {
    let best = this.sweepGround(start, end);
    const voxel = this.sweepVoxels(start, end);
    // voxels win ties: the deck plane runs underneath the voxel floor, and a
    // buried probe must be pushed out of the block, not through the deck
    if (voxel && (!best || voxel.t <= best.t)) best = voxel;
    return best;
  }

  /**
   * Downward crossing of the arena deck plane, clipped to the deck extent. A
   * probe already at or below the deck also reports a contact (with the point
   * snapped to the surface) so a resting body is pushed out instead of slowly
   * sinking through the floor one substep at a time.
   */
  private sweepGround(start: Vector3, end: Vector3): SweepHit | null {
    const dy = end.y - start.y;
    let t: number;
    if (start.y > this.groundY) {
      if (dy >= 0) return null;
      t = (this.groundY - start.y) / dy;
      if (t < 0 || t > 1) return null;
    } else {
      // already inside/below the deck: only the sideways extent matters
      t = 0;
    }
    const px = start.x + (end.x - start.x) * t;
    const pz = start.z + (end.z - start.z) * t;
    if (Math.abs(px) > this.groundHalf || Math.abs(pz) > this.groundHalf) return null;
    return {
      t,
      point: new Vector3(px, this.groundY, pz),
      normal: new Vector3(0, 1, 0),
      destructible: false,
      resistance: 0,
      node: 'ground',
    };
  }

  /**
   * Voxel DDA between two world points. Returns the first solid voxel entered,
   * with the exact entry point, the outward face normal and the material's
   * hardness as `resistance`.
   */
  private sweepVoxels(start: Vector3, end: Vector3): SweepHit | null {
    const target = this.getTarget();
    if (!target) return null;
    const grid = target.grid;
    const vs = target.voxelSize;

    const s = this.startGrid;
    const e = this.endGrid;
    s.x = start.x / vs + GRID_X / 2 - 0.5;
    s.y = start.y / vs - 0.5;
    s.z = start.z / vs + GRID_Z / 2 - 0.5;
    e.x = end.x / vs + GRID_X / 2 - 0.5;
    e.y = end.y / vs - 0.5;
    e.z = end.z / vs + GRID_Z / 2 - 0.5;

    const dx = e.x - s.x;
    const dy = e.y - s.y;
    const dz = e.z - s.z;
    const len = Math.hypot(dx, dy, dz);
    // A degenerate segment (a resting body barely moves in a substep) is still a
    // valid query: it asks "is this point inside something right now?". Keeping
    // it means a body can never settle while buried in a block or the deck.
    const inv = len > 1e-9 ? 1 / len : 0;
    const dvx = dx * inv;
    const dvy = dy * inv;
    const dvz = dz * inv;

    let ix = Math.floor(s.x);
    let iy = Math.floor(s.y);
    let iz = Math.floor(s.z);
    const stepX = dvx > 0 ? 1 : -1;
    const stepY = dvy > 0 ? 1 : -1;
    const stepZ = dvz > 0 ? 1 : -1;
    const tDeltaX = Math.abs(1 / (dvx || 1e-9));
    const tDeltaY = Math.abs(1 / (dvy || 1e-9));
    const tDeltaZ = Math.abs(1 / (dvz || 1e-9));
    let tMaxX = dvx === 0 ? Infinity : (dvx > 0 ? ix + 1 - s.x : s.x - ix) * tDeltaX;
    let tMaxY = dvy === 0 ? Infinity : (dvy > 0 ? iy + 1 - s.y : s.y - iy) * tDeltaY;
    let tMaxZ = dvz === 0 ? Infinity : (dvz > 0 ? iz + 1 - s.z : s.z - iz) * tDeltaZ;

    let t = 0;
    let face = -1;
    for (let guard = 0; guard < 512 && t <= len; guard++) {
      if (ix >= 0 && iy >= 0 && iz >= 0 && ix < GRID_X && iy < GRID_Y && iz < GRID_Z) {
        const cell = grid.index(ix, iy, iz);
        if (grid.active[cell] === 1) {
          const hardness = MATERIALS[grid.materialIdAt(cell)]?.hardness ?? 10;
          const resistance = Math.min(1, Math.max(0.05, hardness / this.resistanceScale));
          const normal = new Vector3();
          if (face === 0) normal.set(-stepX, 0, 0);
          else if (face === 1) normal.set(0, -stepY, 0);
          else if (face === 2) normal.set(0, 0, -stepZ);
          else {
            // The sweep started inside a solid voxel: a crater exposed a
            // neighbour, or the body settled into the surface. Always eject
            // through the TOP face. Any other choice can drive a buried probe
            // deeper (or through the deck under the floor), and a buried probe
            // that is never pushed out keeps its velocity, tunnels and runs
            // away. Combined with the normal impulse this pops the pickaxe back
            // onto the surface, which is exactly what the player expects.
            const gy = s.y + dvy * t;
            const rise = (iy + 1 - gy) * vs;
            return {
              t: 0,
              point: new Vector3(start.x, start.y + Math.min(0.6 * vs, rise), start.z),
              normal: new Vector3(0, 1, 0),
              destructible: true,
              resistance,
              voxelCenter: target.worldOf(cell, new Vector3()),
              voxelId: cell,
              node: target,
            };
          }
          return {
            t: len > 1e-9 ? t / len : 0,
            point: new Vector3(
              (s.x + dvx * t - GRID_X / 2 + 0.5) * vs,
              (s.y + dvy * t + 0.5) * vs,
              (s.z + dvz * t - GRID_Z / 2 + 0.5) * vs,
            ),
            normal,
            destructible: true,
            resistance,
            voxelCenter: target.worldOf(cell, new Vector3()),
            voxelId: cell,
            node: target,
          };
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
}
