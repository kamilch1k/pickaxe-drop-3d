import * as THREE from 'three';
import type { PickaxeSimulator } from './PickaxeSimulator';

/**
 * Dev-only overlay for tuning the planar pickaxe solver. Draws, for every live
 * solver body:
 *
 *   - the collision probes (gold = head, pink = handle)
 *   - the swept segment of each probe this step (cyan)
 *   - the contact points and their normals (red)
 *   - centre of mass (white cross), velocity (green)
 *   - angular velocity about the plane normal (purple axis + arc)
 *   - the depth lane the pickaxe is locked to (blue)
 *
 * Everything is preallocated: enabling the view must never allocate per frame.
 */

const MAX_PROBE_POINTS = 1024;
const MAX_SWEEP_VERTS = 4096;
const MAX_VECTOR_VERTS = 1024;
const MAX_CONTACT_VERTS = 512;

const HEAD_COLOR = new THREE.Color('#ffcf64');
const HANDLE_COLOR = new THREE.Color('#ff70cb');
const SWEEP_COLOR = new THREE.Color('#4de0f5');
const VEL_COLOR = new THREE.Color('#79fa8a');
const ANG_COLOR = new THREE.Color('#c394ff');
const CONTACT_COLOR = new THREE.Color('#ff665e');
const COM_COLOR = new THREE.Color('#ffffff');
const LANE_COLOR = new THREE.Color('#548996');

function dotCloud(count: number, size: number, colors: boolean): THREE.Points {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  if (colors) geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
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
  if (colors) geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
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
  private readonly probeDots = dotCloud(MAX_PROBE_POINTS, 0.14, true);
  private readonly comDots = dotCloud(256, 0.1, false);
  private readonly sweepLines = lineCloud(MAX_SWEEP_VERTS, false);
  private readonly vectorLines = lineCloud(MAX_VECTOR_VERTS, true);
  private readonly contactLines = lineCloud(MAX_CONTACT_VERTS, false);
  private readonly pointScratch: THREE.Vector3[] = [];

  constructor() {
    (this.comDots.material as THREE.PointsMaterial).color.copy(COM_COLOR);
    (this.sweepLines.material as THREE.LineBasicMaterial).color.copy(SWEEP_COLOR);
    (this.contactLines.material as THREE.LineBasicMaterial).color.copy(CONTACT_COLOR);
    this.group.add(this.probeDots, this.comDots, this.sweepLines, this.vectorLines, this.contactLines);
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
    const comPos = this.comDots.geometry.getAttribute('position') as THREE.BufferAttribute;
    const sweepPos = this.sweepLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    const vecPos = this.vectorLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    const vecCol = this.vectorLines.geometry.getAttribute('color') as THREE.BufferAttribute;
    const contactPos = this.contactLines.geometry.getAttribute('position') as THREE.BufferAttribute;

    let probes = 0;
    let coms = 0;
    let vecs = 0;

    for (const body of sim.all) {
      if (this.pointScratch.length !== body.probes.length) {
        this.pointScratch.length = 0;
        for (let i = 0; i < body.probes.length; i += 1) this.pointScratch.push(new THREE.Vector3());
      }
      body.points(this.pointScratch);
      for (let i = 0; i < body.probes.length; i += 1) {
        if (probes >= MAX_PROBE_POINTS) break;
        const p = this.pointScratch[i];
        probePos.setXYZ(probes, p.x, p.y, p.z);
        const c = body.probes[i].kind === 'head' ? HEAD_COLOR : HANDLE_COLOR;
        probeCol.setXYZ(probes, c.r, c.g, c.b);
        probes += 1;
      }

      if (coms < 256) {
        comPos.setXYZ(coms, body.position.x, body.position.y, body.position.z);
        coms += 1;
      }

      if (vecs + 6 <= MAX_VECTOR_VERTS) {
        const p = body.position;
        // velocity (green)
        const vScale = 0.14;
        const vLen = body.velocity.length();
        if (vLen > 0.05) {
          vecPos.setXYZ(vecs, p.x, p.y, p.z);
          vecPos.setXYZ(vecs + 1, p.x + body.velocity.x * vScale, p.y + body.velocity.y * vScale, p.z + body.velocity.z * vScale);
          vecCol.setXYZ(vecs, VEL_COLOR.r, VEL_COLOR.g, VEL_COLOR.b);
          vecCol.setXYZ(vecs + 1, VEL_COLOR.r, VEL_COLOR.g, VEL_COLOR.b);
          vecs += 2;
        }
        // angular velocity: the spin axis is the plane normal
        const spin = body.angularVelocity.z;
        if (Math.abs(spin) > 0.05) {
          const dir = Math.sign(spin);
          vecPos.setXYZ(vecs, p.x, p.y, p.z);
          vecPos.setXYZ(vecs + 1, p.x, p.y, p.z + 0.6 * dir);
          vecCol.setXYZ(vecs, ANG_COLOR.r, ANG_COLOR.g, ANG_COLOR.b);
          vecCol.setXYZ(vecs + 1, ANG_COLOR.r, ANG_COLOR.g, ANG_COLOR.b);
          vecs += 2;
          // an arc showing the rotation direction in the drop plane
          const radius = 0.42;
          const a0 = 0.4;
          const a1 = a0 + 0.5 * dir;
          vecPos.setXYZ(vecs, p.x + Math.cos(a0) * radius, p.y + Math.sin(a0) * radius, p.z);
          vecPos.setXYZ(vecs + 1, p.x + Math.cos(a1) * radius, p.y + Math.sin(a1) * radius, p.z);
          vecCol.setXYZ(vecs, ANG_COLOR.r, ANG_COLOR.g, ANG_COLOR.b);
          vecCol.setXYZ(vecs + 1, ANG_COLOR.r, ANG_COLOR.g, ANG_COLOR.b);
          vecs += 2;
        }
        // the depth lane this body is locked to
        vecPos.setXYZ(vecs, p.x, p.y, body.planeZ - body.halfDepth);
        vecPos.setXYZ(vecs + 1, p.x, p.y, body.planeZ + body.halfDepth);
        vecCol.setXYZ(vecs, LANE_COLOR.r, LANE_COLOR.g, LANE_COLOR.b);
        vecCol.setXYZ(vecs + 1, LANE_COLOR.r, LANE_COLOR.g, LANE_COLOR.b);
        vecs += 2;
      }
    }

    // swept probe segments and contact normals from the last simulated step
    const sweeps = Math.min(sim.debug.sweepLines.length, MAX_SWEEP_VERTS);
    for (let i = 0; i < sweeps; i += 1) {
      const p = sim.debug.sweepLines[i];
      sweepPos.setXYZ(i, p.x, p.y, p.z);
    }
    let contacts = 0;
    for (const c of sim.debug.contacts) {
      if (contacts + 2 > MAX_CONTACT_VERTS) break;
      contactPos.setXYZ(contacts, c.point.x, c.point.y, c.point.z);
      contactPos.setXYZ(
        contacts + 1,
        c.point.x + c.normal.x * 0.5,
        c.point.y + c.normal.y * 0.5,
        c.point.z + c.normal.z * 0.5,
      );
      contacts += 2;
    }

    for (const attr of [probePos, probeCol, comPos, sweepPos, vecPos, vecCol, contactPos]) {
      attr.needsUpdate = true;
    }
    this.probeDots.geometry.setDrawRange(0, probes);
    this.comDots.geometry.setDrawRange(0, coms);
    this.sweepLines.geometry.setDrawRange(0, sweeps);
    this.vectorLines.geometry.setDrawRange(0, vecs);
    this.contactLines.geometry.setDrawRange(0, contacts);
  }
}
