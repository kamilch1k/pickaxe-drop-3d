import * as THREE from 'three';
import { ringTexture } from '../scene/Textures';
import { clamp, easeOutCubic } from '../utils/math';

interface Ring {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  from: number;
  to: number;
  active: boolean;
}

interface Flash {
  light: THREE.PointLight;
  life: number;
  maxLife: number;
  peak: number;
  active: boolean;
}

export class ImpactFx {
  private rings: Ring[] = [];
  private flashes: Flash[] = [];

  constructor(scene: THREE.Scene) {
    const geo = new THREE.PlaneGeometry(2, 2);
    const tex = ringTexture();
    for (let i = 0; i < 14; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        opacity: 0,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      mesh.renderOrder = 3;
      scene.add(mesh);
      this.rings.push({ mesh, life: 0, maxLife: 1, from: 0, to: 1, active: false });
    }
    for (let i = 0; i < 4; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 24, 2);
      light.visible = false;
      scene.add(light);
      this.flashes.push({ light, life: 0, maxLife: 0.16, peak: 0, active: false });
    }
  }

  private takeRing(): Ring | null {
    for (const r of this.rings) if (!r.active) return r;
    return null;
  }

  shockwave(
    x: number,
    y: number,
    z: number,
    radius: number,
    color: number,
    strength = 1,
    duration = 0.55,
  ): void {
    const r = this.takeRing();
    if (!r) return;
    r.active = true;
    r.life = duration;
    r.maxLife = duration;
    r.from = radius * 0.28;
    r.to = radius * (1.05 + 0.12 * strength);
    r.mesh.position.set(x, y + 0.06, z);
    r.mesh.visible = true;
    const mat = r.mesh.material as THREE.MeshBasicMaterial;
    mat.color.setHex(color);
    mat.opacity = 0.9 * strength;
    r.mesh.scale.setScalar(r.from);
  }

  dustRing(
    x: number,
    y: number,
    z: number,
    radius: number,
    color: number,
    duration = 0.85,
  ): void {
    const r = this.takeRing();
    if (!r) return;
    r.active = true;
    r.life = duration;
    r.maxLife = duration;
    r.from = radius * 0.15;
    r.to = radius * 1.5;
    r.mesh.position.set(x, y + 0.12, z);
    r.mesh.visible = true;
    const mat = r.mesh.material as THREE.MeshBasicMaterial;
    mat.color.setHex(color);
    mat.opacity = 0.42;
    r.mesh.scale.setScalar(r.from);
  }

  flash(x: number, y: number, z: number, color: number, intensity: number, distance = 26): void {
    let f = this.flashes.find((v) => !v.active);
    if (!f) f = this.flashes[0];
    f.active = true;
    f.life = f.maxLife;
    f.peak = intensity;
    f.light.position.set(x, y, z);
    f.light.color.setHex(color);
    f.light.distance = distance;
    f.light.intensity = intensity;
    f.light.visible = true;
  }

  update(dt: number): void {
    for (const r of this.rings) {
      if (!r.active) continue;
      r.life -= dt;
      if (r.life <= 0) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      const t = 1 - r.life / r.maxLife;
      const e = easeOutCubic(t);
      const scale = r.from + (r.to - r.from) * e;
      r.mesh.scale.setScalar(scale);
      const mat = r.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = (1 - t) * (1 - t) * 0.95;
    }
    for (const f of this.flashes) {
      if (!f.active) continue;
      f.life -= dt;
      if (f.life <= 0) {
        f.active = false;
        f.light.visible = false;
        f.light.intensity = 0;
        continue;
      }
      const t = clamp(f.life / f.maxLife, 0, 1);
      f.light.intensity = f.peak * t * t;
    }
  }

  clear(): void {
    for (const r of this.rings) {
      r.active = false;
      r.mesh.visible = false;
    }
    for (const f of this.flashes) {
      f.active = false;
      f.light.visible = false;
    }
  }
}
