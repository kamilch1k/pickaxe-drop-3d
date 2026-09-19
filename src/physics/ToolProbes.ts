import { Euler, Quaternion, Vector3 } from 'three';
import type { ToolDef } from '../content/tools';
import type { CollisionProbe, ProbeKind } from './PickaxeSimulator';

/**
 * Collision probes are sampled straight off the tool's authored parts, so the
 * physics shape always matches the model. The pickaxe spec asked for a handful
 * of named points (HEAD_LEFT / HEAD_CENTER / HEAD_RIGHT / HANDLE_END); this
 * builds a denser cloud and then *names* the semantic extremes so both the
 * debug view and impact classification can talk about the same landmarks.
 *
 * A box contributes its 8 corners plus a centre point: for a translating body
 * the corners are exactly the first points to cross a voxel face, so a sweep
 * over them is a true swept test, not an approximation.
 */

/** same rule the collider builder uses to decide which parts mine */
const HEAD_DENSITY = 1200;

function sampleShape(kind: string, size: number[], out: Vector3[]): void {
  const sx = size[0] ?? 0;
  const sy = size[1] ?? 0;
  const sz = size[2] ?? 0;
  if (kind === 'box') {
    const hx = sx / 2;
    const hy = sy / 2;
    const hz = sz / 2;
    for (let i = 0; i < 8; i++) {
      out.push(
        new Vector3(
          i & 1 ? hx : -hx,
          i & 2 ? hy : -hy,
          i & 4 ? hz : -hz,
        ),
      );
    }
    out.push(new Vector3(0, 0, 0));
    return;
  }
  if (kind === 'sphere') {
    const r = sx;
    out.push(
      new Vector3(r, 0, 0),
      new Vector3(-r, 0, 0),
      new Vector3(0, r, 0),
      new Vector3(0, -r, 0),
      new Vector3(0, 0, r),
      new Vector3(0, 0, -r),
      new Vector3(0, 0, 0),
    );
    return;
  }
  if (kind === 'cone') {
    const r = sx;
    const hy = sy / 2;
    out.push(
      new Vector3(r, -hy, 0),
      new Vector3(-r, -hy, 0),
      new Vector3(0, -hy, r),
      new Vector3(0, -hy, -r),
      new Vector3(0, hy, 0),
      new Vector3(0, 0, 0),
    );
    return;
  }
  // cylinder: two rings of four points
  const r = sx;
  const hy = sy / 2;
  for (const y of [hy, -hy]) {
    out.push(
      new Vector3(r, y, 0),
      new Vector3(-r, y, 0),
      new Vector3(0, y, r),
      new Vector3(0, y, -r),
    );
  }
  out.push(new Vector3(0, 0, 0));
}

export function buildToolProbes(def: ToolDef, scale: number): CollisionProbe[] {
  const probes: CollisionProbe[] = [];
  const seen = new Set<string>();
  const quat = new Quaternion();
  const euler = new Euler();
  const point = new Vector3();
  const offset = new Vector3();
  const locals: Vector3[] = [];

  for (let i = 0; i < def.parts.length; i++) {
    const part = def.parts[i];
    if (part.decor) continue;
    const kind: ProbeKind = part.density > HEAD_DENSITY ? 'head' : 'handle';
    locals.length = 0;
    sampleShape(
      part.kind,
      [part.size[0] * scale, (part.size[1] ?? 0) * scale, (part.size[2] ?? 0) * scale],
      locals,
    );
    euler.set(part.rot?.[0] ?? 0, part.rot?.[1] ?? 0, part.rot?.[2] ?? 0);
    quat.setFromEuler(euler);
    offset.set(part.pos[0] * scale, part.pos[1] * scale, part.pos[2] * scale);
    for (let j = 0; j < locals.length; j++) {
      point.copy(locals[j]).applyQuaternion(quat).add(offset);
      const key = `${point.x.toFixed(3)}:${point.y.toFixed(3)}:${point.z.toFixed(3)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      probes.push({ name: `${kind === 'head' ? 'HEAD' : 'HANDLE'}_${i}_${j}`, kind, local: point.clone() });
    }
  }

  return nameLandmarks(probes);
}

/** Give the extreme probes the names the design doc calls out. */
function nameLandmarks(probes: CollisionProbe[]): CollisionProbe[] {
  const heads = probes.filter((p) => p.kind === 'head');
  const handles = probes.filter((p) => p.kind === 'handle');
  if (heads.length) {
    let left = heads[0];
    let right = heads[0];
    for (const p of heads) {
      if (p.local.x < left.local.x) left = p;
      if (p.local.x > right.local.x) right = p;
    }
    right.name = 'HEAD_RIGHT';
    left.name = 'HEAD_LEFT';
    const comY = avg(heads).y;
    let centre = heads[0];
    let best = Infinity;
    for (const p of heads) {
      const d = Math.abs(p.local.y - comY) + Math.abs(p.local.x) * 0.35;
      if (d < best) {
        best = d;
        centre = p;
      }
    }
    centre.name = 'HEAD_CENTER';
  }
  if (handles.length) {
    let end = handles[0];
    for (const p of handles) if (p.local.y < end.local.y) end = p;
    end.name = 'HANDLE_END';
    const com = avg(handles);
    let middle = handles[0];
    let best = Infinity;
    for (const p of handles) {
      const d = p.local.distanceToSquared(com);
      if (d < best) {
        best = d;
        middle = p;
      }
    }
    middle.name = 'HANDLE_MIDDLE';
  }
  return probes;
}

function avg(list: CollisionProbe[]): Vector3 {
  const out = new Vector3();
  for (const p of list) out.add(p.local);
  return out.multiplyScalar(1 / list.length);
}
