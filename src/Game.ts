import * as THREE from 'three';
import { SceneRig } from './scene/SceneRig';
import { Environment } from './scene/Environment';
import { PhysicsWorld } from './physics/PhysicsWorld';
import { FxManager } from './effects/FxManager';
import { DebrisSystem } from './entities/DebrisSystem';
import { DropSystem, type ImpactReport } from './entities/DropSystem';
import { Target, type TargetHooks } from './destruction/Target';
import type { DestroyedVoxel } from './destruction/VoxelGrid';
import { Progression } from './progression/Progression';
import { AudioSystem } from './audio/AudioSystem';
import { Ui } from './ui/Ui';
import { TOOLS, type ToolDef } from './content/tools';
import { TARGETS } from './content/targets';
import { MATERIAL_IDS, MATERIALS } from './content/materials';
import { BUILD_NUMBER } from './version';
import { clamp, formatNumber } from './utils/math';
import type { OwnerKind } from './physics/PhysicsWorld';
import { Profiler } from './utils/Profiler';
import { rand } from './utils/rng';

const FIXED_DT = 1 / 60;
const MAX_STEPS = 4;
const RAY_ORIGIN = new THREE.Vector3();
const RAY_DIR = new THREE.Vector3();
const AIM_SCRATCH = new THREE.Vector3();

type Phase = 'boot' | 'intro' | 'playing' | 'transitioning';

export class Game {
  private rig: SceneRig;
  private env: Environment;
  private physics = new PhysicsWorld();
  private fx: FxManager;
  private debris!: DebrisSystem;
  private drops!: DropSystem;
  private prog: Progression;
  private audio = new AudioSystem();
  private ui!: Ui;
  private target: Target | null = null;
  private phase: Phase = 'boot';

  private pointerNdc = new THREE.Vector2(0, 0);
  private aimDirty = true;
  private profiler = new Profiler();
  private aim = new THREE.Vector3();
  private hasAim = false;
  private aimGroup = new THREE.Group();
  private aimRing!: THREE.Mesh;
  private aimBeam!: THREE.Mesh;
  private ghostCache = new Map<string, THREE.Group>();
  private ghost: THREE.Group | null = null;
  private ghostSpin = 0;

  private accum = 0;
  private time = 0;
  private lastFrame = 0;
  private hitstopTimer = 0;
  private slowmoTimer = 0;
  private slowmoScale = 0.3;
  private timeScale = 1;

  private combo = 0;
  private comboTimer = 0;
  private pendingCoins = 0;
  private pendingPos = new THREE.Vector3();
  private pendingTimer = 0;
  private pendingCrit = false;
  private droppedOnce = false;
  private baseRadius = 6;
  private baseHeight = 6;

  constructor(private canvas: HTMLCanvasElement) {
    this.rig = new SceneRig(canvas);
    this.env = new Environment(this.rig.scene);
    this.fx = new FxManager(this.rig.scene);
    this.prog = Progression.load();
  }

  async init(): Promise<void> {
    await this.physics.init();
    this.createEnvironmentMap();
    this.createGround();
    this.debris = new DebrisSystem(this.rig.scene, this.physics);

    const hooks: TargetHooks = {
      onVoxelsDestroyed: (voxels, worldOf) => this.onVoxelsDestroyed(voxels, worldOf),
      onDebris: (pos, matIdx, scale) => this.spawnDebris(pos, matIdx, scale),
      onCollapsed: (voxels, worldOf) => this.onCollapsed(voxels, worldOf),
      onDamaged: () => undefined,
    };
    this.hooks = hooks;

    this.drops = new DropSystem({
      scene: this.rig.scene,
      physics: this.physics,
      fx: this.fx,
      debris: this.debris,
      camera: this.rig.director,
      audio: this.audio,
      progression: this.prog,
      getTarget: () => this.target,
      onImpact: (report) => this.onImpact(report),
      onGroundHit: (def, speed, pos) => this.onGroundHit(def, speed, pos),
    });

    this.rig.scene.add(this.aimGroup);
    this.buildAim();

    this.ui = new Ui(this.prog, this.rig.director, this.physics.RAPIER, {
      onSelectTool: (def) => this.selectTool(def),
      onBuyTool: (def) => this.buyTool(def),
      onDenied: () => {
        this.audio.denied();
        this.ui.hud.toast('Not enough coins', 'magenta');
      },
      onBuyUpgrade: (def) => {
        const ok = this.prog.buyUpgrade(def.id);
        if (ok) {
          this.audio.upgrade();
          this.ui.hud.toast(`${def.name} upgraded!`, 'cyan');
          this.refreshUpgradeHint();
        } else {
          this.audio.denied();
        }
        return ok;
      },
      onToggleSetting: (key, value) => this.applySetting(key, value),
      onReset: () => this.resetGame(),
      onClose: () => undefined,
    });

    if (import.meta.env.DEV) {
      this.dev = {
        grant: (coins: number) => {
          this.prog.addCoins(coins);
          this.prog.completed = TARGETS.length;
          for (const t of TOOLS) this.prog.unlocked.add(t.id);
          this.ui.dock.rebuild();
          this.ui.dock.refresh();
        },
        setTarget: (index: number) => {
          this.prog.targetIndex = Math.max(0, Math.min(TARGETS.length - 1, index));
          this.loadTarget(this.prog.targetIndex, true);
        },
        reload: () => this.loadTarget(this.prog.targetIndex, true),
        lowQuality: () => this.rig.forceLowQuality(),
        profile: (on: boolean) => {
          this.profiler.enabled = on;
          if (on) this.profiler.reset();
        },
        profileReport: () => {
          const r = this.profiler.report();
          const info = this.rig.renderer.info;
          return {
            ...r,
            render: {
              calls: info.render.calls,
              triangles: info.render.triangles,
              geometries: info.memory.geometries,
              textures: info.memory.textures,
              programs: info.programs?.length ?? 0,
            },
            counts: {
              drops: this.drops.activeCount,
              particles: this.fx.dust.count + this.fx.sparks.count,
              debris: this.debris.activeCount,
              colliders: this.physics.world.colliders.len(),
              bodies: this.physics.world.bodies.len(),
              voxels: this.target?.remaining ?? 0,
              enabledBodies: this.physics.enabledBodyCount(),
              collapsed: this.collapsedBlocks,
            },
          };
        },
        aimRandom: () => {
          const t = this.target;
          if (!t) return null;
          const g = t.grid;
          let maxY = 0;
          for (let i = 0; i < g.size; i++) {
            if (g.active[i] !== 1) continue;
            const x = i % g.sx;
            const rest = (i - x) / g.sx;
            const z = rest % g.sz;
            const y = (rest - z) / g.sz;
            if (y > maxY) maxY = y;
          }
          const cut = Math.max(1, maxY * 0.45);
          const cells: number[] = [];
          for (let i = 0; i < g.size; i++) {
            if (g.active[i] !== 1) continue;
            const x = i % g.sx;
            const rest = (i - x) / g.sx;
            const z = rest % g.sz;
            const y = (rest - z) / g.sz;
            if (y >= cut) cells.push(i);
          }
          if (!cells.length) return null;
          const cell = cells[(Math.random() * cells.length) | 0];
          const p = t.worldOf(cell, new THREE.Vector3());
          const s = this.rig.director.screenPosition(p, window.innerWidth, window.innerHeight);
          if (s.x < 70 || s.y < 100 || s.x > window.innerWidth - 250 || s.y > window.innerHeight - 140) {
            return null;
          }
          return { x: s.x, y: s.y };
        },
        dropInfo: () => this.drops.snapshot(),
        enabledBodies: () => this.physics.enabledBodyCount(),
        cameraInfo: () => {
          const d = this.rig.director.camera.getWorldDirection(new THREE.Vector3());
          return { x: Number(d.x.toFixed(3)), y: Number(d.y.toFixed(3)), z: Number(d.z.toFixed(3)) };
        },
        colliderInfo: () => {
          const t = this.target;
          if (!t) return null;
          const all = t.grid.buildCollisionBoxes(100000).length;
          const capped = t.grid.buildCollisionBoxes(760).length;
          return {
            needed: all,
            capped,
            live: t.colliderCount,
            rebuilds: t.rebuilds,
            lastDamage: t.lastDamage,
          };
        },
        ascii: (axis: 'front' | 'side' = 'front') => {
          const t = this.target;
          if (!t) return '';
          const g = t.grid;
          const glyphs = ' .:-=+*#%@';
          const lines: string[] = [];
          for (let y = g.sy - 1; y >= 0; y--) {
            let row = '';
            for (let x = 0; x < g.sx; x++) {
              let ch = ' ';
              if (axis === 'front') {
                for (let z = g.sz - 1; z >= 0; z--) {
                  if (g.isActiveAt(x, y, z)) {
                    ch = glyphs[Math.min(glyphs.length - 1, Math.floor(g.valueAt(g.index(x, y, z)) / 3))];
                    break;
                  }
                }
              } else {
                for (let z = 0; z < g.sz; z++) {
                  if (g.isActiveAt(x, y, z)) {
                    ch = glyphs[Math.min(glyphs.length - 1, Math.floor(g.valueAt(g.index(x, y, z)) / 3))];
                    break;
                  }
                }
              }
              row += ch;
            }
            if (row.trim().length) lines.push(row.replace(/\s+$/, ''));
          }
          return lines.join('\n');
        },
      };
    }

    this.applySettings();
    this.bindInput();
    this.loadTarget(this.prog.targetIndex, false);
    this.rig.director.introFlourish();
    this.ui.hud.setPrompt('CLICK TO DROP', 'Right-drag to orbit the arena');
    this.phase = 'playing';
    this.lastFrame = performance.now();
    requestAnimationFrame(this.frame);
  }

  private hooks!: TargetHooks;

  /** Dev-only cheat hooks; stays null in production builds. */
  dev: {
    grant(coins: number): void;
    setTarget(index: number): void;
    reload(): void;
    lowQuality(): void;
    profile(on: boolean): void;
    profileReport(): unknown;
    ascii(axis?: 'front' | 'side'): string;
    aimRandom(): { x: number; y: number } | null;
    dropInfo(): unknown;
    cameraInfo(): { x: number; y: number; z: number };
    enabledBodies(): number;
    colliderInfo(): unknown;
  } | null = null;

  get audioSystem(): AudioSystem {
    return this.audio;
  }

  /* ---------------------------------------------------------------- setup */

  /**
   * Bakes the sky into a PMREM probe so metals (gold, iron, crystal) reflect
   * the actual sunset instead of rendering black.
   */
  private createEnvironmentMap(): void {
    const pmrem = new THREE.PMREMGenerator(this.rig.renderer);
    const envScene = new THREE.Scene();
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(40, 24, 16),
      (this.env.sky.material as THREE.ShaderMaterial).clone(),
    );
    sky.material.side = THREE.FrontSide;
    envScene.add(sky);
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(6, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xffb87a }),
    );
    glow.position.set(16, 12, 13);
    envScene.add(glow);
    const target = pmrem.fromScene(envScene, 0.05);
    this.rig.scene.environment = target.texture;
    this.rig.scene.environmentIntensity = 0.62;
    pmrem.dispose();
    sky.geometry.dispose();
    glow.geometry.dispose();
  }

  /** Static collider for the arena deck so dropped objects land on it. */
  private createGround(): void {
    const R = this.physics.RAPIER;
    const half = this.env.platformHalf;
    const body = this.physics.world.createRigidBody(
      R.RigidBodyDesc.fixed().setTranslation(0, -1.3, 0),
    );
    const desc = R.ColliderDesc.cuboid(half, 1.3, half)
      .setFriction(0.92)
      .setRestitution(0.14)
      .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS);
    const col = this.physics.world.createCollider(desc, body);
    this.physics.registerCollider(col.handle, { kind: 'ground', ref: null });
  }

  private buildAim(): void {
    const geo = new THREE.RingGeometry(0.62, 0.86, 44);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffe08a,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
    });
    this.aimRing = new THREE.Mesh(geo, mat);
    this.aimRing.rotation.x = -Math.PI / 2;
    this.aimGroup.add(this.aimRing);

    const beamGeo = new THREE.CylinderGeometry(0.035, 0.11, 1, 10, 1, true);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xffe08a,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.aimBeam = new THREE.Mesh(beamGeo, beamMat);
    this.aimGroup.add(this.aimBeam);

    const inner = new THREE.Mesh(
      new THREE.RingGeometry(0.16, 0.26, 24),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    inner.rotation.x = -Math.PI / 2;
    inner.position.y = 0.005;
    this.aimRing.add(inner);
    this.aimGroup.visible = false;
  }

  private setGhost(def: ToolDef): void {
    let g = this.ghostCache.get(def.id);
    if (!g) {
      const built = this.drops.createPreview(def);
      g = built.group;
      const ghostMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(def.accent),
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      g.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) mesh.material = ghostMat;
      });
      this.ghostCache.set(def.id, g);
    }
    if (this.ghost && this.ghost !== g) this.ghost.visible = false;
    this.ghost = g;
    this.aimGroup.add(g);
  }

  private bindInput(): void {
    const el = this.canvas;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let activePointers = 0;
    let pinchLast = 0;

    const canInteract = () => this.phase === 'playing';

    el.addEventListener('contextmenu', (e) => e.preventDefault());

    el.addEventListener('pointerdown', (e) => {
      this.audio.resume();
      activePointers++;
      if (e.button === 2 || e.button === 1 || activePointers >= 2) {
        dragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        return;
      }
      if (e.button === 0 && canInteract()) {
        this.updateAim(e.clientX, e.clientY);
        this.drop();
      }
    });

    el.addEventListener('pointermove', (e) => {
      this.updateAim(e.clientX, e.clientY);
      if (dragging) {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        if (activePointers >= 2) {
          const dist = Math.hypot(dx, dy);
          const delta = dist - pinchLast;
          pinchLast = dist;
          this.rig.director.setDrag(delta * 0.04, 0);
        } else {
          this.rig.director.setDrag(dx, dy);
        }
      }
    });

    const endPointer = () => {
      activePointers = Math.max(0, activePointers - 1);
      if (activePointers === 0) dragging = false;
    };
    el.addEventListener('pointerup', endPointer);
    el.addEventListener('pointercancel', endPointer);
    el.addEventListener('pointerleave', () => {
      dragging = false;
      activePointers = 0;
    });

    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
      },
      { passive: false },
    );

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const n = Number(e.key);
      if (!Number.isNaN(n) && n >= 1 && n <= 9) {
        const visible = TOOLS.filter((t) => this.prog.toolVisible(t));
        const def = visible[n - 1];
        if (def) this.selectTool(def);
        return;
      }
      if (e.code === 'Space' && this.phase === 'playing') {
        e.preventDefault();
        this.drop();
      }
      if (e.key === 'Escape') this.ui.panels.close();
    });

    window.addEventListener('blur', () => {
      dragging = false;
      activePointers = 0;
    });
  }

  private applySetting(key: 'music' | 'sfx' | 'bloom', value: boolean): void {
    this.prog.setSetting(key, value);
    this.applySettings();
  }

  private applySettings(): void {
    this.audio.setMusic(this.prog.settings.music);
    this.audio.setSfx(this.prog.settings.sfx);
    this.rig.setBloom(this.prog.settings.bloom);
  }

  /* ---------------------------------------------------------------- target */

  private loadTarget(index: number, animate = true): void {
    if (this.target) {
      this.target.dispose();
      this.target = null;
    }
    this.drops.clear();
    this.fx.clear();
    const spec = TARGETS[clamp(index, 0, TARGETS.length - 1)];
    this.debris.configure(spec.voxelSize);

    const target = new Target(spec, this.physics, this.hooks, 1000 + index * 977);
    this.rig.scene.add(target.group);
    this.target = target;
    target.startSpawn(animate ? 1.6 : 0.6);

    const m = target.measure();
    this.baseRadius = m.radius;
    this.baseHeight = m.height;
    this.rig.director.frame({
      center: new THREE.Vector3(0, m.height * 0.5, 0),
      radius: m.radius * spec.framing,
      height: m.height * spec.framing,
    });
    this.rig.director.snapDistance();
    if (animate) {
      this.rig.director.cinematicSwing(0.7);
      this.ui.hud.toast(`${spec.name} — ${spec.subtitle}`, 'gold');
      this.ui.hud.setPrompt('CLICK TO DROP', 'Right-drag to orbit the arena');
      this.droppedOnce = false;
    }
    this.ui.hud.setTarget(spec.name, '0% destroyed', spec.accent);
    this.ui.hud.setProgress(0, target.remaining);
  }

  private onVoxelsDestroyed(
    voxels: DestroyedVoxel[],
    worldOf: (cell: number, out: THREE.Vector3) => THREE.Vector3,
  ): void {
    if (!voxels.length) return;
    this.prog.noteDestroyed(voxels.length);
    const tmp = new THREE.Vector3();
    let spent = 0;
    for (const v of voxels) {
      worldOf(v.cell, tmp);
      const material = MATERIAL_IDS[v.mat];
      const heavy = MATERIALS[material]?.fx === 'crystal' || MATERIALS[material]?.fx === 'mythic';
      if (spent < 5 || (heavy && Math.random() < 0.35) || Math.random() < 0.06) {
        this.fx.voxelBurst(tmp.x, tmp.y, tmp.z, v.mat, heavy ? 1.05 : 0.8, 1);
        spent++;
      }
      if (Math.random() < 0.055) {
        this.spawnDebris(
          tmp,
          v.mat,
          this.target ? this.target.voxelSize * rand(0.7, 1.1) : 0.5,
        );
      }
    }
  }

  /** Unsupported chunks that broke off on their own still pay coins. */
  collapsedBlocks = 0;

  private onCollapsed(
    voxels: DestroyedVoxel[],
    worldOf: (cell: number, out: THREE.Vector3) => THREE.Vector3,
  ): void {
    if (!voxels.length) return;
    let value = 0;
    const tmp = new THREE.Vector3();
    for (let i = 0; i < voxels.length; i++) {
      const v = voxels[i];
      value += v.value;
      if (i % 7 === 0) {
        worldOf(v.cell, tmp);
        this.fx.puff(tmp.x, tmp.y, tmp.z, v.mat, 3);
      }
    }
    const coins = Math.round(value * this.prog.coinMul * this.prog.tool.coinBonus);
    if (coins > 0) {
      this.prog.addCoins(coins);
      this.pendingCoins += coins;
      if (this.pendingTimer <= 0) this.pendingTimer = 0.2;
    }
    this.collapsedBlocks += voxels.length;
    this.prog.noteDestroyed(voxels.length);
    this.ui.hud.flashBar();
    if (this.target) {
      this.ui.hud.setProgress(this.target.percentDestroyed, this.target.remaining);
    }
    this.audio.impact('stone', 0.3);
  }

  private spawnDebris(pos: THREE.Vector3, matIdx: number, scale: number): void {
    const dir = new THREE.Vector3(pos.x, 0, pos.z);
    if (dir.lengthSq() < 0.001) dir.set(rand(-1, 1), 0, rand(-1, 1));
    dir.normalize();
    const impulse = new THREE.Vector3(
      dir.x * rand(1, 5),
      rand(2.5, 9),
      dir.z * rand(1, 5),
    );
    this.debris.spawn(pos, matIdx, scale, impulse);
  }

  /* -------------------------------------------------------------- gameplay */

  private selectTool(def: ToolDef): void {
    if (!this.prog.selectTool(def.id)) {
      if (this.prog.coins >= def.price) {
        this.buyTool(def);
      } else {
        this.audio.denied();
      }
      return;
    }
    this.audio.uiClick(true);
    this.setGhost(def);
    this.ui.dock.refresh();
    this.ui.hud.setPrompt(null);
    this.ui.hud.toast(`${def.name} — ${def.tagline}`, 'cyan');
  }

  private buyTool(def: ToolDef): void {
    if (this.prog.buyTool(def)) {
      this.audio.purchase();
      this.ui.hud.toast(`Unlocked ${def.name}!`, 'gold');
      this.ui.dock.rebuild();
      this.ui.dock.refresh();
      this.setGhost(def);
      this.ui.hud.setPrompt(null);
    } else {
      this.audio.denied();
    }
  }

  private drop(): void {
    if (this.phase !== 'playing' || !this.hasAim) return;
    const def = this.prog.tool;
    if (!this.drops.canDrop(def)) return;
    if (!this.drops.requestDrop(def, this.aim)) {
      this.audio.denied();
      return;
    }
    if (!this.droppedOnce) {
      this.droppedOnce = true;
      this.ui.hud.setPrompt(null);
    }
  }

  private onGroundHit(def: ToolDef, speed: number, pos: THREE.Vector3): void {
    if (speed > 15 && def.kind !== 'projectile') {
      this.rig.director.addShake(0.2);
    }
    void pos;
  }

  private onImpact(report: ImpactReport): void {
    if (this.phase !== 'playing') return;
    this.comboTimer = 1.15;
    this.combo = Math.min(99, this.combo + 1);
    const comboMul = 1 + Math.min(0.45, Math.max(0, this.combo - 1) * 0.06);
    const crit = report.crit || Math.random() < this.prog.critChance;
    const coins = Math.round(report.coins * comboMul * (crit ? 2 : 1));

    if (coins > 0) {
      this.prog.addCoins(coins);
      this.pendingCoins += coins;
      if (this.pendingTimer <= 0) this.pendingPos.copy(report.position);
      this.pendingCrit = this.pendingCrit || crit;
      if (this.pendingTimer <= 0) this.pendingTimer = 0.2;
      if (crit) {
        this.audio.coin(7);
        this.ui.hud.toast('CRITICAL IMPACT!', 'magenta');
      } else if (coins > 60) {
        this.audio.coin(2);
      }
    }

    if (report.voxels > 18) {
      this.hitstop(clamp(report.voxels / 900, 0.02, 0.075));
      this.rig.director.kickFov(clamp(report.voxels / 160, 0.4, 3.2));
    }
    if (this.combo >= 2) {
      this.ui.hud.combo(this.combo);
      this.ui.hud.bumpCoins();
    }
    this.ui.hud.flashBar();

    if (this.target) {
      const pct = this.target.percentDestroyed;
      this.ui.hud.setProgress(pct, this.target.remaining);
      if (this.target.isCleared) void this.finale();
    }
  }

  private hitstop(seconds: number): void {
    this.hitstopTimer = Math.max(this.hitstopTimer, seconds);
  }

  private slowmo(seconds: number, scale: number): void {
    this.slowmoTimer = Math.max(this.slowmoTimer, seconds);
    this.slowmoScale = scale;
  }

  private async finale(): Promise<void> {
    if (this.phase !== 'playing' || !this.target) return;
    this.phase = 'transitioning';
    const target = this.target;
    const bonus = Math.round(target.spec.completionBonus * this.prog.coinMul);

    this.slowmo(1.6, 0.28);
    this.rig.director.addShake(2.2);
    this.rig.director.kickFov(5.5);
    this.rig.director.cinematicSwing(1.1);
    this.audio.complete();

    const center = target.frameTarget().center;
    this.debris.beginBudget(46);
    const voxels = target.finaleBurst();
    this.fx.explosion(center.x, Math.max(2, center.y), center.z, 9);
    for (let i = 0; i < 14; i++) {
      const v = voxels[(Math.random() * voxels.length) | 0];
      if (!v) break;
      const wp = target.worldOf(v.cell, new THREE.Vector3());
      this.fx.voxelBurst(wp.x, wp.y, wp.z, v.mat, 1.5, 2.4);
      if (i < 6) this.spawnDebris(wp, v.mat, target.voxelSize * 1.4);
    }
    this.prog.addCoins(bonus);
    this.prog.noteDestroyed(voxels.length);
    this.ui.hud.setProgress(1, 0);
    this.ui.hud.showTransition(
      'TARGET CLEARED',
      target.spec.name,
      target.spec.subtitle,
      bonus,
    );
    this.ui.floats.text(
      new THREE.Vector3(center.x, center.y + 3, center.z),
      `+${formatNumber(bonus)}`,
      { color: '#ffe08a', size: 40, crit: true, duration: 1.8 },
    );

    await delay(3400);
    this.ui.hud.hideTransition();
    this.prog.completeTarget();
    this.refreshUpgradeHint();
    const nextIndex = this.prog.targetIndex;
    if (this.prog.completed >= TARGETS.length) {
      this.ui.hud.toast('Every target cleared. Run it again!', 'magenta');
    }
    this.loadTarget(nextIndex, true);
    this.phase = 'playing';
  }

  private refreshUpgradeHint(): void {
    const affordable = ['power', 'weight', 'height', 'greed', 'luck', 'multi'].some(
      (id) => this.prog.coins >= this.prog.costOf(id) && !this.prog.isMaxed(id),
    );
    this.ui.markUpgradesReady(affordable);
  }

  private resetGame(): void {
    this.prog.reset();
    this.loadTarget(0, true);
    this.ui.dock.rebuild();
    this.ui.dock.refresh();
    this.applySettings();
    this.ui.hud.toast('Progress reset', 'magenta');
  }

  /* ----------------------------------------------------------------- input */

  private updateAim(clientX: number, clientY: number): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.pointerNdc.set((clientX / w) * 2 - 1, -(clientY / h) * 2 + 1);
    this.aimDirty = true;
  }

  /**
   * Resolves the aim point. Runs at most once per frame: a voxel-grid DDA
   * against the target plus an analytic plane test against the deck, instead of
   * raycasting every instanced voxel on every pointer event.
   */
  private resolveAim(): void {
    if (!this.aimDirty) return;
    this.aimDirty = false;
    const cam = this.rig.director.camera;
    RAY_ORIGIN.setFromMatrixPosition(cam.matrixWorld);
    RAY_DIR.set(this.pointerNdc.x, this.pointerNdc.y, 0.5)
      .unproject(cam)
      .sub(RAY_ORIGIN)
      .normalize();

    let point: THREE.Vector3 | null = null;
    let onTarget = false;
    const target = this.target;
    if (target) {
      const hit = target.raycastVoxels(RAY_ORIGIN, RAY_DIR, 200);
      if (hit) {
        point = hit.point;
        onTarget = true;
      }
    }
    if (!point) {
      // analytic platform hit
      if (RAY_DIR.y < -1e-4) {
        const t = -RAY_ORIGIN.y / RAY_DIR.y;
        if (t > 0 && t < 300) {
          const px = RAY_ORIGIN.x + RAY_DIR.x * t;
          const pz = RAY_ORIGIN.z + RAY_DIR.z * t;
          const half = this.env.platformHalf - 0.8;
          if (Math.abs(px) < half && Math.abs(pz) < half) {
            point = AIM_SCRATCH.set(px, 0, pz);
          }
        }
      }
    }

    if (!point) {
      this.hasAim = false;
      this.aimGroup.visible = false;
      return;
    }
    this.hasAim = true;
    this.aim.copy(point);
    this.aimGroup.visible = true;
    this.aimGroup.position.set(point.x, point.y + 0.06, point.z);

    const ringMat = this.aimRing.material as THREE.MeshBasicMaterial;
    ringMat.color.setHex(onTarget ? 0xffe08a : 0x9ec6ff);
    const beamMat = this.aimBeam.material as THREE.MeshBasicMaterial;
    beamMat.color.copy(ringMat.color);
  }

  /* ------------------------------------------------------------------ loop */

  private frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const prof = this.profiler;
    const p0 = prof.begin();
    const raw = Math.min(0.084, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.time += raw;

    if (this.hitstopTimer > 0) {
      this.hitstopTimer -= raw;
      this.timeScale = 0.0;
    } else if (this.slowmoTimer > 0) {
      this.slowmoTimer -= raw;
      this.timeScale = this.slowmoScale;
    } else {
      this.timeScale = 1;
    }

    const dt = raw * this.timeScale;
    this.env.update(raw, this.time);
    const p1 = prof.begin();
    this.drops.update(dt < 0.0005 ? 0 : dt);
    const p2 = prof.begin();
    prof.end('drops', p1);

    this.accum += dt;
    let steps = 0;
    while (this.accum >= FIXED_DT && steps < MAX_STEPS) {
      this.physics.step(FIXED_DT);
      const pi = prof.begin();
      this.physics.drain((a, b) =>
        this.routeCollision(a.kind, a.ref, a.part, b.kind, b.ref, b.part),
      );
      prof.end('impacts', pi);
      this.accum -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_STEPS) this.accum = 0;
    const p3 = prof.begin();
    prof.end('physics', p2);

    if (this.target) this.target.update(dt);
    const p4 = prof.begin();
    prof.end('target', p3);
    this.debris.update(dt);
    const p5 = prof.begin();
    prof.end('debris', p4);
    this.fx.update(raw);
    prof.end('effects', p5);

    if (this.comboTimer > 0) {
      this.comboTimer -= raw;
      if (this.comboTimer <= 0) {
        this.combo = 0;
        this.ui.hud.combo(0);
      }
    }
    if (this.pendingTimer > 0) {
      this.pendingTimer -= raw;
      if (this.pendingTimer <= 0 && this.pendingCoins > 0) {
        this.ui.floatAt(
          this.pendingPos,
          `+${formatNumber(this.pendingCoins)}`,
          this.pendingCrit ? '#ffffff' : '#ffe08a',
          this.pendingCrit,
        );
        this.ui.floats.coins(this.pendingPos, this.ui.hud.coinRect, this.pendingCoins > 200 ? 6 : 3);
        this.pendingCoins = 0;
        this.pendingCrit = false;
      }
    }

    const p7 = prof.begin();
    this.resolveAim();
    this.animateAim(raw);
    if (this.target && this.phase === 'playing') {
      const m = this.target.measure();
      const f = this.target.spec.framing;
      this.rig.director.frame({
        center: new THREE.Vector3(0, m.height * 0.5, 0),
        radius: Math.max(m.radius, this.baseRadius * 0.55) * f,
        height: Math.max(m.height, this.baseHeight * 0.6) * f,
      });
    }
    this.rig.director.update(raw, this.time);
    this.ui.update(raw, this.prog, (id) => this.drops.cool(id));
    if (this.prog.coins !== this.lastAffordableCheck) {
      this.lastAffordableCheck = this.prog.coins;
      this.refreshUpgradeHint();
    }
    prof.end('ui', p7);
    const p8 = prof.begin();
    this.rig.render(raw);
    prof.end('render', p8);
    prof.end('frame', p0);
    prof.tick();
  };

  private lastAffordableCheck = -1;

  private routeCollision(
    aKind: string,
    aRef: unknown,
    aPart: 'head' | 'handle' | undefined,
    bKind: string,
    bRef: unknown,
    bPart: 'head' | 'handle' | undefined,
  ): void {
    if (aKind === 'tool') {
      this.drops.handleContact(aRef, bKind as OwnerKind, aPart);
    } else if (bKind === 'tool') {
      this.drops.handleContact(bRef, aKind as OwnerKind, bPart);
    }
  }

  private animateAim(dt: number): void {
    if (!this.hasAim) return;
    const t = this.time;
    const pulse = 1 + Math.sin(t * 4.4) * 0.06;
    this.aimRing.scale.setScalar(pulse);
    const beam = this.aimBeam;
    const height = this.prog.tool.spawnHeight * this.prog.heightMul;
    beam.scale.set(1, height, 1);
    beam.position.y = height / 2;
    const beamMat = beam.material as THREE.MeshBasicMaterial;
    beamMat.opacity = 0.16 + Math.sin(t * 3.1) * 0.05;

    if (this.ghost) {
      this.ghostSpin += dt * 0.7;
      const def = this.prog.tool;
      const h = def.spawnHeight * this.prog.heightMul;
      this.ghost.visible = true;
      this.ghost.position.set(0, h + Math.sin(t * 1.4) * 0.35, 0);
      this.ghost.rotation.set(0.35, this.ghostSpin, -0.2);
      const k = 1 + Math.sin(t * 2.2) * 0.03;
      this.ghost.scale.setScalar(k);
    }
  }

  get buildNumber(): string {
    return BUILD_NUMBER;
  }

  /** Screen position of the current target's centre of mass (dev/QA harness). */
  aimTargetScreen(offset = 0.62): { x: number; y: number } | null {
    if (!this.target) return null;
    const m = this.target.measure();
    const p = new THREE.Vector3(0, m.height * offset, 0);
    const s = this.rig.director.screenPosition(p, window.innerWidth, window.innerHeight);
    return { x: s.x, y: s.y };
  }

  /** Live drop statistics (dev/QA harness). */
  get dropStats(): Record<string, number> {
    return { ...this.drops.stats };
  }

  /** Remaining voxels in the current target (dev/QA harness). */
  get remainingVoxels(): number {
    return this.target?.remaining ?? 0;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
