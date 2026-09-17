import * as THREE from 'three';
import { Rng } from '../utils/rng';
import type { VoxelMaterialDef } from '../content/materials';

function makeCanvas(w: number, h = w): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  return { c, g };
}

const colorCache = new Map<string, string>();

function src(defaults: string, rng: Rng, spread = 10): string {
  const key = defaults + '|' + Math.floor(rng.next() * 1000);
  const hit = colorCache.get(key);
  if (hit) return hit;
  const c = new THREE.Color(defaults);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(
    hsl.h + (rng.next() - 0.5) * 0.02,
    THREE.MathUtils.clamp(hsl.s + (rng.next() - 0.5) * 0.12, 0, 1),
    THREE.MathUtils.clamp(hsl.l + (rng.next() - 0.5) * (spread / 100), 0.03, 0.97),
  );
  const hex = '#' + c.getHexString();
  colorCache.set(key, hex);
  return hex;
}

const voxelTexCache = new Map<string, THREE.CanvasTexture>();

/**
 * Procedural 32x32 pixel-art voxel face. Deliberately original: chunky noise
 * speckles, a darkened border so individual voxels read clearly, plus a hint
 * of material-specific structure (facets for crystal, streaks for metal).
 */
export function voxelTexture(def: VoxelMaterialDef, seed = 7): THREE.CanvasTexture {
  const cached = voxelTexCache.get(def.id);
  if (cached) return cached;
  const S = 32;
  const { c, g } = makeCanvas(S);
  const rng = new Rng(seed + def.id.length * 977);

  g.fillStyle = def.base;
  g.fillRect(0, 0, S, S);

  const blobs = Math.floor(def.speckDensity * 46);
  for (let i = 0; i < blobs; i++) {
    const size = rng.int(2, 6);
    const x = rng.int(-2, S - 2);
    const y = rng.int(-2, S - 2);
    g.fillStyle = src(rng.pick(def.speck), rng, 14);
    g.globalAlpha = rng.range(0.55, 1);
    g.fillRect(x, y, size, rng.int(2, 4));
  }
  g.globalAlpha = 1;

  if (def.fx === 'crystal') {
    for (let i = 0; i < 5; i++) {
      const x = rng.int(0, S - 8);
      const y = rng.int(0, S - 8);
      const len = rng.int(6, 14);
      g.strokeStyle = def.speck[0];
      g.globalAlpha = rng.range(0.25, 0.6);
      g.lineWidth = rng.chance(0.5) ? 1 : 2;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + len, y + len);
      g.stroke();
    }
    g.globalAlpha = 1;
    g.fillStyle = '#ffffff';
    g.globalAlpha = 0.35;
    g.fillRect(4, 4, 5, 3);
    g.globalAlpha = 1;
  } else if (def.fx === 'metal' || def.fx === 'gold') {
    for (let i = 0; i < 6; i++) {
      const y = rng.int(1, S - 3);
      const h = rng.int(2, 5);
      g.fillStyle = src(def.speck[rng.int(0, def.speck.length - 1)], rng, 16);
      g.globalAlpha = rng.range(0.35, 0.8);
      g.fillRect(rng.int(-2, 10), y, rng.int(10, 30), h);
    }
    g.globalAlpha = 1;
  } else if (def.fx === 'organic') {
    for (let i = 0; i < 18; i++) {
      g.fillStyle = src(def.speck[rng.int(0, def.speck.length - 1)], rng, 20);
      g.globalAlpha = rng.range(0.3, 0.7);
      const x = rng.int(0, S - 3);
      const y = rng.int(0, S - 3);
      g.fillRect(x, y, 2, rng.chance(0.5) ? 3 : 1);
    }
    g.globalAlpha = 1;
  } else if (def.fx === 'dark') {
    for (let i = 0; i < 7; i++) {
      g.fillStyle = def.speck[rng.int(0, def.speck.length - 1)];
      g.globalAlpha = rng.range(0.5, 0.9);
      const x = rng.int(0, S - 6);
      const y = rng.int(0, S - 6);
      g.fillRect(x, y, rng.int(4, 8), rng.int(1, 2));
    }
    g.globalAlpha = 1;
  }

  // voxel border
  g.globalAlpha = def.edge;
  g.fillStyle = '#000000';
  g.fillRect(0, 0, S, 2);
  g.fillRect(0, S - 2, S, 2);
  g.fillRect(0, 0, 2, S);
  g.fillRect(S - 2, 0, 2, S);
  g.globalAlpha = def.edge * 0.5;
  g.fillRect(2, 2, S - 4, 1);
  g.fillRect(2, 2, 1, S - 4);
  g.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  voxelTexCache.set(def.id, tex);
  return tex;
}

const materialCache = new Map<string, THREE.MeshStandardMaterial>();

export function voxelMaterial(def: VoxelMaterialDef): THREE.MeshStandardMaterial {
  const hit = materialCache.get(def.id);
  if (hit) return hit;
  const map = voxelTexture(def);
  const mat = new THREE.MeshStandardMaterial({
    map,
    roughness: def.roughness,
    metalness: def.metalness,
    emissive: new THREE.Color(def.emissive ?? 0x000000),
    emissiveIntensity: def.emissiveIntensity ?? 0,
    emissiveMap: def.emissive ? map : null,
    flatShading: false,
  });
  mat.name = 'voxel-' + def.id;
  materialCache.set(def.id, mat);
  return mat;
}

/* -------------------------------------------------------------- particles */

let dotTex: THREE.Texture | null = null;
export function dotTexture(): THREE.Texture {
  if (dotTex) return dotTex;
  const { c, g } = makeCanvas(64);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.85)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  dotTex = new THREE.CanvasTexture(c);
  return dotTex;
}

let sparkTex: THREE.Texture | null = null;
export function sparkTexture(): THREE.Texture {
  if (sparkTex) return sparkTex;
  const { c, g } = makeCanvas(64);
  g.clearRect(0, 0, 64, 64);
  const drawStreak = (rot: number, w: number) => {
    g.save();
    g.translate(32, 32);
    g.rotate(rot);
    const grad = g.createLinearGradient(-32, 0, 32, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.5, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(-32, -w / 2, 64, w);
    g.restore();
  };
  drawStreak(0, 7);
  drawStreak(Math.PI / 2, 4);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 14);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  sparkTex = new THREE.CanvasTexture(c);
  return sparkTex;
}

let ringTex: THREE.Texture | null = null;
export function ringTexture(): THREE.Texture {
  if (ringTex) return ringTex;
  const { c, g } = makeCanvas(128);
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.72, 'rgba(255,255,255,0)');
  grad.addColorStop(0.86, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.94, 'rgba(255,255,255,0.25)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  ringTex = new THREE.CanvasTexture(c);
  return ringTex;
}

let cloudTex: THREE.Texture | null = null;
export function cloudTexture(): THREE.Texture {
  if (cloudTex) return cloudTex;
  const { c, g } = makeCanvas(128);
  const rng = new Rng(4242);
  for (let i = 0; i < 26; i++) {
    const x = rng.range(20, 108);
    const y = rng.range(38, 92);
    const r = rng.range(10, 30);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  cloudTex = new THREE.CanvasTexture(c);
  return cloudTex;
}

const platformCache = new Map<string, THREE.CanvasTexture>();

/** Hand-painted style stone platform texture with embedded ore specks. */
export function platformTexture(): THREE.CanvasTexture {
  const hit = platformCache.get('main');
  if (hit) return hit;
  const S = 512;
  const { c, g } = makeCanvas(S);
  const rng = new Rng(20240);
  g.fillStyle = '#3b3f52';
  g.fillRect(0, 0, S, S);
  // tile grid
  const tile = 64;
  for (let y = 0; y < S; y += tile) {
    for (let x = 0; x < S; x += tile) {
      g.fillStyle = src(rng.chance(0.5) ? '#41465c' : '#383c4e', rng, 12);
      g.fillRect(x + 2, y + 2, tile - 4, tile - 4);
      g.globalAlpha = 0.5;
      g.fillStyle = src('#4b5169', rng, 10);
      g.fillRect(x + 4, y + 4, tile - 8, 6);
      g.globalAlpha = 1;
    }
  }
  for (let i = 0; i < 260; i++) {
    g.fillStyle = src(rng.pick(['#2d3141', '#515970', '#454b60']), rng, 16);
    g.fillRect(rng.int(0, S), rng.int(0, S), rng.int(2, 9), rng.int(2, 5));
  }
  // scattered gem specks
  for (let i = 0; i < 26; i++) {
    const col = rng.pick(['#5fd0e8', '#e05f7a', '#f0c14b', '#69e08a']);
    g.globalAlpha = rng.range(0.35, 0.8);
    g.fillStyle = col;
    const x = rng.int(8, S - 8);
    const y = rng.int(8, S - 8);
    g.fillRect(x, y, rng.int(3, 7), rng.int(3, 7));
    g.globalAlpha = 1;
  }
  // soft vignette so the arena reads as a lit stage
  const vg = g.createRadialGradient(S / 2, S / 2, S * 0.18, S / 2, S / 2, S * 0.62);
  vg.addColorStop(0, 'rgba(255,255,255,0.10)');
  vg.addColorStop(0.6, 'rgba(0,0,0,0.06)');
  vg.addColorStop(1, 'rgba(0,0,0,0.34)');
  g.fillStyle = vg;
  g.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.MirroredRepeatWrapping;
  tex.repeat.set(3, 3);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  platformCache.set('main', tex);
  return tex;
}
