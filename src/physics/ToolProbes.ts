import { Euler, Quaternion, Vector3 } from 'three';
import type { ToolDef } from '../content/tools';
import type { CollisionProbe, ProbeKind } from './PickaxeSimulator';

/**
 * Collision probes are sampled from the tool's authored parts, so the physics
 * silhouette matches the model, then reduced to a small sparse set: the solver
 * sweeps a sphere along every probe each substep, so the count is the frame
 * budget. Landmarks the design doc calls out (HEAD_LEFT / HEAD_CENTER /
 * HEAD_RIGHT / HANDLE_MIDDLE / HANDLE_END) are always kept; the rest of the
 * cloud is filled in from the extremities inwards.
 */

/** same rule the collider builder uses to decide which parts mine */
const HEAD_DENSITY = 1200;

export interface ProbeOptions {
  /** hard cap on probes per tool */
  maxProbes?: number;
  /** minimum distance between kept probes, in world units */
  minSeparation?: number;
}

function sampleShape(kind: string, size: number[], out: Vector3[]): void {
  const sx = size[0] ?? 0;
  const sy = size[1] ?? 0;
  const sz = size[2] ?? 0;
  if (kind === 'box') {
    const hx = sx / 2;
    const hy = sy / 2;
    const hz = sz / 2;
    for (let i = 0; i < 8; i++) {
      out.push(new Vector3(i & 1 ? hx : -hx, i & 2 ? hy : -hy, i & 4 ? hz : -hz));
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

export function buildToolProbes(def: ToolDef, scale: number, opts: ProbeOptions = {}): CollisionProbe[] {
  const maxProbes = opts.maxProbes ?? 14;
  const minSeparation = opts.minSeparation ?? 0.24 * scale;
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

  nameLandmarks(probes);
  return selectSparse(probes, maxProbes, minSeparation);
}

/** Give the extreme probes the names the design doc calls out. */
function nameLandmarks(probes: CollisionProbe[]): void {
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
}

/**
 * Keep the named landmarks, then fill up with the most extreme points that are
 * far enough apart to add coverage. Order matters: the first accepted probe in
 * each direction defines the silhouette.
 */
function selectSparse(probes: CollisionProbe[], max: number, minSeparation: number): CollisionProbe[] {
  const named = probes.filter((p) => p.name.startsWith('HEAD_') || p.name.startsWith('HANDLE_'));
  const landmarkNames = new Set(['HEAD_LEFT', 'HEAD_CENTER', 'HEAD_RIGHT', 'HANDLE_MIDDLE', 'HANDLE_END']);
  const kept: CollisionProbe[] = [];
  for (const p of named) {
    if (landmarkNames.has(p.name)) kept.push(p);
  }
  if (!kept.length && probes.length) kept.push(probes[0]);

  const centroid = avg(probes);
  const rest = probes
    .filter((p) => kept.indexOf(p) < 0)
    .sort(
      (a, b) => b.local.distanceToSquared(centroid) - a.local.distanceToSquared(centroid),
    );
  const minSq = minSeparation * minSeparation;
  for (const p of rest) {
    if (kept.length >= max) break;
    let ok = true;
    for (const k of kept) {
      if (k.local.distanceToSquared(p.local) < minSq) {
        ok = false;
        break;
      }
    }
    if (ok) kept.push(p);
  }
  return kept;
}

function avg(list: CollisionProbe[]): Vector3 {
  const out = new Vector3();
  for (const p of list) out.add(p.local);
  return out.multiplyScalar(1 / Math.max(1, list.length));
}
