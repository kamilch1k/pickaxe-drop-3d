import * as THREE from 'three';
import type { PickaxeSimulator } from './PickaxeSimulator';

/**
 * Dev-only overlay for tuning the hand-written pickaxe solver. Draws, for every
 * live solver body:
 *
 *   - the current collision probes (red = head, blue = handle)
 *   - where those probes were on the previous step (dim grey)
 *   - the swept segment each probe travelled (green)
 *   - the centre of mass (magenta dot, the authored origin)
 *   - the velocity vector (orange) and angular velocity axis (cyan)
 *   - the most recent contact normal (yellow) and its classification label
 *
 * Everything is preallocated: enabling the view must never allocate per frame.
 */

const MAX_PROBE_POINTS = 4096;
const MAX_SWEEP_VERTS = 8192;
const MAX_VECTOR_VERTS = 2048;
const MAX_NORMAL_VERTS = 256;
const MAX_BODY_MARKS = 512;

const HEAD_COLOR = new THREE.Color('#ff5a52');
const HANDLE_COLOR = new THREE.Color('#5aa8ff');
const PREV_COLOR = new THREE.Color('#5c6470');
const SWEEP_COLOR = new THREE.Color('#54e08a');
const VEL_COLOR = new THREE.Color('#ffa03c');
const ANG_COLOR = new THREE.Color('#42e6ff');
const COM_COLOR = new THREE.Color('#ff5ad6');
const NORMAL_COLOR = new THREE.Color('#ffe14d');

function dotCloud(count: number, size: number, colors: boolean): THREE.Points {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  if (colors) {
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  }
  const mat = new THREE.PointsMaterial({
    size,
    sizeAttenuation: true,
    depthTest: false,
    transparent: true,
    vertexColors: colors,
    toneMapped: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 999;
  return points;
}

function lineCloud(count: number, colors: boolean): THREE.LineSegments {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  if (colors) {
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  }
  const mat = new THREE.LineBasicMaterial({
    depthTest: false,
    transparent: true,
    vertexColors: colors,
    toneMapped: false,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  lines.renderOrder = 999;
  return lines;
}

export class PickaxeDebugView {
  readonly group = new THREE.Group();
  private readonly probeDots = dotCloud(MAX_PROBE_POINTS, 0.16, true);
  private readonly prevDots = dotCloud(MAX_PROBE_POINTS, 0.1, false);
  private readonly comDots = dotCloud(MAX_BODY_MARKS, 0.24, false);
  private readonly sweepLines = lineCloud(MAX_SWEEP_VERTS, false);
  private readonly vectorLines = lineCloud(MAX_VECTOR_VERTS, true);
  private readonly normalLines = lineCloud(MAX_NORMAL_VERTS, false);

  constructor() {
    (this.prevDots.material as THREE.PointsMaterial).color.copy(PREV_COLOR);
    (this.comDots.material as THREE.PointsMaterial).color.copy(COM_COLOR);
    (this.sweepLines.material as THREE.LineBasicMaterial).color.copy(SWEEP_COLOR);
    (this.normalLines.material as THREE.LineBasicMaterial).color.copy(NORMAL_COLOR);
    this.group.add(
      this.probeDots,
      this.prevDots,
      this.comDots,
      this.sweepLines,
      this.vectorLines,
      this.normalLines,
    );
    this.group.visible = false;
  }

  get visible(): boolean {
    return this.group.visible;
  }

  setEnabled(sim: PickaxeSimulator, on: boolean): void {
    this.group.visible = on;
    sim.debug.enabled = on;
  }

  update(sim: PickaxeSimulator): void {
    if (!this.group.visible) return;

    const probePos = this.probeDots.geometry.getAttribute('position') as THREE.BufferAttribute;
    const probeCol = this.probeDots.geometry.getAttribute('color') as THREE.BufferAttribute;
    const prevPos = this.prevDots.geometry.getAttribute('position') as THREE.BufferAttribute;
    const comPos = this.comDots.geometry.getAttribute('position') as THREE.BufferAttribute;
    const sweepPos = this.sweepLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    const vecPos = this.vectorLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    const vecCol = this.vectorLines.geometry.getAttribute('color') as THREE.BufferAttribute;
    const normPos = this.normalLines.geometry.getAttribute('position') as THREE.BufferAttribute;

    let probes = 0;
    let prevs = 0;
    let coms = 0;
    let sweeps = 0;
    let vecs = 0;

    const from = new THREE.Vector3();
    const to = new THREE.Vector3();

    for (const body of sim.all) {
      for (let i = 0; i < body.probes.length; i += 1) {
        const probe = body.probes[i];
        body.probeWorld(probe, from, body.previousPosition, body.previousOrientation);
        body.probeWorld(probe, to, body.position, body.orientation);

        if (probes < MAX_PROBE_POINTS) {
          probePos.setXYZ(probes, to.x, to.y, to.z);
          const c = probe.kind === 'head' ? HEAD_COLOR : HANDLE_COLOR;
          probeCol.setXYZ(probes, c.r, c.g, c.b);
          probes += 1;
        }
        if (prevs < MAX_PROBE_POINTS) {
          prevPos.setXYZ(prevs, from.x, from.y, from.z);
          prevs += 1;
        }
        if (sweeps + 2 <= MAX_SWEEP_VERTS) {
          sweepPos.setXYZ(sweeps, from.x, from.y, from.z);
          sweepPos.setXYZ(sweeps + 1, to.x, to.y, to.z);
          sweeps += 2;
        }
      }

      if (coms < MAX_BODY_MARKS) {
        comPos.setXYZ(coms, body.position.x, body.position.y, body.position.z);
        coms += 1;
      }

      // velocity + angular velocity axis, drawn from the body origin
      if (vecs + 4 <= MAX_VECTOR_VERTS) {
        const p = body.position;
        const vScale = 0.08;
        const vx = body.velocity.x * vScale;
        const vy = body.velocity.y * vScale;
        const vz = body.velocity.z * vScale;
        const vLen = Math.hypot(vx, vy, vz);
        if (vLen > 0.05) {
          vecPos.setXYZ(vecs, p.x, p.y, p.z);
          vecPos.setXYZ(vecs + 1, p.x + vx, p.y + vy, p.z + vz);
          vecCol.setXYZ(vecs, VEL_COLOR.r, VEL_COLOR.g, VEL_COLOR.b);
          vecCol.setXYZ(vecs + 1, VEL_COLOR.r, VEL_COLOR.g, VEL_COLOR.b);
          vecs += 2;
        }
        const spin = body.angularVelocity;
        const sLen = spin.length();
        if (sLen > 0.05) {
          const s = 1.2 / sLen;
          vecPos.setXYZ(vecs, p.x, p.y, p.z);
          vecPos.setXYZ(vecs + 1, p.x + spin.x * s, p.y + spin.y * s, p.z + spin.z * s);
          vecCol.setXYZ(vecs, ANG_COLOR.r, ANG_COLOR.g, ANG_COLOR.b);
          vecCol.setXYZ(vecs + 1, ANG_COLOR.r, ANG_COLOR.g, ANG_COLOR.b);
          vecs += 2;
        }
      }
    }

    let normals = 0;
    if (sim.debug.lastQuality) {
      const p = sim.debug.lastPoint;
      const n = sim.debug.lastNormal;
      normPos.setXYZ(0, p.x, p.y, p.z);
      normPos.setXYZ(1, p.x + n.x * 1.2, p.y + n.y * 1.2, p.z + n.z * 1.2);
      normals = 2;
    }

    probePos.needsUpdate = true;
    probeCol.needsUpdate = true;
    prevPos.needsUpdate = true;
    comPos.needsUpdate = true;
    sweepPos.needsUpdate = true;
    vecPos.needsUpdate = true;
    vecCol.needsUpdate = true;
    normPos.needsUpdate = true;

    probePos.addUpdateRange(0, probes * 3);
    this.probeDots.geometry.setDrawRange(0, probes);
    prevPos.addUpdateRange(0, prevs * 3);
    this.prevDots.geometry.setDrawRange(0, prevs);
    comPos.addUpdateRange(0, coms * 3);
    this.comDots.geometry.setDrawRange(0, coms);
    sweepPos.addUpdateRange(0, sweeps * 3);
    this.sweepLines.geometry.setDrawRange(0, sweeps);
    vecPos.addUpdateRange(0, vecs * 3);
    this.vectorLines.geometry.setDrawRange(0, vecs);
    normPos.addUpdateRange(0, normals * 3);
    this.normalLines.geometry.setDrawRange(0, normals);
  }
}
