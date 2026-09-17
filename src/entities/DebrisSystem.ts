import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { MATERIAL_IDS, MATERIALS } from '../content/materials';
import { voxelMaterial } from '../scene/Textures';
import { rand } from '../utils/rng';

interface Debris {
  body: RAPIER.RigidBody;
  mesh: THREE.Mesh;
  matIdx: number;
  life: number;
  maxLife: number;
  size: number;
  spin: THREE.Vector3;
  spinAxis: THREE.Vector3;
  active: boolean;
}

const GEO = new THREE.BoxGeometry(1, 1, 1);

export class DebrisSystem {
  private pool: Debris[] = [];
  private cursor = 0;
  private voxelSize = 0.65;
  private max: number;
  private spawnBudget = 0;

  constructor(
    private scene: THREE.Scene,
    private physics: PhysicsWorld,
    max = 74,
  ) {
    this.max = max;
  }

  /** Rebuilds the pool when the target's voxel scale changes. */
  configure(voxelSize: number): void {
    if (Math.abs(voxelSize - this.voxelSize) < 0.001 && this.pool.length === this.max) return;
    this.clear();
    this.voxelSize = voxelSize;
    const desc = this.physics.RAPIER.ColliderDesc;
    for (let i = 0; i < this.max; i++) {
      const body = this.physics.world.createRigidBody(
        this.physics.RAPIER.RigidBodyDesc.dynamic()
          .setLinearDamping(0.12)
          .setAngularDamping(0.24)
          .setCcdEnabled(false)
          .setEnabled(false),
      );
      const col = desc
        .cuboid(voxelSize / 2, voxelSize / 2, voxelSize / 2)
        .setDensity(320)
        .setFriction(0.85)
        .setRestitution(0.18);
      const c = this.physics.world.createCollider(col, body);
      this.physics.registerCollider(c.handle, { kind: 'debris', ref: null });
      const mesh = new THREE.Mesh(GEO, voxelMaterial(MATERIALS.stone));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.visible = false;
      this.scene.add(mesh);
      this.pool.push({
        body,
        mesh,
        matIdx: 0,
        life: 0,
        maxLife: 1,
        size: voxelSize,
        spin: new THREE.Vector3(),
        spinAxis: new THREE.Vector3(0, 1, 0),
        active: false,
      });
    }
  }

  get activeCount(): number {
    return this.pool.reduce((a, b) => a + (b.active ? 1 : 0), 0);
  }

  spawn(pos: THREE.Vector3, matIdx: number, size: number, impulse: THREE.Vector3): void {
    if (this.spawnBudget-- <= 0) return;
    let d: Debris | null = null;
    for (let i = 0; i < this.pool.length; i++) {
      const idx = (this.cursor + i) % this.pool.length;
      if (!this.pool[idx].active) {
        d = this.pool[idx];
        this.cursor = (idx + 1) % this.pool.length;
        break;
      }
    }
    if (!d) {
      d = this.pool[this.cursor];
      this.cursor = (this.cursor + 1) % this.pool.length;
    }
    const def = MATERIALS[MATERIAL_IDS[matIdx]] ?? MATERIALS.stone;
    if (d.matIdx !== matIdx) {
      d.mesh.material = voxelMaterial(def);
      d.matIdx = matIdx;
    }
    const s = size * rand(0.75, 1.35);
    d.size = s;
    d.mesh.scale.set(s * rand(0.9, 1.1), s * rand(0.7, 1.2), s * rand(0.9, 1.1));
    d.mesh.position.copy(pos);
    d.mesh.quaternion.setFromEuler(
      new THREE.Euler(rand(0, 6.28), rand(0, 6.28), rand(0, 6.28)),
    );
    d.mesh.visible = true;
    d.active = true;
    d.life = rand(3.4, 6.2);
    d.maxLife = d.life;
    d.spin.set(rand(-9, 9), rand(-9, 9), rand(-9, 9));

    d.body.setEnabled(true);
    d.body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
    d.body.setRotation(
      { x: d.mesh.quaternion.x, y: d.mesh.quaternion.y, z: d.mesh.quaternion.z, w: d.mesh.quaternion.w },
      true,
    );
    d.body.setLinvel({ x: impulse.x, y: impulse.y, z: impulse.z }, true);
    d.body.setAngvel({ x: rand(-7, 7), y: rand(-7, 7), z: rand(-7, 7) }, true);
  }

  beginBudget(n: number): void {
    this.spawnBudget = n;
  }

  update(dt: number): void {
    for (const d of this.pool) {
      if (!d.active) continue;
      d.life -= dt;
      if (d.life <= 0 || d.mesh.position.y < -26) {
        d.active = false;
        d.mesh.visible = false;
        d.body.setEnabled(false);
        continue;
      }
      const t = d.body.translation();
      const r = d.body.rotation();
      d.mesh.position.set(t.x, t.y, t.z);
      d.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      if (d.life < 0.5) {
        const k = Math.max(0.001, d.life / 0.5);
        d.mesh.scale.setScalar(d.size * k);
      }
    }
  }

  clear(): void {
    for (const d of this.pool) {
      this.physics.removeBody(d.body);
      d.mesh.removeFromParent();
    }
    this.pool.length = 0;
  }

}
