import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld, OwnerKind } from '../physics/PhysicsWorld';
import type { Target } from '../destruction/Target';
import { TOOL_BY_ID, type ToolDef } from '../content/tools';
import { buildTool, type BuiltTool } from './ToolFactory';
import type { DamageResult } from '../destruction/VoxelGrid';
import type { FxManager } from '../effects/FxManager';
import type { DebrisSystem } from './DebrisSystem';
import type { CameraDirector } from '../scene/CameraDirector';
import type { AudioSystem } from '../audio/AudioSystem';
import type { Progression } from '../progression/Progression';
import { MATERIAL_IDS, MATERIALS } from '../content/materials';
import { clamp } from '../utils/math';
import { rand } from '../utils/rng';
import {
  DEFAULT_PICKAXE_TUNING,
  PickaxeBody,
  PickaxeSimulator,
  type ImpactEvent,
  type ImpactQuality,
  type PickaxeTuning,
} from '../physics/PickaxeSimulator';
import { VoxelCollisionWorld } from '../physics/VoxelCollisionWorld';

export interface ImpactReport {
  position: THREE.Vector3;
  voxels: number;
  coins: number;
  radius: number;
  power: number;
  material: number;
  crit: boolean;
  tool: ToolDef;
}

export interface DropContext {
  scene: THREE.Scene;
  physics: PhysicsWorld;
  fx: FxManager;
  debris: DebrisSystem;
  camera: CameraDirector;
  audio: AudioSystem;
  progression: Progression;
  getTarget(): Target | null;
  onImpact(report: ImpactReport): void;
  onGroundHit(def: ToolDef, speed: number, pos: THREE.Vector3): void;
  /** half extent of the arena deck, for the hand-written collision world */
  groundHalf: number;
}

export interface ActiveDrop {
  def: ToolDef;
  built: BuiltTool;
  /** physics engine body - only used by tools that still run on Rapier */
  body: RAPIER.RigidBody | null;
  /** hand-written solver body - every pickaxe uses this instead of Rapier */
  sim: PickaxeBody | null;
  hasHit: boolean;
  groundHits: number;
  handleHits: number;
  state: 'falling' | 'channel' | 'done';
  life: number;
  channelLeft: number;
  channelTick: number;
  stuck: boolean;
  fade: number;
  tipWorld: THREE.Vector3;
  prevTipWorld: THREE.Vector3;
  impactPos: THREE.Vector3;
  prevVel: THREE.Vector3;
  /** destruction radius in blocks, already scaled by upgrades */
  radiusBlocks: number;
  /** stable id for QA instrumentation */
  id: number;
  /** seconds until this drop may mine again (stops multi-collider double bites) */
  mineCooldown: number;
  /** seconds until a stuck/resting pickaxe fades away */
  restTimer: number;
}

interface PendingSpawn {
  def: ToolDef;
  x: number;
  z: number;
  y: number;
  delay: number;
}

interface Cascade {
  pos: THREE.Vector3;
  radius: number;
  damage: number;
  tool: ToolDef;
  timer: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);
const TMP = new THREE.Vector3();
const QUAT = new THREE.Quaternion();
const QUAT2 = new THREE.Quaternion();
/** the interaction plane's normal: planar engine tools spin about this axis */
const FORWARD = new THREE.Vector3(0, 0, 1);
const STONE_IDX = MATERIAL_IDS.indexOf('stone');
/** Minimum arrival speed for a pickaxe head to bite into blocks (m/s). */
const MIN_MINE_SPEED = 3.2;
/**
 * How strongly planar tools squash their crater along the plane normal. The
 * blade is only ~a third of a block thick, so a spherical crater would carve
 * blocks in front of and behind it that the tool never touched.
 */
const PLANE_FLATTEN = 2.6;

/**
 * Pickaxe-kind tools are driven by the hand-written `PickaxeSimulator` and never
 * touch Rapier. Everything else (anvils, bombs, saws, drills, boulders,
 * meteors) keeps the engine path it was tuned with.
 */
function usesSolver(def: ToolDef): boolean {
  return def.kind === 'pickaxe';
}

/** Fraction of the tool's damage a side-face scuff is worth. */
const SIDE_CHIP_DAMAGE = 0.3;
const PERFECT: ImpactQuality = 'PERFECT_HEAD_HIT';
/** How long a stopped pickaxe stays in the arena before it fades. */
const STOP_LINGER = 1.8;

export class DropSystem {
  private drops: ActiveDrop[] = [];
  private pending: PendingSpawn[] = [];
  private cascades: Cascade[] = [];
  private cooldowns = new Map<string, number>();
  private nextDropId = 1;
  totalDrops = 0;
  readonly stats = { spawned: 0, targetHits: 0, groundHits: 0, denied: 0, voxels: 0 };

  /** live tuning dials for the hand-written pickaxe solver */
  readonly tuning: PickaxeTuning = { ...DEFAULT_PICKAXE_TUNING };
  private readonly sim: PickaxeSimulator;
  /** dev hook: called for every solver impact so the debug view can label it */
  debugImpactText: ((event: ImpactEvent) => void) | null = null;

  constructor(private ctx: DropContext) {
    this.sim = new PickaxeSimulator(
      new VoxelCollisionWorld(() => this.ctx.getTarget(), {
        groundY: 0,
        groundHalf: ctx.groundHalf,
      }),
      this.tuning,
      {
        onImpact: (event) => this.onSimImpact(event),
        onVoxelDamage: (event) => this.onSimVoxelDamage(event),
        onVoxelDestroyed: (event) => this.onSimVoxelDestroyed(event),
        onPickaxeStop: (body) => this.onSimStop(body),
      },
    );
  }

  /* ---------------------------------------------------------------- spawn */

  cool(id: string): number {
    return this.cooldowns.get(id) ?? 0;
  }

  canDrop(def: ToolDef): boolean {
    return this.cool(def.id) <= 0;
  }

  requestDrop(def: ToolDef, point: THREE.Vector3): boolean {
    if (!this.canDrop(def)) {
      this.stats.denied++;
      return false;
    }
    this.cooldowns.set(def.id, def.cooldown);
    const height = point.y + def.spawnHeight * this.ctx.progression.heightMul;
    this.totalDrops++;
    this.ctx.progression.noteDrop();

    if (def.payload) {
      const child = TOOL_BY_ID[def.payload.tool] ?? def;
      const count = def.payload.count;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + rand(0, 1);
        const d = Math.sqrt(rand(0.05, 1)) * def.payload.spread;
        this.pending.push({
          def: child,
          x: point.x + Math.cos(a) * d,
          z: point.z + Math.sin(a) * d,
          y: height,
          delay: i * 0.05 + rand(0, 0.06),
        });
      }
      this.ctx.audio.whoosh(2.2);
      this.ctx.camera.addShake(0.18);
      return true;
    }

    this.spawnOne(
      def,
      point.x + rand(-def.spread, def.spread),
      point.z + rand(-def.spread, def.spread),
      height,
    );

    if (Math.random() < this.ctx.progression.multiChance) {
      const off = 1.2 + rand(0, 1.5);
      const a = rand(0, Math.PI * 2);
      this.pending.push({
        def,
        x: point.x + Math.cos(a) * off,
        z: point.z + Math.sin(a) * off,
        y: height,
        delay: rand(0.07, 0.2),
      });
    }
    return true;
  }

  private spawnOne(def: ToolDef, x: number, z: number, height: number): void {
    this.stats.spawned++;
    const { physics, scene } = this.ctx;
    // solver-driven pickaxes are built without any engine shapes at all
    const built = buildTool(def, usesSolver(def) ? undefined : physics.RAPIER);
    const y = height + rand(-0.3, 0.6);
    built.group.position.set(x, y, z);

    // Spawn orientation. Solver-driven pickaxes live in the vertical plane they
    // were aimed at: the blade always faces the camera and only spins about Z.
    // Released a little past head-down with a slow tumble, like Astra.
    const q = QUAT;
    if (usesSolver(def)) {
      q.setFromAxisAngle(FORWARD, Math.PI + 0.45 + rand(-0.9, 0.9));
    } else {
      const mode = def.spinMode;
      if (mode === 'planar') {
        q.setFromAxisAngle(FORWARD, rand(0, Math.PI * 2));
      } else if (mode === 'axial') {
        q.setFromAxisAngle(UP, rand(0, Math.PI * 2));
      } else {
        q.setFromAxisAngle(UP, rand(0, Math.PI * 2));
        if (def.kind === 'projectile') {
          QUAT2.setFromAxisAngle(RIGHT, rand(-0.6, 0.6));
          q.multiply(QUAT2);
        } else {
          QUAT2.setFromAxisAngle(
            new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)).normalize(),
            rand(0.2, 0.8),
          );
          q.multiply(QUAT2);
        }
      }
    }
    q.normalize();
    built.group.quaternion.copy(q);
    scene.add(built.group);

    const tip = built.tip.clone().applyQuaternion(q).add(built.group.position);

    const drop: ActiveDrop = {
      def,
      built,
      body: null,
      sim: null,
      hasHit: false,
      groundHits: 0,
      handleHits: 0,
      state: 'falling',
      life: 0,
      channelLeft: 0,
      channelTick: 0,
      stuck: false,
      fade: 0,
      tipWorld: tip.clone(),
      prevTipWorld: tip.clone(),
      impactPos: tip.clone(),
      prevVel: new THREE.Vector3(0, -2.5, 0),
      radiusBlocks: def.radiusBlocks * this.ctx.progression.radiusMul,
      id: this.nextDropId++,
      mineCooldown: 0,
      restTimer: 0,
    };

    if (usesSolver(def)) {
      this.spawnSolverBody(drop, def, built, x, y, z, q);
    } else {
      this.spawnEngineBody(drop, def, built, x, y, z, q);
    }

    this.drops.push(drop);
    this.ctx.audio.whoosh(def.kind === 'projectile' ? 1.4 : 1);
  }

  /**
   * Hand-written solver path. No Rapier body, no colliders: the pickaxe is a
   * `PickaxeBody` locked to its drop plane, and the mesh is purely a visual
   * transform the solver writes (with interpolation between fixed steps).
   */
  private spawnSolverBody(
    drop: ActiveDrop,
    def: ToolDef,
    built: BuiltTool,
    x: number,
    y: number,
    z: number,
    q: THREE.Quaternion,
  ): void {
    const body = new PickaxeBody(built.group, built.probes, this.tuning, def.scale);
    body.position.set(x, y, z);
    body.planeZ = z;
    body.orientation.copy(q).normalize();
    body.velocity.set(rand(-0.5, 0.5), 0, 0);
    body.linearDrag = def.linearDamping;
    body.angularDrag = def.angularDamping;
    body.userData.drop = drop;

    // Slow end-over-end tumble; the sign varies so drops do not mirror each other.
    const spin =
      rand(this.tuning.initialSpinMin, this.tuning.initialSpinMax) *
      (Math.random() < 0.5 ? 1 : -1);
    body.angularVelocity.set(0, 0, spin);

    drop.sim = body;
    this.sim.add(body);
  }

  /** Engine path, kept for the non-pickaxe tools that were tuned on it. */
  private spawnEngineBody(
    drop: ActiveDrop,
    def: ToolDef,
    built: BuiltTool,
    x: number,
    y: number,
    z: number,
    q: THREE.Quaternion,
  ): void {
    const physics = this.ctx.physics;
    const mode = def.spinMode;
    // 2D-in-3D rigid body: X/Y translation plus rotation about Z only. These
    // are real Rapier degree-of-freedom constraints, so the solver itself can
    // never accumulate depth velocity or off-plane spin.
    const bodyDesc = physics.RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setLinearDamping(def.linearDamping)
      .setAngularDamping(def.angularDamping)
      .setGravityScale(def.gravityScale)
      .setCcdEnabled(def.ccd === true)
      .enabledTranslations(true, true, false);
    const body = physics.world.createRigidBody(bodyDesc);
    if (mode === 'planar') {
      body.setEnabledRotations(false, false, true, true);
    } else if (mode === 'axial') {
      body.setEnabledRotations(false, true, false, true);
    }
    drop.body = body;

    const spin = def.spin * rand(0.75, 1.25) * (rand(0, 1) < 0.5 ? 1 : -1);
    if (mode === 'planar') {
      body.setAngvel({ x: 0, y: 0, z: spin }, true);
    } else if (mode === 'axial') {
      body.setAngvel({ x: 0, y: spin, z: 0 }, true);
    } else {
      const handleDir = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      const tumble = new THREE.Vector3().crossVectors(
        handleDir,
        new THREE.Vector3(rand(-1, 1), rand(-0.2, 0.2), rand(-1, 1)),
      );
      if (tumble.lengthSq() < 1e-4) tumble.set(1, 0, 0);
      tumble.normalize();
      body.setAngvel(
        { x: tumble.x * spin, y: tumble.y * spin * 0.35, z: tumble.z * spin },
        true,
      );
    }

    // Spawn velocity: a touch of horizontal drift for the pickaxes, downward
    // always, and never any depth component.
    const lateral = mode === 'planar' ? rand(-0.5, 0.5) : 0;
    body.setLinvel({ x: lateral, y: -2.5, z: 0 }, true);

    built.colliders.forEach((c, i) => {
      const col = physics.world.createCollider(c, body);
      physics.registerCollider(col.handle, {
        kind: 'tool',
        ref: drop,
        part: built.parts[i] ?? 'head',
      });
    });
  }


  /* ------------------------------------------------------------- collision */

  /** Called by the game loop when one of our colliders touches something. */
  handleContact(
    ref: unknown,
    other: OwnerKind,
    part: 'head' | 'handle' = 'head',
    h1 = 0,
    h2 = 0,
  ): void {
    const drop = ref as ActiveDrop | null;
    if (!drop || !drop.body || drop.state === 'done') return;
    if (other === 'target') {
      // Only the hard metal head bites into blocks, and only when it arrives
      // with real speed. A wooden handle strike never mines.
      if (part === 'handle') this.clang(drop);
      else this.impactOnTarget(drop, h1, h2);
    } else if (other === 'ground') {
      this.impactOnGround(drop);
    }
  }

  /* ------------------------------------------------- hand-written solver --- */

  /** Solver impact: juice, surface feedback and (for heads) mining. */
  private onSimImpact(event: ImpactEvent): void {
    const drop = event.body.userData.drop as ActiveDrop | undefined;
    if (!drop || drop.state === 'done') return;
    this.debugImpactText?.(event);

    if (!event.destructible) {
      if (event.normalSpeed > 2) this.impactOnGround(drop, event.point, event.normalSpeed);
      return;
    }

    const target = this.ctx.getTarget();
    const matIdx = target && event.voxelId !== undefined ? target.grid.mat[event.voxelId] : STONE_IDX;
    const mat = MATERIALS[MATERIAL_IDS[matIdx]] ?? MATERIALS.stone;
    if (event.normalSpeed < 1.2) return;
    if (event.probeKind === 'handle') drop.handleHits++;

    const power = clamp(event.normalSpeed / 26, 0.15, 1.3);
    this.ctx.audio.impact(event.probeKind === 'handle' ? 'cloth' : mat.fx, power * 0.85);
    this.ctx.fx.voxelBurst(event.point.x, event.point.y, event.point.z, matIdx, 0.5 + power * 0.5, 0.9);
    this.ctx.camera.addShake(power * (event.probeKind === 'head' ? 0.3 : 0.12));
  }

  /** A contact that scuffs but does not bite: dust and a soft tick. */
  private onSimVoxelDamage(event: ImpactEvent): void {
    const drop = event.body.userData.drop as ActiveDrop | undefined;
    if (!drop || drop.state === 'done' || event.normalSpeed < 1.5) return;
    if (!event.side) return;
    this.ctx.audio.impact('stone', 0.22);
    this.ctx.fx.sparks.emit({
      x: event.point.x,
      y: event.point.y,
      z: event.point.z,
      count: 4,
      dir: UP,
      spread: 0.8,
      speedMin: 2,
      speedMax: 6,
      sizeMin: 0.04,
      sizeMax: 0.09,
      lifeMin: 0.12,
      lifeMax: 0.3,
      gravity: -16,
      drag: 1,
      colors: [0xffd07a, 0xffffff],
      alpha: 1,
    });
  }

  /**
   * A damaging head contact: the game owns destruction. It carves its crater
   * (or a single-block scuff for a side hit) and reports whether a block died,
   * which makes the solver rebound and hop the pickaxe out of the crater.
   */
  private onSimVoxelDestroyed(event: ImpactEvent): boolean {
    const drop = event.body.userData.drop as ActiveDrop | undefined;
    if (!drop || drop.state !== 'falling') return false;
    const target = this.ctx.getTarget();
    if (!target) return false;

    const pos = event.voxelCenter ?? event.point;
    const crit = !event.side && event.quality === PERFECT;
    const res = event.side
      ? // side scuff: one block at most, chipped rather than blasted
        this.applyImpact(
          drop,
          pos,
          this.radiusWorld(drop, 0.6),
          drop.def.damage * SIDE_CHIP_DAMAGE,
          false,
          1,
        )
      : this.applyImpact(drop, pos, this.radiusWorld(drop), drop.def.damage, crit);
    if (!res || !res.destroyed.length) return false;

    drop.hasHit = true;
    this.stats.targetHits++;
    return true;
  }

  private onSimStop(body: PickaxeBody): void {
    const drop = body.userData.drop as ActiveDrop | undefined;
    if (!drop) return;
    drop.restTimer = Math.max(drop.restTimer, STOP_LINGER);
  }

  /**
   * Handle-first contact. No destruction and deliberately NO bounce impulse -
   * the tool just scrapes and keeps sliding on its own physics, though a small
   * spin nudge helps the head swing around for a proper bite.
   */
  private clang(drop: ActiveDrop): void {
    drop.handleHits++;
    if (drop.handleHits > 6) return;
    const body = drop.body;
    if (!body) return;
    const t = body.translation();
    const spin = body.angvel();
    body.setAngvel(
      { x: spin.x, y: spin.y, z: spin.z + rand(-2.2, 2.2) },
      true,
    );
    this.ctx.audio.impact('cloth', 0.45);
    this.ctx.fx.voxelBurst(t.x, t.y, t.z, STONE_IDX, 0.35, 0.4);
    this.ctx.camera.addShake(0.04);
  }

  /** Destruction radius in world units for the current target. */
  private radiusWorld(drop: ActiveDrop, scale = 1): number {
    const target = this.ctx.getTarget();
    const block = target ? target.voxelSize : 0.7;
    return drop.radiusBlocks * block * scale;
  }

  private impactOnTarget(drop: ActiveDrop, h1 = 0, h2 = 0): void {
    // Only a drop still in free fall may bite. Channel tools and explosives
    // switch state on their first contact and must not re-trigger.
    if (drop.state !== 'falling') return;
    const target = this.ctx.getTarget();
    if (!target) return;
    const speed = drop.prevVel.length();
    // Mining is gated on arrival speed, not on being the first touch: a
    // pickaxe that bounces and comes back down hard enough bites again.
    if (speed < MIN_MINE_SPEED) return;
    if (drop.mineCooldown > 0) return;
    drop.mineCooldown = 0.16;
    drop.hasHit = true;
    this.stats.targetHits++;

    // Prefer the solver's real contact point so the crater starts exactly where
    // the blade touched, not at the head's centre.
    const contact = h1 && h2 ? this.ctx.physics.contactPoint(h1, h2) : null;
    if (contact) drop.impactPos.set(contact.x, contact.y, contact.z);
    else drop.impactPos.copy(drop.prevTipWorld).add(drop.tipWorld).multiplyScalar(0.5);
    // Snap onto the exact block that was struck (one block of slack, so a
    // corner graze can never teleport the crater further away).
    target.snapToBlock(drop.impactPos, 1);

    const expected = Math.sqrt(2 * 27 * drop.def.spawnHeight * this.ctx.progression.heightMul);
    const quality = clamp(speed / Math.max(6, expected), 0.4, 1.45);
    const radius = this.radiusWorld(drop);

    if (drop.def.behavior === 'explosive' || drop.def.behavior === 'meteor') {
      drop.state = 'channel';
      drop.channelLeft = 0.2;
      this.cascades.push({
        pos: drop.impactPos.clone(),
        radius,
        damage: drop.def.damage * quality,
        tool: drop.def,
        timer: drop.def.behavior === 'meteor' ? 0.03 : 0.16,
      });
      this.ctx.audio.impact('dark', 0.7);
      return;
    }

    if (drop.def.behavior === 'roll') {
      // A rolling body bites sideways and keeps its footing underneath.
      const physR = (drop.def.bodyRadius ?? 1.6) * drop.def.scale;
      const t = drop.body?.translation() ?? { x: 0, y: 0, z: 0 };
      TMP.set(t.x, t.y, t.z);
      const bite = target.damage(
        TMP,
        radius * 0.72,
        drop.def.damage * quality * 0.45 * this.ctx.progression.damageMul,
        600,
        physR * 0.88,
      );
      const mat = bite.destroyed.length ? bite.destroyed[0].mat : STONE_IDX;
      this.ctx.fx.impactBurst(
        TMP.x,
        TMP.y - physR * 0.6,
        TMP.z,
        Math.max(0.6, radius * 0.8),
        mat,
        0.9,
      );
      this.ctx.audio.impact('stone', 0.9);
      if (bite.destroyed.length) {
        this.ctx.debris.beginBudget(8);
        this.ctx.onImpact({
          position: TMP.clone(),
          voxels: bite.destroyed.length,
          coins: Math.round(bite.coins * this.ctx.progression.coinMul * drop.def.coinBonus),
          radius: radius * 0.72,
          power: 0.6,
          material: mat,
          crit: false,
          tool: drop.def,
        });
      }
      drop.state = 'channel';
      drop.channelLeft = drop.def.channel ?? 7;
      drop.channelTick = 0.05;
      this.keepRolling(drop);
      return;
    }

    this.applyImpact(drop, drop.impactPos, radius, drop.def.damage * quality, false);

    if (drop.def.behavior === 'drill' || drop.def.behavior === 'saw') {
      drop.state = 'channel';
      drop.channelLeft = drop.def.channel ?? 2;
      this.freeze(drop);
    }
  }

  impactOnGround(drop: ActiveDrop, point?: THREE.Vector3, speedOverride?: number): void {
    if (drop.state === 'done') return;
    drop.groundHits++;
    this.stats.groundHits++;
    if (drop.groundHits > 2) return;
    const speed = speedOverride ?? drop.prevVel.length();
    const p = point ?? (drop.tipWorld.y > -0.5 ? drop.tipWorld : drop.prevTipWorld);
    this.ctx.fx.voxelBurst(p.x, 0.25, p.z, STONE_IDX, 0.7, 0.7);
    this.ctx.fx.impact.dustRing(p.x, 0.1, p.z, 1.5, 0x8f8577, 0.7);
    this.ctx.audio.impact('stone', clamp(speed / 18, 0.25, 1.3));
    this.ctx.camera.addShake(clamp(speed / 110, 0.03, 0.22));
    this.ctx.onGroundHit(drop.def, speed, p.clone());
  }

  private freeze(drop: ActiveDrop): void {
    drop.stuck = true;
    const body = drop.body;
    if (!body) return;
    try {
      body.setBodyType(this.ctx.physics.RAPIER.RigidBodyType.KinematicPositionBased, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    } catch {
      /* keep it dynamic if the API is unavailable */
    }
  }

  private applyImpact(
    drop: ActiveDrop,
    pos: THREE.Vector3,
    radius: number,
    damage: number,
    crit: boolean,
    maxBlocks = drop.def.maxBlocks,
  ): DamageResult | null {
    const target = this.ctx.getTarget();
    if (!target) return null;
    const prog = this.ctx.progression;
    const finalRadius = radius * (crit ? 1.4 : 1);
    const finalDamage = damage * prog.damageMul * (crit ? 2.1 : 1);
    // Planar tools bite a flat crater: the blade is only ~a third of a block
    // thick, so a spherical crater would carve blocks it never touched.
    const flatten = drop.sim || drop.def.spinMode !== 'free' ? PLANE_FLATTEN : 1;
    const res = target.damage(
      pos,
      finalRadius,
      finalDamage,
      900,
      0,
      maxBlocks,
      flatten,
    );

    let dominant = STONE_IDX;
    const counts = new Map<number, number>();
    for (const v of res.destroyed) counts.set(v.mat, (counts.get(v.mat) ?? 0) + 1);
    let best = -1;
    for (const [m, c] of counts) {
      if (c > best) {
        best = c;
        dominant = m;
      }
    }
    const def = MATERIALS[MATERIAL_IDS[dominant]] ?? MATERIALS.stone;
    const power = clamp(res.destroyed.length / 42, 0, 1.6);

    this.ctx.fx.impactBurst(pos.x, pos.y, pos.z, finalRadius, dominant, 0.6 + power);
    const samples = Math.min(6, res.destroyed.length);
    for (let i = 0; i < samples; i++) {
      const v = res.destroyed[(Math.random() * res.destroyed.length) | 0];
      if (!v) continue;
      const wp = target.worldOf(v.cell, TMP);
      this.ctx.fx.voxelBurst(wp.x, wp.y, wp.z, v.mat, 0.7, 1.2);
    }
    if (drop.def.burst) {
      this.ctx.fx.voxelBurst(pos.x, pos.y, pos.z, dominant, drop.def.burst * 0.5, 1.4);
    }
    this.ctx.audio.impact(def.fx, 0.5 + power);
    if (crit) this.ctx.audio.coin(6);

    this.ctx.camera.addShake(clamp(0.12 + power * 0.55 + (drop.def.damage / 900) * 0.5, 0.1, 1.6));
    if (finalRadius > 2.4) this.ctx.camera.kickFov(1.6 + power);

    this.ctx.debris.beginBudget(finalRadius > 2.4 ? 12 : 4);
    const coins = Math.round(res.coins * prog.coinMul * drop.def.coinBonus * (crit ? 2 : 1));
    this.ctx.onImpact({
      position: pos.clone(),
      voxels: res.destroyed.length,
      coins,
      radius: finalRadius,
      power,
      material: dominant,
      crit,
      tool: drop.def,
    });
    return res;
  }

  /**
   * A rolling body chews whatever it is pushing into. Voxels inside the
   * protected footprint below the sphere are skipped, so the boulder keeps
   * rolling on the strip it stands on instead of drilling downward.
   */
  private rollChew(drop: ActiveDrop, target: Target): void {
    const rb = drop.body;
    if (!rb) return;
    const t = rb.translation();
    TMP.set(t.x, t.y, t.z);
    const physR = (drop.def.bodyRadius ?? 1.6) * drop.def.scale;
    const dps = drop.def.channelDps ?? 140;
    const radius = this.radiusWorld(drop);
    const res = target.damage(
      TMP,
      radius,
      dps * 0.075 * this.ctx.progression.damageMul,
      300,
      physR * 0.88,
      drop.def.maxBlocks,
    );
    this.keepRolling(drop);
    if (!res.destroyed.length) {
      if (Math.random() < 0.25) {
        this.ctx.audio.impact('stone', 0.25);
      }
      return;
    }
    const mat = res.destroyed[0].mat;
    this.ctx.fx.voxelBurst(TMP.x, TMP.y - physR * 0.45, TMP.z, mat, 0.65, 0.9);
    this.ctx.fx.dust.emit({
      x: TMP.x,
      y: t.y - physR * 0.7,
      z: TMP.z,
      count: 5,
      dir: UP,
      spread: 1,
      speedMin: 1,
      speedMax: 4,
      sizeMin: 0.2,
      sizeMax: 0.6,
      lifeMin: 0.4,
      lifeMax: 1.1,
      gravity: -3,
      drag: 1.6,
      colors: [0x9c9a92, 0x6a6157],
      radius: physR * 0.6,
      alpha: 0.4,
    });
    this.ctx.audio.impact('stone', 0.42);
    this.ctx.debris.beginBudget(2);
    this.ctx.onImpact({
      position: TMP.clone(),
      voxels: res.destroyed.length,
      coins: Math.round(res.coins * this.ctx.progression.coinMul * drop.def.coinBonus),
      radius,
      power: 0.35,
      material: mat,
      crit: false,
      tool: drop.def,
    });
  }

  /** Keeps a rolling body rolling: holds a target speed and rolls without slipping. */
  private keepRolling(drop: ActiveDrop): void {
    const body = drop.body;
    if (!body) return;
    const v = body.linvel();
    const physR = (drop.def.bodyRadius ?? 1.6) * drop.def.scale;
    const targetSpeed = drop.def.rollSpeed ?? 8;
    let hx = v.x;
    let hz = v.z;
    let speed = Math.hypot(hx, hz);
    if (speed < 0.4) {
      const a = rand(0, Math.PI * 2);
      hx = Math.cos(a) * targetSpeed * 0.6;
      hz = Math.sin(a) * targetSpeed * 0.6;
      speed = Math.hypot(hx, hz);
      body.setLinvel({ x: hx, y: v.y, z: hz }, true);
    } else if (speed < targetSpeed) {
      const k = 1 + ((targetSpeed - speed) / targetSpeed) * 0.14;
      hx *= k;
      hz *= k;
      speed *= k;
      body.setLinvel({ x: hx, y: v.y, z: hz }, true);
    }
    const inv = 1 / Math.max(0.001, speed);
    const omega = speed / Math.max(0.4, physR);
    body.setAngvel({ x: hz * inv * omega, y: body.angvel().y * 0.5, z: -hx * inv * omega }, true);
  }

  private detonate(c: Cascade): void {    const target = this.ctx.getTarget();
    if (!target) return;
    const mega = c.radius > 4.5;
    this.ctx.fx.explosion(c.pos.x, c.pos.y, c.pos.z, c.radius);
    this.ctx.audio.explosion(mega ? 1.6 : 1);
    this.ctx.camera.addShake(mega ? 2.0 : 1.1);
    this.ctx.camera.kickFov(mega ? 5 : 2.5);
    const res = target.damage(c.pos, c.radius, c.damage * this.ctx.progression.damageMul, 1600);
    this.ctx.debris.beginBudget(mega ? 24 : 10);
    const dominant = res.destroyed.length ? res.destroyed[0].mat : STONE_IDX;
    this.ctx.onImpact({
      position: c.pos.clone(),
      voxels: res.destroyed.length,
      coins: Math.round(res.coins * this.ctx.progression.coinMul * c.tool.coinBonus),
      radius: c.radius,
      power: 1.5,
      material: dominant,
      crit: false,
      tool: c.tool,
    });
  }

  /* ---------------------------------------------------------------- update */

  update(dt: number): void {
    for (const [id, t] of this.cooldowns) {
      const nt = t - dt;
      if (nt <= 0) this.cooldowns.delete(id);
      else this.cooldowns.set(id, nt);
    }

    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      p.delay -= dt;
      if (p.delay <= 0) {
        this.spawnOne(p.def, p.x, p.z, p.y);
        this.pending.splice(i, 1);
      }
    }

    for (let i = this.cascades.length - 1; i >= 0; i--) {
      const c = this.cascades[i];
      c.timer -= dt;
      if (c.timer <= 0) {
        this.detonate(c);
        this.cascades.splice(i, 1);
      }
    }

    // One fixed-timestep pass for every hand-simulated pickaxe. The solver owns
    // those transforms; the loop below only reads gameplay state back out.
    this.sim.update(dt);

    const target = this.ctx.getTarget();
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const drop = this.drops[i];

      if (drop.sim) {
        const body = drop.sim;
        drop.prevVel.copy(body.velocity);
        drop.prevTipWorld.copy(drop.tipWorld);
        // the solver already wrote the interpolated transform onto the mesh
        drop.built.group.position.copy(body.renderPosition);
        drop.built.group.quaternion.copy(body.renderOrientation);
        drop.tipWorld
          .copy(drop.built.tip)
          .applyQuaternion(body.renderOrientation)
          .add(body.renderPosition);
        drop.life += dt;
        if (drop.mineCooldown > 0) drop.mineCooldown -= dt;
        if (drop.restTimer > 0) {
          drop.restTimer -= dt;
          if (drop.restTimer <= 0 && drop.state === 'falling') drop.state = 'done';
        } else if (drop.state === 'falling' && drop.life > 8) {
          drop.state = 'done';
        }
      } else {
        const rb = drop.body;
        if (!rb) continue;
        const lv = rb.linvel();
        drop.prevVel.set(lv.x, lv.y, lv.z);
        drop.prevTipWorld.copy(drop.tipWorld);

        const t = rb.translation();
        const r = rb.rotation();
        drop.built.group.position.set(t.x, t.y, t.z);
        drop.built.group.quaternion.set(r.x, r.y, r.z, r.w);
        drop.tipWorld.copy(drop.built.tip).applyQuaternion(drop.built.group.quaternion).add(drop.built.group.position);
        drop.life += dt;
        if (drop.mineCooldown > 0) drop.mineCooldown -= dt;

        if (drop.state === 'channel') {
          drop.channelLeft -= dt;
          drop.channelTick -= dt;
          if (drop.channelTick <= 0 && target) {
            if (drop.def.behavior === 'roll') {
              drop.channelTick = 0.075;
              this.rollChew(drop, target);
            } else {
              drop.channelTick = 0.18;
              const dps = drop.def.channelDps ?? 40;
              const dmg = dps * 0.18 * this.ctx.progression.damageMul;
              target.snapToBlock(drop.tipWorld, 3);
              const radius = this.radiusWorld(drop, 0.7);
              const res = target.damage(drop.tipWorld, radius, dmg, 260, 0, drop.def.maxBlocks);
              if (res.destroyed.length) {
                const mat = res.destroyed[0].mat;
                this.ctx.fx.voxelBurst(drop.tipWorld.x, drop.tipWorld.y, drop.tipWorld.z, mat, 0.5, 0.8);
                this.ctx.fx.puff(drop.tipWorld.x, drop.tipWorld.y, drop.tipWorld.z, mat, 5);
                this.ctx.audio.impact('stone', 0.35);
                this.ctx.debris.beginBudget(2);
                this.ctx.onImpact({
                  position: drop.tipWorld.clone(),
                  voxels: res.destroyed.length,
                  coins: Math.round(res.coins * this.ctx.progression.coinMul * drop.def.coinBonus),
                  radius,
                  power: 0.25,
                  material: mat,
                  crit: false,
                  tool: drop.def,
                });
              } else {
                this.ctx.fx.sparks.emit({
                  x: drop.tipWorld.x,
                  y: drop.tipWorld.y,
                  z: drop.tipWorld.z,
                  count: 7,
                  dir: UP,
                  spread: 0.9,
                  speedMin: 3,
                  speedMax: 9,
                  sizeMin: 0.05,
                  sizeMax: 0.1,
                  lifeMin: 0.15,
                  lifeMax: 0.35,
                  gravity: -16,
                  drag: 1,
                  colors: [0xffd07a, 0xffffff],
                  alpha: 1,
                });
                if (drop.def.behavior === 'drill') this.ctx.audio.impact('metal', 0.2);
              }
            }
          }
          if (drop.channelLeft <= 0) drop.state = 'done';
        } else if (drop.state === 'falling' && drop.life > 8) {
          drop.state = 'done';
        }
      }

      if (drop.state === 'done') {
        drop.fade += dt;
        const k = clamp(1 - (drop.fade - 0.04) / 0.42, 0, 1);
        drop.built.group.scale.setScalar(Math.max(0.001, k));
        if (k <= 0.03) {
          this.removeDrop(i);
          continue;
        }
      }
      if (drop.built.group.position.y < -42) this.removeDrop(i);
    }
  }

  private removeDrop(index: number): void {
    const drop = this.drops[index];
    if (drop.sim) this.sim.remove(drop.sim);
    if (drop.body) this.ctx.physics.removeBody(drop.body);
    drop.built.group.removeFromParent();
    this.drops.splice(index, 1);
  }

  get activeCount(): number {
    return this.drops.length;
  }

  /** the hand-written solver driving every pickaxe drop (dev/debug access) */
  get simulator(): PickaxeSimulator {
    return this.sim;
  }

  /** Debug snapshot of live drops (dev harness only). */
  snapshot(): unknown {
    return this.drops.map((d) => {
      const sim = d.sim;
      const rb = d.body;
      const t = sim ? sim.position : rb!.translation();
      const v = sim ? sim.velocity : rb!.linvel();
      const w = sim ? sim.angularVelocity : rb!.angvel();
      const r = sim ? sim.orientation : rb!.rotation();
      return {
        id: d.id,
        tool: d.def.id,
        solver: sim ? 'custom' : 'rapier',
        state: d.state,
        stuck: d.stuck,
        hasHit: d.hasHit,
        handleHits: d.handleHits,
        groundHits: d.groundHits,
        rot: [Number(r.x.toFixed(3)), Number(r.y.toFixed(3)), Number(r.z.toFixed(3)), Number(r.w.toFixed(3))],
        angvel: [Number(w.x.toFixed(3)), Number(w.y.toFixed(3)), Number(w.z.toFixed(3))],
        sleep: sim ? sim.sleeping : rb!.isSleeping(),
        x: Number(t.x.toFixed(3)),
        z: Number(t.z.toFixed(3)),
        y: Number(t.y.toFixed(2)),
        vy: Number(v.y.toFixed(2)),
        vx: Number(v.x.toFixed(3)),
        vz: Number(v.z.toFixed(3)),
        com: sim
          ? [0, 0, 0]
          : [
              Number(rb!.localCom().x.toFixed(4)),
              Number(rb!.localCom().y.toFixed(4)),
              Number(rb!.localCom().z.toFixed(4)),
            ],
        speed: Number(Math.hypot(v.x, v.y, v.z).toFixed(2)),
      };
    });
  }

  /** Dev-only: spawn pickaxes ignoring cooldowns (physics lab / stress runs). */
  debugDropMany(def: ToolDef, count: number, point: THREE.Vector3): void {
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2);
      const d = Math.sqrt(rand(0, 1)) * 3.4;
      const height = point.y + def.spawnHeight * this.ctx.progression.heightMul;
      this.spawnOne(def, point.x + Math.cos(a) * d, point.z + Math.sin(a) * d, height);
    }
  }


  createPreview(def: ToolDef): BuiltTool {
    return buildTool(def, this.ctx.physics.RAPIER);
  }

  clear(): void {
    for (let i = this.drops.length - 1; i >= 0; i--) this.removeDrop(i);
    this.pending.length = 0;
    this.cascades.length = 0;
    this.cooldowns.clear();
  }
}
