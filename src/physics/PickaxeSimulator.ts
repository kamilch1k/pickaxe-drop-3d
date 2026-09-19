import { Quaternion, Vector3, type Object3D } from 'three';

/**
 * PickaxeSimulator - a specialised planar solver for falling pickaxes.
 *
 * This is a port of the physics from the Pickaxe Drop Astra experiment
 * (kamilch1k/pickaxe-drop-astra, src/physics.js), rewired to this game's voxel
 * targets. The design in one sentence: a pickaxe is locked to a vertical
 * interaction plane (it only spins about the plane normal and stays inside a
 * thin depth corridor), and every collision is a swept sphere resolved at its
 * exact time of impact.
 *
 *   fall -> spin -> sweep -> impact -> bounce -> spin response
 *        -> break (rebound + hop out of the crater) -> sleep
 *
 * Everything is plain vector/quaternion maths so the same formulas can be
 * re-implemented in Luau later. The only Three.js types used here are math
 * classes; nothing in this file touches the renderer, the scene graph (beyond
 * writing the visual Object3D transform) or any physics engine. The file sticks
 * to erasable TypeScript syntax so `node --test` can run it directly.
 *
 * Collision querying lives behind the CollisionWorld interface.
 */

// ----------------------------------------------------------------- tuning ---

export interface PickaxeTuning {
  gravity: number;
  fixedDelta: number;
  mass: number;
  /** scalar inertia = mass * inertiaScale * toolScale^2 */
  inertiaScale: number;
  linearDrag: number;
  angularDrag: number;
  /** spawn tumble in radians/second; the sign is randomised per drop */
  initialSpinMin: number;
  initialSpinMax: number;
  headRestitution: number;
  handleRestitution: number;
  groundRestitution: number;
  friction: number;
  maxVelocity: number;
  maxAngularVelocity: number;
  /** radius of the collision spheres swept along the probes */
  probeRadius: number;
  /** half thickness of the depth corridor around the drop's plane */
  corridorHalfDepth: number;
  zVelocityDamping: number;
  zImpulseScale: number;
  breakRestitution: number;
  /** minimum upward speed after smashing a block, so it hops out of the crater */
  breakHopSpeed: number;
  breakVelocityLoss: number;
  sideBreakSpeed: number;
  sideScrapeMultiplier: number;
  sideChipMinDamage: number;
  sideChipMaxDamage: number;
  sideChipMinSpeed: number;
  sideChipCooldown: number;
  /** inward speed below which a head contact is not treated as a strike */
  minDamageSpeed: number;
  /** |contact speed| below which restitution is ignored (kills resting jitter) */
  restSpeed: number;
  sleepVelocityThreshold: number;
  sleepAngularThreshold: number;
  sleepTime: number;
  maxBodies: number;
  /** angular substep size: smaller = more accurate curved sweeps */
  maxSubstepAngle: number;
}

export const DEFAULT_PICKAXE_TUNING: PickaxeTuning = {
  gravity: 18,
  fixedDelta: 1 / 120,
  mass: 2,
  inertiaScale: 0.55,
  linearDrag: 0.035,
  angularDrag: 0.12,
  initialSpinMin: 1.4,
  initialSpinMax: 3.2,
  headRestitution: 0.48,
  handleRestitution: 0.65,
  groundRestitution: 0.16,
  friction: 0.55,
  maxVelocity: 90,
  maxAngularVelocity: 18,
  probeRadius: 0.06,
  corridorHalfDepth: 0.3,
  zVelocityDamping: 12,
  zImpulseScale: 0.12,
  breakRestitution: 0.55,
  breakHopSpeed: 6,
  breakVelocityLoss: 0.16,
  sideBreakSpeed: 3,
  sideScrapeMultiplier: 0.4,
  sideChipMinDamage: 6,
  sideChipMaxDamage: 18,
  sideChipMinSpeed: 1.2,
  sideChipCooldown: 0.15,
  minDamageSpeed: 0.5,
  restSpeed: 1,
  sleepVelocityThreshold: 0.18,
  sleepAngularThreshold: 0.55,
  sleepTime: 0.75,
  maxBodies: 80,
  maxSubstepAngle: 0.025,
};

// ---------------------------------------------------------------- probes -----

export type ProbeKind = 'head' | 'handle';

export interface CollisionProbe {
  name: string;
  kind: ProbeKind;
  /** local-space offset from the pickaxe origin, already scaled with the tool */
  local: Vector3;
}

// ---------------------------------------------------------------- world -----

export interface SweepHit {
  /** 0..1 along the swept segment */
  t: number;
  /** fresh Vector3 owned by this hit (never reused by the world) */
  point: Vector3;
  /** fresh Vector3 owned by this hit */
  normal: Vector3;
  /** penetration at the start point (0 for a clean entry contact) */
  depth: number;
  /** true when the hit belongs to the mineable voxel grid */
  destructible: boolean;
  /** 0..1; higher is tougher */
  resistance: number;
  /** world position of the block, so the game can carve it */
  voxelCenter?: Vector3;
  voxelId?: number;
  /** optional node behind the hit, e.g. a mesh or a part */
  node?: unknown;
}

/**
 * The only contact with the outside world: sweep a sphere along a segment.
 * A voxel grid, a block list, or `workspace:Spherecast` can all implement this
 * without the simulation ever knowing the difference.
 */
export interface CollisionWorld {
  sweepSphere(from: Vector3, to: Vector3, radius: number): SweepHit | null;
}

/** Reusable output for sweepAABB so the hot path does not allocate. */
export interface SweepResult {
  t: number;
  normal: Vector3;
  depth: number;
}

export function makeSweepResult(): SweepResult {
  return { t: 0, normal: new Vector3(), depth: 0 };
}

/**
 * Swept-sphere vs AABB: the box is grown by the sphere radius and the segment
 * is clipped against it (slab method). Returns the entry time, the outward
 * normal, and - when the segment starts inside - how deep it is.
 */
export function sweepAABB(
  a: Vector3,
  b: Vector3,
  min: Vector3,
  max: Vector3,
  out: SweepResult = makeSweepResult(),
): SweepResult | null {
  const inside =
    a.x >= min.x && a.x <= max.x && a.y >= min.y && a.y <= max.y && a.z >= min.z && a.z <= max.z;
  if (inside) {
    let depth = Infinity;
    let nx = 0;
    let ny = 0;
    let nz = 0;
    const dx = Math.min(a.x - min.x, max.x - a.x);
    const dy = Math.min(a.y - min.y, max.y - a.y);
    const dz = Math.min(a.z - min.z, max.z - a.z);
    if (dx <= dy && dx <= dz) {
      depth = dx;
      nx = a.x - min.x < max.x - a.x ? -1 : 1;
    } else if (dy <= dz) {
      depth = dy;
      ny = a.y - min.y < max.y - a.y ? -1 : 1;
    } else {
      depth = dz;
      nz = a.z - min.z < max.z - a.z ? -1 : 1;
    }
    out.t = 0;
    out.depth = depth;
    out.normal.set(nx, ny, nz);
    return out;
  }

  let enter = 0;
  let exit = 1;
  let nx = 0;
  let ny = 0;
  let nz = 0;

  // X slab
  const dxs = b.x - a.x;
  if (Math.abs(dxs) < 1e-10) {
    if (a.x < min.x || a.x > max.x) return null;
  } else {
    let t1 = (min.x - a.x) / dxs;
    let t2 = (max.x - a.x) / dxs;
    let sign = -1;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
      sign = 1;
    }
    if (t1 >= enter) {
      enter = t1;
      nx = sign;
      ny = 0;
      nz = 0;
    }
    if (t2 < exit) exit = t2;
    if (enter > exit) return null;
  }

  // Y slab
  const dys = b.y - a.y;
  if (Math.abs(dys) < 1e-10) {
    if (a.y < min.y || a.y > max.y) return null;
  } else {
    let t1 = (min.y - a.y) / dys;
    let t2 = (max.y - a.y) / dys;
    let sign = -1;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
      sign = 1;
    }
    if (t1 >= enter) {
      enter = t1;
      nx = 0;
      ny = sign;
      nz = 0;
    }
    if (t2 < exit) exit = t2;
    if (enter > exit) return null;
  }

  // Z slab
  const dzs = b.z - a.z;
  if (Math.abs(dzs) < 1e-10) {
    if (a.z < min.z || a.z > max.z) return null;
  } else {
    let t1 = (min.z - a.z) / dzs;
    let t2 = (max.z - a.z) / dzs;
    let sign = -1;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
      sign = 1;
    }
    if (t1 >= enter) {
      enter = t1;
      nx = 0;
      ny = 0;
      nz = sign;
    }
    if (t2 < exit) exit = t2;
    if (enter > exit) return null;
  }

  if (enter < 0 || enter > 1) return null;
  out.t = enter;
  out.depth = 0;
  out.normal.set(nx, ny, nz);
  return out;
}

// ----------------------------------------------------------------- events ---

export type ImpactQuality =
  | 'PERFECT_HEAD_HIT'
  | 'HEAD_HIT'
  | 'SIDE_HIT'
  | 'GLANCING_HIT'
  | 'HANDLE_HIT';

export interface ImpactEvent {
  body: PickaxeBody;
  quality: ImpactQuality;
  probe: string;
  probeKind: ProbeKind;
  point: Vector3;
  normal: Vector3;
  /** inward speed along the contact normal (m/s) */
  normalSpeed: number;
  /** 0.5 * mass * normalSpeed^2 */
  energy: number;
  /** true when the contact was a side-face scuff rather than a flat hit */
  side: boolean;
  destructible: boolean;
  resistance: number;
  destroyed: boolean;
  voxelCenter?: Vector3;
  voxelId?: number;
  node?: unknown;
  /** angular speed right after the response */
  spun: number;
}

export interface SimulatorHooks {
  onImpact?: (event: ImpactEvent) => void;
  onVoxelDamage?: (event: ImpactEvent) => void;
  /**
   * A damaging head contact. The game owns destruction: it carves its crater
   * and returns true when a block actually died, which triggers the rebound
   * and the hop out of the crater.
   */
  onVoxelDestroyed?: (event: ImpactEvent) => boolean | void;
  onPickaxeStop?: (body: PickaxeBody) => void;
}

// ------------------------------------------------------------------ body ---

export class PickaxeBody {
  position = new Vector3();
  velocity = new Vector3();
  orientation = new Quaternion();
  angularVelocity = new Vector3();

  previousPosition = new Vector3();
  previousOrientation = new Quaternion();

  /** interpolated transform the visual is drawn with */
  renderPosition = new Vector3();
  renderOrientation = new Quaternion();

  mass: number;
  inverseMass: number;
  inverseInertia: number;

  linearDrag: number;
  angularDrag: number;
  /** the vertical plane this pickaxe is locked to (its drop's z) */
  planeZ = 0;
  halfDepth: number;
  /** tool scale: drives inertia and the depth corridor */
  scale: number;

  active = true;
  sleeping = false;

  /** gameplay payload (drop id, tool def, ...) */
  userData: Record<string, unknown> = {};

  /** last contact, kept for instrumentation and the debug view */
  readonly lastContact = {
    probe: '',
    normal: new Vector3(),
    point: new Vector3(),
    kind: 'head' as ProbeKind,
    destructible: false,
    normalSpeed: 0,
    time: -1,
  };

  private stillTime = 0;
  private readonly beforePoints: Vector3[] = [];
  private readonly afterPoints: Vector3[] = [];
  private readonly sideDamageTimes = new Map<number, number>();
  /** visual is only ever written, never read: the mesh is not the physics */
  readonly visual: Object3D;
  readonly probes: CollisionProbe[];

  constructor(visual: Object3D, probes: CollisionProbe[], tuning: PickaxeTuning, scale = 1) {
    this.visual = visual;
    this.probes = probes;
    this.mass = tuning.mass;
    this.inverseMass = 1 / tuning.mass;
    this.scale = scale;
    this.inverseInertia = 1 / (tuning.mass * tuning.inertiaScale * scale * scale);
    this.linearDrag = tuning.linearDrag;
    this.angularDrag = tuning.angularDrag;
    this.halfDepth = tuning.corridorHalfDepth * Math.max(0.6, scale / 0.9);
    for (let i = 0; i < probes.length; i += 1) {
      this.beforePoints.push(new Vector3());
      this.afterPoints.push(new Vector3());
    }
  }

  /** world-space probe positions for the current transform (into a scratch) */
  points(out: Vector3[]): Vector3[] {
    for (let i = 0; i < this.probes.length; i += 1) {
      out[i].copy(this.probes[i].local).applyQuaternion(this.orientation).add(this.position);
    }
    return out;
  }

  before(): Vector3[] {
    return this.beforePoints;
  }

  after(): Vector3[] {
    return this.afterPoints;
  }

  /** local head axis in world space: the +Y shaft direction */
  headDirection(out: Vector3): Vector3 {
    return out.set(0, 1, 0).applyQuaternion(this.orientation).normalize();
  }

  sideCooldown(blockId: number, time: number): boolean {
    const until = this.sideDamageTimes.get(blockId) ?? -Infinity;
    return time >= until;
  }

  markSideDamage(blockId: number, until: number): void {
    this.sideDamageTimes.set(blockId, until);
  }

  wake(): void {
    this.sleeping = false;
    this.active = true;
    this.stillTime = 0;
  }

  addStill(delta: number, supported: boolean, tuning: PickaxeTuning): boolean {
    const slow =
      this.velocity.length() < tuning.sleepVelocityThreshold &&
      this.angularVelocity.length() < tuning.sleepAngularThreshold;
    this.stillTime = supported && slow ? this.stillTime + delta : 0;
    return this.stillTime > tuning.sleepTime;
  }
}

// ------------------------------------------------------------ planar lock ---

/** Rotation is restricted to the interaction plane, whatever else happens. */
export function enforcePlanarRotation(body: PickaxeBody): void {
  body.angularVelocity.x = 0;
  body.angularVelocity.y = 0;
  const q = body.orientation;
  const length = Math.hypot(q.z, q.w);
  if (length > 1e-10) q.set(0, 0, q.z / length, q.w / length);
  else q.identity();
}

/** The depth lane constrains centre-of-mass translation. */
export function enforceZConstraint(body: PickaxeBody): void {
  const min = body.planeZ - body.halfDepth;
  const max = body.planeZ + body.halfDepth;
  body.position.z = Math.max(min, Math.min(max, body.position.z));
  if ((body.position.z <= min && body.velocity.z < 0) || (body.position.z >= max && body.velocity.z > 0)) {
    body.velocity.z = 0;
  }
}

export function applyImpulse(
  body: PickaxeBody,
  r: Vector3,
  impulse: Vector3,
  tuning: PickaxeTuning,
): void {
  body.velocity.x += impulse.x * body.inverseMass;
  body.velocity.y += impulse.y * body.inverseMass;
  body.velocity.z += impulse.z * body.inverseMass * tuning.zImpulseScale;
  // cap the resulting depth speed to the distance left in one fixed step
  const min = body.planeZ - body.halfDepth;
  const max = body.planeZ + body.halfDepth;
  body.velocity.z = Math.max(
    (min - body.position.z) / tuning.fixedDelta,
    Math.min((max - body.position.z) / tuning.fixedDelta, body.velocity.z),
  );
  body.angularVelocity.z += (r.x * impulse.y - r.y * impulse.x) * body.inverseInertia;
  enforcePlanarRotation(body);
}

export function effectiveInverseMass(
  body: PickaxeBody,
  direction: Vector3,
  tuning: PickaxeTuning,
): number {
  return (
    body.inverseMass *
    (direction.x * direction.x +
      direction.y * direction.y +
      tuning.zImpulseScale * direction.z * direction.z)
  );
}

// ------------------------------------------------------------ simulator ----

interface Contact {
  point: Vector3;
  normal: Vector3;
  kind: ProbeKind;
}

export class PickaxeSimulator {
  private accumulator = 0;
  private time = 0;
  private readonly bodies: PickaxeBody[] = [];
  private readonly oldPosition = new Vector3();
  private readonly spinAxis = new Vector3();
  private readonly r = new Vector3();
  private readonly contactVelocity = new Vector3();
  private readonly impulse = new Vector3();
  private readonly probePoint = new Vector3();
  private readonly headScratch = new Vector3();
  private readonly normalScratch = new Vector3();
  private readonly oldOrientation = new Quaternion();
  private readonly spinDelta = new Quaternion();
  private readonly world: CollisionWorld;
  readonly tuning: PickaxeTuning;
  private readonly hooks: SimulatorHooks;

  readonly stats = { head: 0, handle: 0, handleContacts: 0, broken: 0 };

  constructor(world: CollisionWorld, tuning: PickaxeTuning, hooks: SimulatorHooks = {}) {
    this.world = world;
    this.tuning = tuning;
    this.hooks = hooks;
  }

  /** debug snapshot for the visualiser: only filled while `enabled` */
  readonly debug = {
    enabled: false,
    sweepLines: [] as Vector3[],
    normals: [] as Vector3[],
    contacts: [] as Contact[],
    byKind: {} as Record<string, number>,
    qualities: {} as Record<string, number>,
    firstKinds: {} as Record<string, number>,
    lastQuality: '' as ImpactQuality | '',
    lastPoint: new Vector3(),
    lastNormal: new Vector3(),
  };

  debugReset(): void {
    this.debug.byKind = {};
    this.debug.qualities = {};
    this.debug.firstKinds = {};
    this.stats.head = 0;
    this.stats.handle = 0;
    this.stats.handleContacts = 0;
    this.stats.broken = 0;
  }

  add(body: PickaxeBody): boolean {
    if (this.bodies.length >= this.tuning.maxBodies) {
      const index = this.bodies.findIndex((b) => b.sleeping);
      if (index < 0) return false;
      const old = this.bodies[index];
      this.bodies.splice(index, 1);
      old.visual.removeFromParent();
    }
    enforceZConstraint(body);
    enforcePlanarRotation(body);
    body.previousPosition.copy(body.position);
    body.previousOrientation.copy(body.orientation);
    body.renderPosition.copy(body.position);
    body.renderOrientation.copy(body.orientation);
    this.bodies.push(body);
    return true;
  }

  remove(body: PickaxeBody): void {
    const i = this.bodies.indexOf(body);
    if (i >= 0) this.bodies.splice(i, 1);
  }

  get all(): readonly PickaxeBody[] {
    return this.bodies;
  }

  /** Fixed timestep with an accumulator, then interpolate the visuals. */
  update(delta: number): void {
    this.accumulator += Math.min(delta, 0.1);
    const dt = this.tuning.fixedDelta;
    let guard = 0;
    while (this.accumulator >= dt && guard < 16) {
      this.step(dt);
      this.accumulator -= dt;
      guard += 1;
    }
    if (guard >= 16) this.accumulator = 0;
    const alpha = this.accumulator / dt;
    for (const body of this.bodies) this.syncVisual(body, alpha);
  }

  syncVisual(body: PickaxeBody, alpha = 1): void {
    body.renderPosition.lerpVectors(body.previousPosition, body.position, alpha);
    body.renderOrientation.slerpQuaternions(body.previousOrientation, body.orientation, alpha);
    body.visual.position.copy(body.renderPosition);
    body.visual.quaternion.copy(body.renderOrientation);
  }

  step(dt: number): void {
    this.time += dt;
    const tuning = this.tuning;
    if (this.debug.enabled) {
      this.debug.sweepLines.length = 0;
      this.debug.normals.length = 0;
      this.debug.contacts.length = 0;
    }

    for (const body of this.bodies) {
      enforcePlanarRotation(body);
      body.previousPosition.copy(body.position);
      body.previousOrientation.copy(body.orientation);
      if (!body.active) continue;

      body.velocity.y -= tuning.gravity * dt;
      body.velocity.z *= Math.exp(-tuning.zVelocityDamping * dt);
      body.velocity.multiplyScalar(Math.exp(-body.linearDrag * dt));
      body.angularVelocity.multiplyScalar(Math.exp(-body.angularDrag * dt));
      body.velocity.clampLength(0, tuning.maxVelocity);
      body.angularVelocity.clampLength(0, tuning.maxAngularVelocity);

      // Angular substeps keep curved probe trajectories close to segments.
      const spin = body.angularVelocity.length();
      const count = Math.max(2, Math.ceil((spin * dt) / tuning.maxSubstepAngle));
      let supported = false;

      for (let s = 0; s < count; s += 1) {
        let remaining = dt / count;
        for (let iteration = 0; iteration < 16 && remaining > 1e-7; iteration += 1) {
          this.oldPosition.copy(body.position);
          this.oldOrientation.copy(body.orientation);
          const before = body.points(body.before());

          body.position.addScaledVector(body.velocity, remaining);
          enforceZConstraint(body);
          const speed = body.angularVelocity.length();
          if (speed > 1e-9) {
            this.spinAxis.copy(body.angularVelocity).divideScalar(speed);
            this.spinDelta.setFromAxisAngle(this.spinAxis, speed * remaining);
            body.orientation.premultiply(this.spinDelta).normalize();
          }
          const after = body.points(body.after());

          let first: SweepHit | null = null;
          let firstIndex = -1;
          for (let i = 0; i < before.length; i += 1) {
            if (this.debug.enabled) {
              this.debug.sweepLines.push(before[i].clone(), after[i].clone());
            }
            const hit = this.world.sweepSphere(before[i], after[i], tuning.probeRadius);
            if (hit && (!first || hit.t < first.t)) {
              first = hit;
              firstIndex = i;
            }
          }
          if (!first) break;

          // rewind to the exact time of impact
          body.position.lerpVectors(this.oldPosition, body.position, first.t);
          body.orientation.slerpQuaternions(this.oldOrientation, body.orientation, first.t);

          const probe = body.probes[firstIndex];
          const point = this.probePoint
            .copy(probe.local)
            .applyQuaternion(body.orientation)
            .add(body.position);
          this.r.copy(point).sub(body.position);
          const n = first.normal;
          this.contactVelocity.copy(body.angularVelocity).cross(this.r).add(body.velocity);
          const vn = this.contactVelocity.dot(n);
          const normalSpeed = Math.max(0, -vn);
          supported = supported || n.y > 0.5;

          if (this.debug.enabled) {
            this.debug.contacts.push({ point: point.clone(), normal: n.clone(), kind: probe.kind });
          }
          body.lastContact.probe = probe.name;
          body.lastContact.normal.copy(n);
          body.lastContact.point.copy(point);
          body.lastContact.kind = probe.kind;
          body.lastContact.destructible = first.destructible;
          body.lastContact.normalSpeed = normalSpeed;
          body.lastContact.time = this.time;

          let broken = false;
          if (first.destructible) {
            broken = this.resolveVoxelContact(body, probe, first, point, n, vn, normalSpeed);
          } else if (normalSpeed > 1.2) {
            this.hooks.onImpact?.(this.buildEvent(body, probe, first, point, n, normalSpeed, false));
          }

          if (broken) {
            this.stats.broken += 1;
            // A destroyed block kicks the pickaxe back out of the newly opened
            // cell: rebound along the normal, then a guaranteed upward hop, so
            // the tool never drills down its own crater.
            const denom =
              effectiveInverseMass(body, n, tuning) +
              body.inverseInertia * (this.r.x * n.y - this.r.y * n.x) ** 2;
            if (vn < 0 && denom > 1e-9) {
              this.impulse
                .copy(n)
                .multiplyScalar(-((1 + tuning.breakRestitution) * vn) / denom);
              applyImpulse(body, this.r, this.impulse, tuning);
            }
            body.velocity.x *= 1 - tuning.breakVelocityLoss;
            if (Math.abs(n.x) > 0.5 && body.velocity.x * n.x < tuning.sideBreakSpeed) {
              this.impulse.set(
                n.x * (tuning.sideBreakSpeed - body.velocity.x * n.x) * body.mass,
                0,
                0,
              );
              applyImpulse(body, this.r, this.impulse, tuning);
            }
            if (body.velocity.y < tuning.breakHopSpeed) {
              this.impulse.set(0, (tuning.breakHopSpeed - body.velocity.y) * body.mass, 0);
              applyImpulse(body, this.r, this.impulse, tuning);
            }
            body.position.addScaledVector(n, 0.002);
          } else {
            body.position.addScaledVector(n, first.depth + 0.001);
            if (vn < 0) {
              const restitution =
                normalSpeed < tuning.restSpeed
                  ? 0
                  : !first.destructible
                    ? tuning.groundRestitution
                    : probe.kind === 'head'
                      ? tuning.headRestitution
                      : tuning.handleRestitution;
              const denom =
                effectiveInverseMass(body, n, tuning) +
                body.inverseInertia * (this.r.x * n.y - this.r.y * n.x) ** 2;
              if (denom > 1e-9) {
                const j = (-(1 + restitution) * vn) / denom;
                this.impulse.copy(n).multiplyScalar(j);
                applyImpulse(body, this.r, this.impulse, tuning);
                const tangent = this.impulse.copy(this.contactVelocity).addScaledVector(n, -vn);
                if (tangent.lengthSq() > 1e-10) {
                  const speedT = tangent.length();
                  tangent.divideScalar(speedT);
                  const jt = Math.min(
                    tuning.friction * j,
                    speedT /
                      (effectiveInverseMass(body, tangent, tuning) +
                        body.inverseInertia * (this.r.x * tangent.y - this.r.y * tangent.x) ** 2),
                  );
                  tangent.multiplyScalar(-jt);
                  applyImpulse(body, this.r, tangent, tuning);
                }
              }
            }
          }

          enforceZConstraint(body);
          remaining *= 1 - first.t;
          if (first.t < 1e-5) remaining = Math.max(0, remaining - 1e-5);
          body.velocity.clampLength(0, tuning.maxVelocity);
          body.angularVelocity.clampLength(0, tuning.maxAngularVelocity);
        }
      }

      if (body.addStill(dt, supported, tuning)) {
        body.sleeping = true;
        body.active = false;
        body.velocity.set(0, 0, 0);
        body.angularVelocity.set(0, 0, 0);
        this.hooks.onPickaxeStop?.(body);
      }
    }
  }

  /**
   * Head contacts mine (a flat hit) or chip (a side scuff); handle contacts
   * never damage. The game carves the crater and tells us whether a block died.
   */
  private resolveVoxelContact(
    body: PickaxeBody,
    probe: CollisionProbe,
    hit: SweepHit,
    point: Vector3,
    n: Vector3,
    vn: number,
    normalSpeed: number,
  ): boolean {
    const tuning = this.tuning;
    const head = probe.kind === 'head';
    const sideHead = head && Math.abs(n.x) > 0.5;
    let damaging = false;
    let energy = 0.5 * body.mass * normalSpeed * normalSpeed;

    if (head) {
      if (sideHead) {
        const tangentSq = Math.max(0, this.contactVelocity.lengthSq() - vn * vn);
        const cuttingSq = normalSpeed * normalSpeed + tuning.sideScrapeMultiplier * tangentSq;
        const blockId = hit.voxelId ?? -1;
        damaging =
          cuttingSq > tuning.sideChipMinSpeed * tuning.sideChipMinSpeed &&
          body.sideCooldown(blockId, this.time);
        energy = Math.min(
          tuning.sideChipMaxDamage,
          Math.max(tuning.sideChipMinDamage, 0.5 * body.mass * cuttingSq),
        );
        if (damaging) body.markSideDamage(blockId, this.time + tuning.sideChipCooldown);
      } else {
        damaging = normalSpeed > tuning.minDamageSpeed;
      }
    } else {
      this.stats.handleContacts += 1;
    }

    const quality = damaging
      ? this.classifyImpact(body, probe, n, normalSpeed, sideHead)
      : 'GLANCING_HIT';
    const event = this.buildEvent(body, probe, hit, point, n, normalSpeed, sideHead, energy, quality);
    this.debug.lastQuality = damaging ? quality : '';
    this.debug.lastPoint.copy(point);
    this.debug.lastNormal.copy(n);

    if (this.debug.enabled && damaging) {
      this.debug.byKind[probe.kind] = (this.debug.byKind[probe.kind] ?? 0) + 1;
      this.debug.qualities[quality] = (this.debug.qualities[quality] ?? 0) + 1;
      if (body.userData.firstVoxel !== true) {
        body.userData.firstVoxel = true;
        this.debug.firstKinds[probe.kind] = (this.debug.firstKinds[probe.kind] ?? 0) + 1;
      }
    }

    if (!damaging) {
      if (normalSpeed > 1.2) this.hooks.onImpact?.(event);
      return false;
    }
    if (probe.kind === 'handle') this.stats.handle += 1;
    else this.stats.head += 1;
    this.hooks.onImpact?.(event);
    this.hooks.onVoxelDamage?.(event);
    const destroyed = this.hooks.onVoxelDestroyed?.(event);
    event.destroyed = destroyed === true;
    return event.destroyed;
  }

  private buildEvent(
    body: PickaxeBody,
    probe: CollisionProbe,
    hit: SweepHit,
    point: Vector3,
    n: Vector3,
    normalSpeed: number,
    side: boolean,
    energy = 0.5 * body.mass * normalSpeed * normalSpeed,
    quality: ImpactQuality = 'GLANCING_HIT',
  ): ImpactEvent {
    return {
      body,
      quality,
      probe: probe.name,
      probeKind: probe.kind,
      point: point.clone(),
      normal: n.clone(),
      normalSpeed,
      energy,
      side,
      destructible: hit.destructible,
      resistance: hit.resistance,
      destroyed: false,
      voxelCenter: hit.voxelCenter?.clone(),
      voxelId: hit.voxelId,
      node: hit.node,
      spun: body.angularVelocity.length(),
    };
  }

  private classifyImpact(
    body: PickaxeBody,
    probe: CollisionProbe,
    normal: Vector3,
    normalSpeed: number,
    side: boolean,
  ): ImpactQuality {
    if (side) return 'SIDE_HIT';
    if (probe.kind === 'handle') return 'HANDLE_HIT';
    const head = body.headDirection(this.headScratch);
    const alignment = head.dot(this.normalScratch.copy(normal).negate());
    const spin = body.angularVelocity.length();
    if (alignment > 0.9 && normalSpeed > 8) return 'PERFECT_HEAD_HIT';
    if (alignment > 0.5) return 'HEAD_HIT';
    return spin > 4 ? 'SIDE_HIT' : 'GLANCING_HIT';
  }
}
