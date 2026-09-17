import * as THREE from 'three';
import { rand } from '../utils/rng';

interface Shard {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  e: THREE.Euler;
  ax: number;
  ay: number;
  az: number;
  life: number;
  maxLife: number;
  size: number;
  scaleY: number;
}

export class ShardPool {
  readonly mesh: THREE.InstancedMesh;
  private shards: Shard[] = [];
  private max: number;
  private dummy = new THREE.Object3D();
  private tmpColor = new THREE.Color();

  constructor(scene: THREE.Scene, max = 420) {
    this.max = max;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({
      roughness: 0.75,
      metalness: 0.15,
      vertexColors: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.count = 0;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
  }

  private dropAt(i: number): void {
    const last = this.shards.length - 1;
    const ca = this.mesh.instanceColor!.array as Float32Array;
    if (i !== last) {
      this.shards[i] = this.shards[last];
      ca[i * 3] = ca[last * 3];
      ca[i * 3 + 1] = ca[last * 3 + 1];
      ca[i * 3 + 2] = ca[last * 3 + 2];
    }
    this.shards.pop();
  }

  spawn(
    x: number,
    y: number,
    z: number,
    count: number,
    colorHex: number,
    speed = 6,
    size = 0.22,
    life = 1.6,
    upBias = 3,
  ): void {
    for (let i = 0; i < count; i++) {
      if (this.shards.length >= this.max) this.dropAt(0);
      const s = size * rand(0.5, 1.45);
      this.shards.push({
        x: x + rand(-0.2, 0.2),
        y: y + rand(-0.2, 0.2),
        z: z + rand(-0.2, 0.2),
        vx: rand(-speed, speed),
        vy: rand(0.2, 1) * upBias,
        vz: rand(-speed, speed),
        e: new THREE.Euler(rand(0, 6.28), rand(0, 6.28), rand(0, 6.28)),
        ax: rand(-9, 9),
        ay: rand(-9, 9),
        az: rand(-9, 9),
        life: life * rand(0.7, 1.3),
        maxLife: life,
        size: s,
        scaleY: rand(0.55, 1.6),
      });
      const c = this.tmpColor.setHex(colorHex);
      const ca = this.mesh.instanceColor!.array as Float32Array;
      const idx = this.shards.length - 1;
      ca[idx * 3] = c.r * rand(0.8, 1.15);
      ca[idx * 3 + 1] = c.g * rand(0.8, 1.15);
      ca[idx * 3 + 2] = c.b * rand(0.8, 1.15);
    }
    this.mesh.instanceColor!.needsUpdate = true;
  }

  update(dt: number): void {
    const list = this.shards;
    const d = this.dummy;
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.dropAt(i);
        continue;
      }
      s.vy -= 30 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
      if (s.y < 0.05) {
        s.y = 0.05;
        s.vy = Math.abs(s.vy) * 0.28;
        s.vx *= 0.68;
        s.vz *= 0.68;
        s.ax *= 0.6;
        s.az *= 0.6;
      }
      s.e.x += s.ax * dt;
      s.e.y += s.ay * dt;
      s.e.z += s.az * dt;
      const t = s.life / s.maxLife;
      const scale = t < 0.25 ? s.size * (t / 0.25) : s.size;
      d.position.set(s.x, s.y, s.z);
      d.rotation.copy(s.e);
      d.scale.set(scale, scale * s.scaleY, scale);
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
    }
    this.mesh.count = list.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
  }

  clear(): void {
    this.shards.length = 0;
    this.mesh.count = 0;
  }
}
