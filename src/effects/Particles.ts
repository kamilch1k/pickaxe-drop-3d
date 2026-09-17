import * as THREE from 'three';
import { rand } from '../utils/rng';

export interface EmitConfig {
  x: number;
  y: number;
  z: number;
  count: number;
  /** direction cone axis */
  dir?: THREE.Vector3;
  /** 0 = perfectly along dir, 1 = full sphere */
  spread?: number;
  speedMin?: number;
  speedMax?: number;
  sizeMin?: number;
  sizeMax?: number;
  lifeMin?: number;
  lifeMax?: number;
  gravity?: number;
  drag?: number;
  colors: THREE.Color[] | number[];
  /** offset the spawn position randomly inside this radius */
  radius?: number;
  alpha?: number;
}

const V = new THREE.Vector3();

export class ParticlePool {
  readonly points: THREE.Points;
  readonly max: number;
  private geom: THREE.BufferGeometry;
  private posA: THREE.BufferAttribute;
  private colA: THREE.BufferAttribute;
  private sizeA: THREE.BufferAttribute;
  private alphaA: THREE.BufferAttribute;

  private px: Float32Array;
  private py: Float32Array;
  private pz: Float32Array;
  private vx: Float32Array;
  private vy: Float32Array;
  private vz: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private baseAlpha: Float32Array;

  private cursor = 0;
  count = 0;

  constructor(
    max: number,
    texture: THREE.Texture,
    blending: THREE.Blending,
    depthWrite = false,
  ) {
    this.max = max;
    this.px = new Float32Array(max);
    this.py = new Float32Array(max);
    this.pz = new Float32Array(max);
    this.vx = new Float32Array(max);
    this.vy = new Float32Array(max);
    this.vz = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.baseAlpha = new Float32Array(max);

    this.geom = new THREE.BufferGeometry();
    const positions = new Float32Array(max * 3);
    const colors = new Float32Array(max * 3);
    const sizes = new Float32Array(max);
    const alphas = new Float32Array(max);
    this.posA = new THREE.BufferAttribute(positions, 3);
    this.colA = new THREE.BufferAttribute(colors, 3);
    this.sizeA = new THREE.BufferAttribute(sizes, 1);
    this.alphaA = new THREE.BufferAttribute(alphas, 1);
    this.posA.setUsage(THREE.DynamicDrawUsage);
    this.colA.setUsage(THREE.DynamicDrawUsage);
    this.sizeA.setUsage(THREE.DynamicDrawUsage);
    this.alphaA.setUsage(THREE.DynamicDrawUsage);
    this.geom.setAttribute('position', this.posA);
    this.geom.setAttribute('aColor', this.colA);
    this.geom.setAttribute('aSize', this.sizeA);
    this.geom.setAttribute('aAlpha', this.alphaA);
    this.geom.setDrawRange(0, 0);
    this.geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: texture },
        uScale: { value: 620 },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aAlpha;
        varying vec3 vColor;
        varying float vAlpha;
        uniform float uScale;
        void main() {
          vColor = aColor;
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = max(1.0, aSize * (uScale / max(0.001, -mv.z)));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec4 tex = texture2D(uMap, gl_PointCoord);
          float a = tex.a * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor * tex.rgb, a);
        }
      `,
      transparent: true,
      blending,
      depthWrite,
      depthTest: true,
    });

    this.points = new THREE.Points(this.geom, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
  }

  emit(cfg: EmitConfig): void {
    const dir = cfg.dir ?? V.set(0, 1, 0).clone();
    const spread = cfg.spread ?? 0.4;
    const speedMin = cfg.speedMin ?? 2;
    const speedMax = cfg.speedMax ?? 6;
    const sizeMin = cfg.sizeMin ?? 0.06;
    const sizeMax = cfg.sizeMax ?? 0.16;
    const lifeMin = cfg.lifeMin ?? 0.4;
    const lifeMax = cfg.lifeMax ?? 1;
    const gravity = cfg.gravity ?? -22;
    const drag = cfg.drag ?? 0.6;
    const radius = cfg.radius ?? 0;
    const colors = cfg.colors;
    const alpha = cfg.alpha ?? 1;

    for (let n = 0; n < cfg.count; n++) {
      let i: number;
      if (this.count < this.max) {
        i = this.count++;
      } else {
        this.cursor = (this.cursor + 1) % this.max;
        i = this.cursor;
      }
      const sp = rand(speedMin, speedMax);
      const sx = rand(-1, 1) * spread;
      const sy = rand(-1, 1) * spread;
      const sz = rand(-1, 1) * spread;
      let ux = dir.x + sx;
      let uy = dir.y + sy;
      let uz = dir.z + sz;
      const len = Math.hypot(ux, uy, uz) || 1;
      ux /= len;
      uy /= len;
      uz /= len;
      const rx = radius > 0 ? rand(-radius, radius) : 0;
      const ry = radius > 0 ? rand(-radius, radius) : 0;
      const rz = radius > 0 ? rand(-radius, radius) : 0;
      this.px[i] = cfg.x + rx;
      this.py[i] = cfg.y + ry;
      this.pz[i] = cfg.z + rz;
      this.vx[i] = ux * sp;
      this.vy[i] = uy * sp;
      this.vz[i] = uz * sp;
      const lf = rand(lifeMin, lifeMax);
      this.life[i] = lf;
      this.maxLife[i] = lf;
      this.size[i] = rand(sizeMin, sizeMax);
      this.grav[i] = gravity;
      this.drag[i] = drag;
      this.baseAlpha[i] = alpha;

      const c = colors[(Math.random() * colors.length) | 0];
      const col = c instanceof THREE.Color ? c : new THREE.Color(c);
      const jitter = rand(0.85, 1.15);
      const ca = this.colA.array as Float32Array;
      ca[i * 3] = Math.min(1, col.r * jitter);
      ca[i * 3 + 1] = Math.min(1, col.g * jitter);
      ca[i * 3 + 2] = Math.min(1, col.b * jitter);
    }
  }

  update(dt: number): void {
    const pa = this.posA.array as Float32Array;
    const ca = this.sizeA.array as Float32Array;
    const aa = this.alphaA.array as Float32Array;
    for (let i = 0; i < this.count; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const last = this.count - 1;
        if (i !== last) {
          this.px[i] = this.px[last];
          this.py[i] = this.py[last];
          this.pz[i] = this.pz[last];
          this.vx[i] = this.vx[last];
          this.vy[i] = this.vy[last];
          this.vz[i] = this.vz[last];
          this.life[i] = this.life[last];
          this.maxLife[i] = this.maxLife[last];
          this.size[i] = this.size[last];
          this.grav[i] = this.grav[last];
          this.drag[i] = this.drag[last];
          this.baseAlpha[i] = this.baseAlpha[last];
          const c3 = this.colA.array as Float32Array;
          c3[i * 3] = c3[last * 3];
          c3[i * 3 + 1] = c3[last * 3 + 1];
          c3[i * 3 + 2] = c3[last * 3 + 2];
        }
        this.count--;
        i--;
        continue;
      }
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vx[i] *= d;
      this.vz[i] *= d;
      this.vy[i] = this.vy[i] * d + this.grav[i] * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      if (this.py[i] < 0.06) {
        this.py[i] = 0.06;
        this.vy[i] *= -0.24;
        this.vx[i] *= 0.6;
        this.vz[i] *= 0.6;
      }
      const t = this.life[i] / this.maxLife[i];
      pa[i * 3] = this.px[i];
      pa[i * 3 + 1] = this.py[i];
      pa[i * 3 + 2] = this.pz[i];
      ca[i] = this.size[i] * (0.45 + t * 0.75);
      aa[i] = this.baseAlpha[i] * Math.min(1, t * 2.6);
    }
    this.posA.needsUpdate = true;
    this.sizeA.needsUpdate = true;
    this.alphaA.needsUpdate = true;
    this.colA.needsUpdate = true;
    this.geom.setDrawRange(0, this.count);
  }

  clear(): void {
    this.count = 0;
    this.geom.setDrawRange(0, 0);
  }
}
