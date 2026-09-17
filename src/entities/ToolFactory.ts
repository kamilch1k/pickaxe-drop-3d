import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type RAPIER from '@dimforge/rapier3d-compat';
import { TOOL_MATERIALS, type ToolDef, type ToolMaterialKey } from '../content/tools';

export interface BuiltTool {
  group: THREE.Group;
  colliders: RAPIER.ColliderDesc[];
  tip: THREE.Vector3;
  mass: number;
  /** total radius of the compound shape, used for spawn offsets */
  extent: number;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
const matCache = new Map<string, THREE.MeshStandardMaterial>();
/** merged, transform-applied geometry per material for each tool variant */
const toolGeoCache = new Map<string, { mat: ToolMaterialKey; geo: THREE.BufferGeometry }[]>();

function boxGeo(w: number, h: number, d: number): THREE.BufferGeometry {
  const key = `b${w.toFixed(3)}_${h.toFixed(3)}_${d.toFixed(3)}`;
  let g = geoCache.get(key);
  if (!g) {
    const r = Math.min(0.07, Math.min(w, h, d) * 0.3);
    g = new RoundedBoxGeometry(w, h, d, 2, r);
    geoCache.set(key, g);
  }
  return g;
}

function cylGeo(r: number, h: number, cone: boolean): THREE.BufferGeometry {
  const key = `${cone ? 'c' : 'y'}${r.toFixed(3)}_${h.toFixed(3)}`;
  let g = geoCache.get(key);
  if (!g) {
    g = cone
      ? new THREE.ConeGeometry(r, h, 18, 1, false, 0)
      : new THREE.CylinderGeometry(r, r, h, 18, 1, false);
    geoCache.set(key, g);
  }
  return g;
}

function sphGeo(r: number): THREE.BufferGeometry {
  const key = `s${r.toFixed(3)}`;
  let g = geoCache.get(key);
  if (!g) {
    g = new THREE.IcosahedronGeometry(r, 1);
    geoCache.set(key, g);
  }
  return g;
}

function toolMat(key: ToolMaterialKey): THREE.MeshStandardMaterial {
  let m = matCache.get(key);
  if (!m) {
    const cfg = TOOL_MATERIALS[key];
    m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(cfg.color),
      metalness: cfg.metalness,
      roughness: cfg.roughness,
      emissive: new THREE.Color(cfg.emissive),
      emissiveIntensity: cfg.emissiveIntensity,
    });
    matCache.set(key, m);
  }
  return m;
}

/** Builds (and caches) one merged geometry per material for a tool. */
function toolGeometries(
  def: ToolDef,
  scale: number,
): { mat: ToolMaterialKey; geo: THREE.BufferGeometry }[] {
  const key = `${def.id}|${scale.toFixed(3)}`;
  const cached = toolGeoCache.get(key);
  if (cached) return cached;

  const groups = new Map<ToolMaterialKey, THREE.BufferGeometry[]>();
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const pos = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);

  for (const p of def.parts) {
    let geo: THREE.BufferGeometry;
    switch (p.kind) {
      case 'box':
        geo = boxGeo(p.size[0] * scale, p.size[1] * scale, p.size[2] * scale);
        break;
      case 'cyl':
        geo = cylGeo(p.size[0] * scale, p.size[1] * scale, false);
        break;
      case 'cone':
        geo = cylGeo(p.size[0] * scale, p.size[1] * scale, true);
        break;
      default:
        geo = sphGeo(p.size[0] * scale);
        break;
    }
    e.set(p.rot?.[0] ?? 0, p.rot?.[1] ?? 0, p.rot?.[2] ?? 0);
    q.setFromEuler(e);
    pos.set(p.pos[0] * scale, p.pos[1] * scale, p.pos[2] * scale);
    m4.compose(pos, q, one);
    // mergeGeometries needs a consistent index state across inputs: some of
    // three's primitives are indexed and others are not.
    const clone = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(m4);
    const list = groups.get(p.mat);
    if (list) list.push(clone);
    else groups.set(p.mat, [clone]);
  }

  const out: { mat: ToolMaterialKey; geo: THREE.BufferGeometry }[] = [];
  for (const [mat, list] of groups) {
    const merged = mergeGeometries(list, false) ?? list[0];
    merged.computeBoundingSphere();
    out.push({ mat, geo: merged });
    for (const g of list) if (g !== merged) g.dispose();
  }
  toolGeoCache.set(key, out);
  return out;
}

const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();

/** Volume of a part in cubic world units. */
function partVolume(p: { kind: string; size: number[] }, scale: number): number {
  const sx = p.size[0] * scale;
  const sy = (p.size[1] ?? 0) * scale;
  const sz = (p.size[2] ?? 0) * scale;
  if (p.kind === 'box') return sx * sy * sz;
  if (p.kind === 'cyl') return Math.PI * sx * sx * sy;
  if (p.kind === 'cone') return (Math.PI * sx * sx * sy) / 3;
  return (4 / 3) * Math.PI * sx ** 3;
}

/**
 * Centre of mass of the compound in authored part space. All parts are then
 * shifted by `-com`, so the body's origin *is* its centre of mass: Rapier's
 * rotation (about the COM) and our constrained rotation (about the origin)
 * become the same transform and a spinning tool falls perfectly straight
 * instead of orbiting its own head.
 */
export function toolCentreOfMass(def: ToolDef, scale: number): THREE.Vector3 {
  let mx = 0;
  let my = 0;
  let mz = 0;
  let m = 0;
  for (const p of def.parts) {
    if (p.decor) continue;
    const w = partVolume(p, scale) * p.density;
    mx += p.pos[0] * scale * w;
    my += p.pos[1] * scale * w;
    mz += p.pos[2] * scale * w;
    m += w;
  }
  if (m <= 0) return new THREE.Vector3();
  return new THREE.Vector3(mx / m, my / m, mz / m);
}

export function buildTool(def: ToolDef, RAPIER_NS: typeof RAPIER, scaleOverride?: number): BuiltTool {
  const scale = scaleOverride ?? def.scale ?? 1;
  const group = new THREE.Group();
  for (const { mat, geo } of toolGeometries(def, scale)) {
    const mesh = new THREE.Mesh(geo, toolMat(mat));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  const colliders: RAPIER.ColliderDesc[] = [];
  let mass = 0;
  let extent = 0.3 * scale;
  let tipX = 0;
  let tipY = 0;
  let tipZ = 0;
  let tipW = 0;

  for (const p of def.parts) {
    const sx = p.size[0] * scale;
    const sy = (p.size[1] ?? 0) * scale;
    const sz = (p.size[2] ?? 0) * scale;
    const vol = partVolume(p, scale);

    const px = p.pos[0] * scale;
    const py = p.pos[1] * scale;
    const pz = p.pos[2] * scale;
    const partMass = vol * p.density;
    mass += p.decor ? 0 : partMass;
    const dist = Math.hypot(px, py, pz) + Math.max(sx, sy, sz) * 0.6;
    extent = Math.max(extent, dist);
    if (!p.decor && p.density > 1200) {
      tipX += px * partMass;
      tipY += py * partMass;
      tipZ += pz * partMass;
      tipW += partMass;
    }

    if (p.decor) continue;
    _euler.set(p.rot?.[0] ?? 0, p.rot?.[1] ?? 0, p.rot?.[2] ?? 0);
    _quat.setFromEuler(_euler);
    let desc: RAPIER.ColliderDesc;
    if (p.kind === 'box') {
      desc = RAPIER_NS.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2);
    } else if (p.kind === 'cyl') {
      desc = RAPIER_NS.ColliderDesc.cylinder(sy / 2, sx);
    } else if (p.kind === 'cone') {
      desc = RAPIER_NS.ColliderDesc.cone(sy / 2, sx);
    } else {
      desc = RAPIER_NS.ColliderDesc.ball(sx);
    }
    desc
      .setTranslation(px, py, pz)
      .setRotation({ x: _quat.x, y: _quat.y, z: _quat.z, w: _quat.w })
      .setFriction(def.friction)
      .setRestitution(def.restitution)
      .setActiveEvents(RAPIER_NS.ActiveEvents.COLLISION_EVENTS);
    desc.setDensity(p.density);
    colliders.push(desc);
  }

  const tip =
    tipW > 0
      ? new THREE.Vector3(tipX / tipW, tipY / tipW, tipZ / tipW)
      : new THREE.Vector3(0, 0, 0);

  return { group, colliders, tip, mass: Math.max(mass, 0.2), extent };
}
