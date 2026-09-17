import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type RAPIER from '@dimforge/rapier3d-compat';
import { TOOL_MATERIALS, type ToolDef, type ToolPart } from '../content/tools';

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

function toolMat(key: ToolPart['mat']): THREE.MeshStandardMaterial {
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

const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();

export function buildTool(def: ToolDef, RAPIER_NS: typeof RAPIER): BuiltTool {
  const group = new THREE.Group();
  const colliders: RAPIER.ColliderDesc[] = [];
  let mass = 0;
  let extent = 0.3;
  let tipX = 0;
  let tipY = 0;
  let tipZ = 0;
  let tipW = 0;

  for (const p of def.parts) {
    let geo: THREE.BufferGeometry;
    let vol = 1;
    switch (p.kind) {
      case 'box':
        geo = boxGeo(p.size[0], p.size[1], p.size[2]);
        vol = p.size[0] * p.size[1] * p.size[2];
        break;
      case 'cyl':
        geo = cylGeo(p.size[0], p.size[1], false);
        vol = Math.PI * p.size[0] * p.size[0] * p.size[1];
        break;
      case 'cone':
        geo = cylGeo(p.size[0], p.size[1], true);
        vol = (Math.PI * p.size[0] * p.size[0] * p.size[1]) / 3;
        break;
      default:
        geo = sphGeo(p.size[0]);
        vol = (4 / 3) * Math.PI * p.size[0] ** 3;
        break;
    }
    const mesh = new THREE.Mesh(geo, toolMat(p.mat));
    mesh.position.set(p.pos[0], p.pos[1], p.pos[2]);
    if (p.rot) mesh.rotation.set(p.rot[0], p.rot[1], p.rot[2]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);

    const partMass = vol * p.density;
    mass += p.decor ? 0 : partMass;
    const dist = Math.hypot(p.pos[0], p.pos[1], p.pos[2]) + Math.max(...p.size) * 0.6;
    extent = Math.max(extent, dist);
    if (!p.decor && p.density > 1200) {
      tipX += p.pos[0] * partMass;
      tipY += p.pos[1] * partMass;
      tipZ += p.pos[2] * partMass;
      tipW += partMass;
    }

    if (p.decor) continue;
    _euler.set(p.rot?.[0] ?? 0, p.rot?.[1] ?? 0, p.rot?.[2] ?? 0);
    _quat.setFromEuler(_euler);
    let desc: RAPIER.ColliderDesc;
    if (p.kind === 'box') {
      desc = RAPIER_NS.ColliderDesc.cuboid(p.size[0] / 2, p.size[1] / 2, p.size[2] / 2);
    } else if (p.kind === 'cyl') {
      desc = RAPIER_NS.ColliderDesc.cylinder(p.size[1] / 2, p.size[0]);
    } else if (p.kind === 'cone') {
      desc = RAPIER_NS.ColliderDesc.cone(p.size[1] / 2, p.size[0]);
    } else {
      desc = RAPIER_NS.ColliderDesc.ball(p.size[0]);
    }
    desc
      .setTranslation(p.pos[0], p.pos[1], p.pos[2])
      .setRotation({ x: _quat.x, y: _quat.y, z: _quat.z, w: _quat.w })
      .setDensity(p.density)
      .setFriction(def.friction)
      .setRestitution(def.restitution)
      .setActiveEvents(RAPIER_NS.ActiveEvents.COLLISION_EVENTS);
    colliders.push(desc);
  }

  const tip =
    tipW > 0
      ? new THREE.Vector3(tipX / tipW, tipY / tipW, tipZ / tipW)
      : new THREE.Vector3(0, 0, 0);

  return { group, colliders, tip, mass: Math.max(mass, 0.4), extent };
}
