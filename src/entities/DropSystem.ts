import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld, OwnerKind } from '../physics/PhysicsWorld';
import type { Target } from '../destruction/Target';
import { TOOL_BY_ID, type ToolDef } from '../content/tools';
import { buildTool, type BuiltTool } from './ToolFactory';
import type { FxManager } from '../effects/FxManager';
import type { DebrisSystem } from './DebrisSystem';
import type { CameraDirector } from '../scene/CameraDirector';
import type { AudioSystem } from '../audio/AudioSystem';
import type { Progression } from '../progression/Progression';
import { MATERIAL_IDS, MATERIALS } from '../content/materials';
import { clamp } from '../utils/math';
import { rand } from '../utils/rng';

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
}

export interface ActiveDrop {
  def: ToolDef;
  built: BuiltTool;
  body: RAPIER.RigidBody;
  hasHit: boolean;
  groundHits: number;
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
  radius: number;
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
const TMP = new THREE.Vector3();
const QUAT = new THREE.Quaternion();
const QUAT2 = new THREE.Quaternion();
const STONE_IDX = MATERIAL_IDS.indexOf('stone');

export class DropSystem {
  private drops: ActiveDrop[] = [];
  private pending: PendingSpawn[] = [];
  private cascades: Cascade[] = [];
  private cooldowns = new Map<string, number>();
  totalDrops = 0;
  readonly stats = { spawned: 0, targetHits: 0, groundHits: 0, denied: 0, voxels: 0 };

  constructor(private ctx: DropContext) {}

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
    const built = buildTool(def, physics.RAPIER);
    const y = height + rand(-0.3, 0.6);
    built.group.position.set(x, y, z);

    const q = QUAT;
    if (def.kind === 'blunt' || def.kind === 'projectile') {
      q.setFromAxisAngle(UP, rand(0, Math.PI * 2));
      if (def.kind === 'projectile') {
        QUAT2.setFromAxisAngle(new THREE.Vector3(1, 0, 0), rand(-0.6, 0.6));
        q.multiply(QUAT2);
      }
    } else {
      // Bias the heavy head downward, then add intentional tumble.
      q.setFromAxisAngle(UP, rand(0, Math.PI * 2));
      const axis = new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)).normalize();
      QUAT2.setFromAxisAngle(axis, rand(0.2, 0.75));
      q.multiply(QUAT2);
    }
    built.group.quaternion.copy(q);
    scene.add(built.group);

    const body = physics.world.createRigidBody(
      physics.RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, y, z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setLinearDamping(def.linearDamping)
        .setAngularDamping(def.angularDamping)
        .setGravityScale(def.gravityScale)
        .setCcdEnabled(true),
    );

    const tip = built.tip.clone().applyQuaternion(q).add(built.group.position);

    const drop: ActiveDrop = {
      def,
      built,
      body,
      hasHit: false,
      groundHits: 0,
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
      radius: def.radius * this.ctx.progression.radiusMul,
    };

    for (const c of built.colliders) {
      const col = physics.world.createCollider(c, body);
      physics.registerCollider(col.handle, { kind: 'tool', ref: drop });
    }

    // Tumble end-over-end around the axis perpendicular to the handle.
    const handleDir = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const tumble = new THREE.Vector3().crossVectors(
      handleDir,
      new THREE.Vector3(rand(-1, 1), rand(-0.2, 0.2), rand(-1, 1)),
    );
    if (tumble.lengthSq() < 1e-4) tumble.set(1, 0, 0);
    tumble.normalize();
    const spin = def.spin * rand(0.7, 1.25);
    body.setAngvel(
      { x: tumble.x * spin, y: tumble.y * spin * 0.35 + rand(-0.8, 0.8), z: tumble.z * spin },
      true,
    );
    body.setLinvel({ x: rand(-0.9, 0.9), y: -2.5, z: rand(-0.9, 0.9) }, true);

    this.drops.push(drop);
    this.ctx.audio.whoosh(def.kind === 'projectile' ? 1.4 : 1);
  }

  /* ------------------------------------------------------------- collision */

  /** Called by the game loop when one of our colliders touches something. */
  handleContact(ref: unknown, other: OwnerKind): void {
    const drop = ref as ActiveDrop | null;
    if (!drop || !drop.body || drop.state === 'done') return;
    if (other === 'target') this.impactOnTarget(drop);
    else if (other === 'ground') this.impactOnGround(drop);
  }

  private impactOnTarget(drop: ActiveDrop): void {
    if (drop.hasHit || drop.state === 'done') return;
    drop.hasHit = true;
    this.stats.targetHits++;
    const target = this.ctx.getTarget();
    if (!target) return;
    drop.impactPos.copy(drop.prevTipWorld).add(drop.tipWorld).multiplyScalar(0.5);
    // keep the impact just under the surface for a believable crater
    drop.impactPos.y -= drop.radius * 0.12;
    target.snapToSurface(drop.impactPos, 8);

    const speed = drop.prevVel.length();
    const expected = Math.sqrt(2 * 27 * drop.def.spawnHeight * this.ctx.progression.heightMul);
    const quality = clamp(speed / Math.max(6, expected), 0.4, 1.45);

    if (drop.def.behavior === 'explosive' || drop.def.behavior === 'meteor') {
      drop.state = 'channel';
      drop.channelLeft = 0.2;
      this.cascades.push({
        pos: drop.impactPos.clone(),
        radius: drop.radius,
        damage: drop.def.damage * quality,
        tool: drop.def,
        timer: drop.def.behavior === 'meteor' ? 0.03 : 0.16,
      });
      this.ctx.audio.impact('dark', 0.7);
      return;
    }

    if (drop.def.behavior === 'roll') {
      // A rolling body bites sideways and keeps its footing underneath.
      const physR = drop.def.bodyRadius ?? 1.6;
      const t = drop.body.translation();
      TMP.set(t.x, t.y, t.z);
      const bite = target.damage(
        TMP,
        drop.radius * 0.72,
        drop.def.damage * quality * 0.45,
        600,
        physR * 0.95,
      );
      const mat = bite.destroyed.length ? bite.destroyed[0].mat : STONE_IDX;
      this.ctx.fx.impactBurst(TMP.x, TMP.y - physR * 0.6, TMP.z, drop.radius * 0.8, mat, 0.9);
      this.ctx.audio.impact('stone', 0.9);
      if (bite.destroyed.length) {
        this.ctx.debris.beginBudget(8);
        this.ctx.onImpact({
          position: TMP.clone(),
          voxels: bite.destroyed.length,
          coins: Math.round(bite.coins * this.ctx.progression.coinMul * drop.def.coinBonus),
          radius: drop.radius * 0.72,
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

    this.applyImpact(drop, drop.impactPos, drop.radius, drop.def.damage * quality, false);

    if (drop.def.behavior === 'drill' || drop.def.behavior === 'saw') {
      drop.state = 'channel';
      drop.channelLeft = drop.def.channel ?? 2;
      this.freeze(drop);
    }
  }

  impactOnGround(drop: ActiveDrop): void {
    if (drop.state === 'done') return;
    drop.groundHits++;
    this.stats.groundHits++;
    if (drop.groundHits > 2) return;
    const speed = drop.prevVel.length();
    const p = drop.tipWorld.y > -0.5 ? drop.tipWorld : drop.prevTipWorld;
    this.ctx.fx.voxelBurst(p.x, 0.25, p.z, STONE_IDX, 0.7, 0.7);
    this.ctx.fx.impact.dustRing(p.x, 0.1, p.z, 1.5, 0x8f8577, 0.7);
    this.ctx.audio.impact('stone', clamp(speed / 18, 0.25, 1.3));
    this.ctx.camera.addShake(clamp(speed / 110, 0.03, 0.22));
    this.ctx.onGroundHit(drop.def, speed, p.clone());
  }

  private freeze(drop: ActiveDrop): void {
    drop.stuck = true;
    try {
      drop.body.setBodyType(this.ctx.physics.RAPIER.RigidBodyType.KinematicPositionBased, true);
      drop.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      drop.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
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
  ): void {
    const target = this.ctx.getTarget();
    if (!target) return;
    const prog = this.ctx.progression;
    const finalRadius = radius * (crit ? 1.4 : 1);
    const finalDamage = damage * prog.damageMul * (crit ? 2.1 : 1);
    const res = target.damage(pos, finalRadius, finalDamage);

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
    const samples = Math.min(6, Math.floor(2 + res.destroyed.length * 0.12));
    for (let i = 0; i < samples; i++) {
      const v = res.destroyed[(Math.random() * res.destroyed.length) | 0];
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
  }

  /**
   * A rolling body chews whatever it is pushing into. Voxels inside the
   * protected footprint below the sphere are skipped, so the boulder keeps
   * rolling on the strip it stands on instead of drilling downward.
   */
  private rollChew(drop: ActiveDrop, target: Target): void {
    const t = drop.body.translation();
    TMP.set(t.x, t.y, t.z);
    const physR = drop.def.bodyRadius ?? 1.6;
    const dps = drop.def.channelDps ?? 140;
    const res = target.damage(TMP, drop.radius, dps * 0.09, 300, physR * 0.95);
    this.keepRolling(drop);
    if (!res.destroyed.length) {
      if (Math.random() < 0.25) {
        this.ctx.audio.impact('stone', 0.25);
      }
      return;
    }
    const mat = res.destroyed[0].mat;
    this.ctx.fx.voxelBurst(TMP.x, TMP.y - physR * 0.45, TMP.z, mat, 0.6, 0.9);
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
      radius: drop.radius,
      power: 0.35,
      material: mat,
      crit: false,
      tool: drop.def,
    });
  }

  /** Keeps a rolling body rolling: holds a target speed and rolls without slipping. */
  private keepRolling(drop: ActiveDrop): void {
    const body = drop.body;
    const v = body.linvel();
    const physR = drop.def.bodyRadius ?? 1.6;
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

    const target = this.ctx.getTarget();
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const drop = this.drops[i];
      const lv = drop.body.linvel();
      drop.prevVel.set(lv.x, lv.y, lv.z);
      drop.prevTipWorld.copy(drop.tipWorld);
      const t = drop.body.translation();
      const r = drop.body.rotation();
      drop.built.group.position.set(t.x, t.y, t.z);
      drop.built.group.quaternion.set(r.x, r.y, r.z, r.w);
      drop.tipWorld.copy(drop.built.tip).applyQuaternion(drop.built.group.quaternion).add(drop.built.group.position);
      drop.life += dt;

      if (drop.state === 'channel') {
        drop.channelLeft -= dt;
        drop.channelTick -= dt;
        if (drop.channelTick <= 0 && target) {
          if (drop.def.behavior === 'roll') {
            drop.channelTick = 0.09;
            this.rollChew(drop, target);
          } else {
            drop.channelTick = 0.18;
          const dps = drop.def.channelDps ?? 40;
          const dmg = dps * 0.18;
          target.snapToSurface(drop.tipWorld, 4);
          const res = target.damage(drop.tipWorld, drop.radius * 0.6, dmg, 260);
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
              radius: drop.radius * 0.6,
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
    this.ctx.physics.removeBody(drop.body);
    drop.built.group.removeFromParent();
    this.drops.splice(index, 1);
  }

  get activeCount(): number {
    return this.drops.length;
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
