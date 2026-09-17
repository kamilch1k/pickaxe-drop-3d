import * as THREE from 'three';
import { ParticlePool } from './Particles';
import { ShardPool } from './Shards';
import { ImpactFx } from './ImpactFx';
import { dotTexture, sparkTexture } from '../scene/Textures';
import { MATERIAL_IDS, MATERIALS, type FxKind } from '../content/materials';
import { rand } from '../utils/rng';

interface Style {
  dust: number;
  spark: number;
  shard: number;
  shardSpeed: number;
  dustColor: number;
  sparkColors: number[];
  spartSize: number;
  gravity: number;
}

const STYLES: Record<FxKind, Style> = {
  stone: {
    dust: 16,
    spark: 2,
    shard: 5,
    shardSpeed: 5,
    dustColor: 0x9c9a92,
    sparkColors: [0xd8d4c8],
    spartSize: 0.05,
    gravity: -24,
  },
  metal: {
    dust: 9,
    spark: 16,
    shard: 5,
    shardSpeed: 6,
    dustColor: 0x9aa0a8,
    sparkColors: [0xffd07a, 0xfff0c0, 0xff9a3c],
    spartSize: 0.07,
    gravity: -14,
  },
  crystal: {
    dust: 10,
    spark: 20,
    shard: 8,
    shardSpeed: 7.5,
    dustColor: 0xbfe9ff,
    sparkColors: [0xffffff, 0x9df3ff, 0xd9b3ff],
    spartSize: 0.085,
    gravity: -16,
  },
  gold: {
    dust: 10,
    spark: 18,
    shard: 6,
    shardSpeed: 6.5,
    dustColor: 0xe0b455,
    sparkColors: [0xffe07a, 0xffc93c, 0xffffff],
    spartSize: 0.075,
    gravity: -18,
  },
  dark: {
    dust: 18,
    spark: 12,
    shard: 7,
    shardSpeed: 5.5,
    dustColor: 0x6a4a8f,
    sparkColors: [0xb06cff, 0x7b3bd6, 0xff7bf0],
    spartSize: 0.08,
    gravity: -20,
  },
  organic: {
    dust: 14,
    spark: 4,
    shard: 6,
    shardSpeed: 5,
    dustColor: 0xd07a4a,
    sparkColors: [0xffb37a, 0xff8a3d],
    spartSize: 0.06,
    gravity: -22,
  },
  mythic: {
    dust: 14,
    spark: 26,
    shard: 9,
    shardSpeed: 8,
    dustColor: 0xffa6f5,
    sparkColors: [0xffffff, 0x7ef6ff, 0xff9bf5, 0xffe07a],
    spartSize: 0.095,
    gravity: -15,
  },
  cloth: {
    dust: 12,
    spark: 1,
    shard: 4,
    shardSpeed: 4,
    dustColor: 0x6a7090,
    sparkColors: [0xaab0d0],
    spartSize: 0.05,
    gravity: -20,
  },
};

export class FxManager {
  readonly dust: ParticlePool;
  readonly sparks: ParticlePool;
  readonly shards: ShardPool;
  readonly impact: ImpactFx;

  constructor(scene: THREE.Scene) {
    this.dust = new ParticlePool(2400, dotTexture(), THREE.NormalBlending);
    this.sparks = new ParticlePool(1600, sparkTexture(), THREE.AdditiveBlending);
    this.shards = new ShardPool(scene, 460);
    this.impact = new ImpactFx(scene);
    scene.add(this.dust.points);
    scene.add(this.sparks.points);
  }

  private styleFor(matIdx: number): { style: Style; color: number; def: typeof MATERIALS.stone } {
    const def = MATERIALS[MATERIAL_IDS[matIdx]] ?? MATERIALS.stone;
    return { style: STYLES[def.fx] ?? STYLES.stone, color: def.color, def };
  }

  /** Standard debris burst when voxels shatter. */
  voxelBurst(
    x: number,
    y: number,
    z: number,
    matIdx: number,
    strength = 1,
    upward = 1,
  ): void {
    const { style, color } = this.styleFor(matIdx);
    const dustCount = Math.round(style.dust * strength);
    const sparkCount = Math.round(style.spark * strength);
    const shardCount = Math.round(style.shard * strength * 1.35);
    const dir = new THREE.Vector3(rand(-0.4, 0.4), 1, rand(-0.4, 0.4)).normalize();
    if (dustCount > 0) {
      this.dust.emit({
        x,
        y: y + 0.12,
        z,
        count: dustCount,
        dir,
        spread: 0.85,
        speedMin: 1.4,
        speedMax: 4.6 * strength,
        sizeMin: 0.1,
        sizeMax: 0.34 * strength,
        lifeMin: 0.5,
        lifeMax: 1.35,
        gravity: style.gravity * 0.35,
        drag: 1.5,
        colors: [style.dustColor, style.dustColor, color],
        radius: 0.3,
        alpha: 0.75,
      });
    }
    if (sparkCount > 0) {
      this.sparks.emit({
        x,
        y: y + 0.15,
        z,
        count: sparkCount,
        dir,
        spread: 0.75,
        speedMin: 3,
        speedMax: 11 * strength,
        sizeMin: style.spartSize * 0.7,
        sizeMax: style.spartSize * 1.6,
        lifeMin: 0.22,
        lifeMax: 0.7,
        gravity: style.gravity,
        drag: 0.9,
        colors: style.sparkColors,
        radius: 0.22,
        alpha: 1,
      });
    }
    if (shardCount > 0) {
      this.shards.spawn(
        x,
        y + 0.15,
        z,
        shardCount,
        color,
        style.shardSpeed * strength,
        0.16 * Math.max(0.6, Math.min(1.4, strength)),
        1.5,
        3 * upward,
      );
    }
  }

  /** Big impact hit: dust ring + shockwave + flash. */
  impactBurst(
    x: number,
    y: number,
    z: number,
    radius: number,
    matIdx: number,
    power: number,
  ): void {
    const { style, color } = this.styleFor(matIdx);
    const big = radius > 2.6;
    this.impact.dustRing(x, Math.max(0.1, y), z, radius * 0.85, style.dustColor, big ? 1 : 0.7);
    if (big) {
      this.impact.shockwave(x, Math.max(0.08, y), z, radius * 1.1, 0xffffff, Math.min(1.4, power), 0.5);
    }
    this.impact.flash(x, y + 0.6, z, style.sparkColors[0], big ? 9 : 4, 20 + radius * 3);
    this.dust.emit({
      x,
      y: y + 0.1,
      z,
      count: Math.round((big ? 46 : 22) * Math.min(2, power)),
      dir: new THREE.Vector3(0, 1, 0),
      spread: 1,
      speedMin: 4,
      speedMax: big ? 17 : 10,
      sizeMin: 0.16,
      sizeMax: big ? 0.85 : 0.5,
      lifeMin: 0.55,
      lifeMax: 1.7,
      gravity: -6,
      drag: 1.5,
      colors: [style.dustColor, color, 0xffffff],
      radius: radius * 0.3,
      alpha: 0.55,
    });
    void this.styleFor(matIdx);
  }

  /** Cheap puff used when voxels simply vanish. */
  puff(x: number, y: number, z: number, matIdx: number, count = 4): void {
    const { style, color } = this.styleFor(matIdx);
    this.dust.emit({
      x,
      y,
      z,
      count,
      dir: new THREE.Vector3(0, 1, 0),
      spread: 1,
      speedMin: 0.6,
      speedMax: 2.4,
      sizeMin: 0.12,
      sizeMax: 0.32,
      lifeMin: 0.3,
      lifeMax: 0.8,
      gravity: -5,
      drag: 1.8,
      colors: [style.dustColor, color],
      radius: 0.2,
      alpha: 0.6,
    });
  }

  explosion(x: number, y: number, z: number, radius: number): void {
    this.impact.shockwave(x, Math.max(0.1, y), z, radius * 1.35, 0xffd9a0, 1.5, 0.65);
    this.impact.flash(x, y + 1, z, 0xffb347, 22, 42);
    this.sparks.emit({
      x,
      y,
      z,
      count: 90,
      dir: new THREE.Vector3(0, 1, 0),
      spread: 1,
      speedMin: 6,
      speedMax: 30,
      sizeMin: 0.1,
      sizeMax: 0.4,
      lifeMin: 0.3,
      lifeMax: 1.1,
      gravity: -18,
      drag: 0.9,
      colors: [0xffffff, 0xffd07a, 0xff8a3c, 0xff4a20],
      radius: 0.4,
      alpha: 1,
    });
    this.dust.emit({
      x,
      y,
      z,
      count: 70,
      dir: new THREE.Vector3(0, 1, 0),
      spread: 1,
      speedMin: 3,
      speedMax: 15,
      sizeMin: 0.3,
      sizeMax: 1.5,
      lifeMin: 0.9,
      lifeMax: 2.4,
      gravity: -4,
      drag: 1.2,
      colors: [0x8a8070, 0x6a6157, 0xffa060],
      radius: radius * 0.25,
      alpha: 0.5,
    });
    for (let i = 0; i < 3; i++) {
      this.impact.dustRing(x, y + 0.2 + i * 0.8, z, radius * (1 + i * 0.4), 0x9a8d7a, 1.1);
    }
  }

  update(dt: number): void {
    this.dust.update(dt);
    this.sparks.update(dt);
    this.shards.update(dt);
    this.impact.update(dt);
  }

  clear(): void {
    this.dust.clear();
    this.sparks.clear();
    this.shards.clear();
    this.impact.clear();
  }
}
