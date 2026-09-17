import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { cloudTexture, platformTexture } from './Textures';
import { Rng } from '../utils/rng';

const rng = new Rng(88112);

function skyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: new THREE.Color('#0a1040') },
      uMid: { value: new THREE.Color('#3a3270') },
      uLow: { value: new THREE.Color('#1e1d3c') },
      uHorizon: { value: new THREE.Color('#ffb07a') },
      uSun: { value: new THREE.Vector3(0.62, 0.34, 0.5).normalize() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uLow; uniform vec3 uHorizon;
      uniform vec3 uSun;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 col = mix(uLow, uMid, smoothstep(0.28, 0.62, h));
        col = mix(col, uTop, smoothstep(0.6, 0.94, h));
        float band = exp(-pow((h - 0.53) * 8.0, 2.0));
        col = mix(col, uHorizon, band * 0.5);
        float sd = max(dot(d, uSun), 0.0);
        col += vec3(1.0, 0.74, 0.44) * pow(sd, 70.0) * 1.5;
        col += vec3(1.0, 0.52, 0.3) * pow(sd, 7.0) * 0.3;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

function makeStars(): THREE.Points {
  const count = 420;
  const pos = new Float32Array(count * 3);
  const size = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const theta = rng.range(0, Math.PI * 2);
    const phi = Math.acos(rng.range(0.05, 0.85));
    const r = 460;
    pos[i * 3] = Math.sin(phi) * Math.cos(theta) * r;
    pos[i * 3 + 1] = Math.cos(phi) * r;
    pos[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * r;
    size[i] = rng.range(1.4, 4.2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: `attribute float aSize; varying float vS; void main(){ vS = aSize; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = aSize; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `varying float vS; void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; float a = smoothstep(0.5, 0.05, d); gl_FragColor = vec4(vec3(1.0, 0.96, 0.9), a * 0.85); }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const p = new THREE.Points(geo, mat);
  p.frustumCulled = false;
  return p;
}

function makeIsland(radius: number, tall: boolean): THREE.Group {
  const g = new THREE.Group();
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x4a5268, roughness: 0.95 });
  const grassMat = new THREE.MeshStandardMaterial({ color: 0x43794c, roughness: 0.92 });
  const grassMat2 = new THREE.MeshStandardMaterial({ color: 0x396a42, roughness: 0.92 });

  const top = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.94, 1.6, 7, 1), grassMat);
  top.position.y = 0.4;
  g.add(top);

  const rim = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.96, radius * 0.8, 1.2, 7, 1), grassMat2);
  rim.position.y = -0.6;
  g.add(rim);

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.82, radius * (tall ? 0.06 : 0.18), radius * (tall ? 3.4 : 1.7), 7, 2),
    rockMat,
  );
  body.position.y = -radius * (tall ? 1.7 : 1.0);
  g.add(body);

  for (let i = 0; i < 3; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(radius * 0.3, radius * 0.75);
    const rock = new THREE.Mesh(
      new THREE.ConeGeometry(rng.range(0.6, 1.6), rng.range(1.4, 3.4), 5),
      rockMat,
    );
    rock.position.set(Math.cos(a) * d, rng.range(0.6, 1.6), Math.sin(a) * d);
    rock.rotation.z = rng.range(-0.3, 0.3);
    g.add(rock);
  }
  return g;
}

export class Environment {
  readonly group = new THREE.Group();
  readonly platformTop = 0;
  readonly platformHalf: number;
  deck!: THREE.Mesh;
  sky!: THREE.Mesh;
  private clouds: THREE.Mesh[] = [];
  private floats: { obj: THREE.Object3D; baseY: number; phase: number; amp: number }[] = [];
  private lanternPulse: THREE.Mesh[] = [];

  constructor(scene: THREE.Scene) {
    scene.background = new THREE.Color('#1a1836');
    scene.fog = new THREE.FogExp2(new THREE.Color('#3a3270'), 0.0058);

    const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 20), skyMaterial());
    sky.frustumCulled = false;
    sky.name = 'sky';
    this.sky = sky;
    this.group.add(sky);
    const stars = makeStars();
    this.group.add(stars);

    /* ----------------------------------------------------------- platform */
    const stoneMat = new THREE.MeshStandardMaterial({
      map: platformTexture(),
      roughness: 0.9,
      metalness: 0.05,
      color: 0xffffff,
    });
    const PLAT = 16;
    this.platformHalf = PLAT;
    const deck = new THREE.Mesh(new RoundedBoxGeometry(PLAT * 2, 2.6, PLAT * 2, 3, 0.55), stoneMat);
    deck.position.y = -1.3;
    deck.receiveShadow = true;
    deck.castShadow = true;
    deck.name = 'arena-deck';
    this.deck = deck;
    this.group.add(deck);

    const under = new THREE.Mesh(
      new THREE.CylinderGeometry(PLAT * 1.18, PLAT * 0.28, 22, 9, 2),
      new THREE.MeshStandardMaterial({ color: 0x39394f, roughness: 0.98 }),
    );
    const up = new THREE.CylinderGeometry(PLAT * 1.18, PLAT * 0.28, 22, 9, 2);
    up.rotateY(Math.PI / 9);
    under.geometry = up;
    under.position.y = -13.6;
    this.group.add(under);

    const tip = new THREE.Mesh(
      new THREE.ConeGeometry(PLAT * 0.3, 12, 9),
      new THREE.MeshStandardMaterial({ color: 0x2f2f42, roughness: 1 }),
    );
    tip.position.y = -30;
    tip.rotation.x = Math.PI;
    this.group.add(tip);

    /* ------------------------------------------------------ deck trims */
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.85 });
    const woodMat2 = new THREE.MeshStandardMaterial({ color: 0x815a38, roughness: 0.85 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x8b949f, roughness: 0.35, metalness: 0.9 });
    const lanternMat = new THREE.MeshStandardMaterial({
      color: 0xffd27a,
      emissive: new THREE.Color(0xffb347),
      emissiveIntensity: 2.4,
      roughness: 0.4,
    });

    // corner posts with lanterns
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      const px = sx * (PLAT - 2.4);
      const pz = sz * (PLAT - 2.4);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.55, 4.6, 0.55), woodMat);
      post.position.set(px, 2.3, pz);
      this.group.add(post);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 1.5), woodMat2);
      arm.position.set(px, 4.5, pz - sz * 0.7);
      this.group.add(arm);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.8, 0.62), lanternMat);
      lamp.position.set(px, 4.05, pz - sz * 1.25);
      this.group.add(lamp);
      this.lanternPulse.push(lamp);
    }

    // scattered crates + barrels (environmental storytelling)
    for (let i = 0; i < 7; i++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(PLAT * 0.72, PLAT * 0.86);
      const s = rng.range(1.1, 1.9);
      const crate = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), rng.chance(0.5) ? woodMat : woodMat2);
      crate.position.set(Math.cos(a) * d, s / 2, Math.sin(a) * d);
      crate.rotation.y = rng.range(0, Math.PI);
      crate.receiveShadow = true;
      this.group.add(crate);
      if (rng.chance(0.6)) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(s * 1.02, s * 0.16, s * 1.02), metalMat);
        band.position.copy(crate.position);
        band.rotation.copy(crate.rotation);
        this.group.add(band);
      }
    }

    // glowing crystals embedded around the rim
    const gemColors = [0x6ee7ff, 0xff5f9e, 0x8affc1, 0xffd75e];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + rng.range(-0.1, 0.1);
      const d = PLAT * rng.range(0.9, 0.99);
      const h = rng.range(1.1, 3.2);
      const col = gemColors[i % gemColors.length];
      const gem = new THREE.Mesh(
        new THREE.ConeGeometry(rng.range(0.3, 0.6), h, 5),
        new THREE.MeshStandardMaterial({
          color: col,
          emissive: new THREE.Color(col),
          emissiveIntensity: 0.45,
          roughness: 0.15,
          metalness: 0.3,
          transparent: true,
          opacity: 0.95,
        }),
      );
      gem.position.set(Math.cos(a) * d, h / 2 - 0.2, Math.sin(a) * d);
      gem.rotation.z = rng.range(-0.25, 0.25);
      gem.rotation.x = rng.range(-0.25, 0.25);
      this.group.add(gem);
      this.floats.push({ obj: gem, baseY: gem.position.y, phase: rng.range(0, 6.28), amp: 0.06 });
    }

    /* --------------------------------------------------------- skyline */
    for (let i = 0; i < 14; i++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(40, 108);
      const island = makeIsland(rng.range(4.5, 14), rng.chance(0.45));
      island.position.set(Math.cos(a) * d, rng.range(-34, -2), Math.sin(a) * d);
      island.rotation.y = rng.range(0, 6.28);
      this.group.add(island);
      this.floats.push({
        obj: island,
        baseY: island.position.y,
        phase: rng.range(0, 6.28),
        amp: rng.range(0.6, 1.8),
      });
    }

    /* ---------------------------------------------------------- clouds */
    const cloudMat = new THREE.MeshBasicMaterial({
      map: cloudTexture(),
      transparent: true,
      depthWrite: false,
      opacity: 0.3,
      fog: true,
      color: new THREE.Color('#c9b4ff'),
      side: THREE.DoubleSide,
    });
    for (let i = 0; i < 14; i++) {
      const size = rng.range(22, 52);
      const cloud = new THREE.Mesh(new THREE.PlaneGeometry(size, size * 0.5), cloudMat);
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(55, 150);
      cloud.position.set(Math.cos(a) * d, rng.range(-16, 14), Math.sin(a) * d);
      cloud.lookAt(0, cloud.position.y, 0);
      this.clouds.push(cloud);
      this.group.add(cloud);
    }

    scene.add(this.group);
  }

  update(dt: number, time: number): void {
    for (const f of this.floats) {
      f.obj.position.y = f.baseY + Math.sin(time * 0.55 + f.phase) * f.amp;
    }
    for (let i = 0; i < this.clouds.length; i++) {
      const c = this.clouds[i];
      c.position.x += dt * (0.35 + i * 0.02);
      if (c.position.x > 260) c.position.x = -260;
    }
    const pulse = 2.1 + Math.sin(time * 2.4) * 0.35;
    for (const l of this.lanternPulse) {
      (l.material as THREE.MeshStandardMaterial).emissiveIntensity = pulse;
    }
  }
}
