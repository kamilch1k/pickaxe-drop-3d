import * as THREE from 'three';
import { clamp, damp } from '../utils/math';

export interface FrameTarget {
  center: THREE.Vector3;
  radius: number;
  height: number;
}

const BASE_YAW = 0.46;
const BASE_PITCH = 0.74;

export class CameraDirector {
  readonly camera: THREE.PerspectiveCamera;
  private lookAt = new THREE.Vector3(0, 4, 0);
  private desiredLookAt = new THREE.Vector3(0, 4, 0);
  private yaw = BASE_YAW;
  private pitch = BASE_PITCH;
  private distance = 40;
  private desiredDistance = 40;
  private shake = 0;
  private shakeTime = 0;
  private fovOffset = 0;
  private baseFov = 40;
  private dragYaw = 0;
  private dragPitch = 0;
  private shakeOffset = new THREE.Vector3();
  private orbitVel = 0;
  private orbitOffset = 0;
  private introT = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(this.baseFov, aspect, 0.5, 900);
    this.camera.position.set(0, 26, 34);
  }

  frame(t: FrameTarget): void {
    const tanV = Math.tan(((this.baseFov + this.fovOffset) * Math.PI) / 360);
    const tanH = tanV * Math.max(0.6, this.camera.aspect);
    // Framed so the whole target (plus its surroundings) stays on screen with
    // comfortable margin, at any aspect ratio.
    const dRadius = (t.radius * 1.75) / tanH;
    const dHeight = (t.height * 0.9) / tanV;
    this.desiredDistance = clamp(Math.max(dRadius, dHeight) + t.height * 0.12, 18, 200);
    this.desiredLookAt.set(t.center.x, t.center.y + t.height * 0.06, t.center.z);
  }

  /** Jump straight to the framed distance (used when a new target arrives). */
  snapDistance(): void {
    this.distance = this.desiredDistance;
  }

  setDrag(dx: number, dy: number): void {
    this.dragYaw = clamp(this.dragYaw - dx * 0.0042, -0.62, 0.62);
    this.dragPitch = clamp(this.dragPitch + dy * 0.0035, -0.3, 0.4);
  }

  addShake(amount: number): void {
    this.shake = Math.min(2.4, this.shake + amount);
  }

  kickFov(amount: number): void {
    this.fovOffset = Math.min(8, this.fovOffset + amount);
  }

  /** Wide cinematic swing used between targets. */
  cinematicSwing(strength = 1): void {
    this.orbitVel += 1.1 * strength;
    this.fovOffset += 2.4 * strength;
  }

  introFlourish(): void {
    this.introT = 1;
  }

  update(dt: number, time: number): void {
    const distGap = Math.abs(this.desiredDistance - this.distance);
    const rate = distGap > 10 ? 6.5 : 2.6;
    if (this.introT > 0) {
      this.introT = Math.max(0, this.introT - dt / 2.6);
    }
    const intro = this.introT * this.introT;

    this.orbitOffset += this.orbitVel * dt;
    this.orbitVel = damp(this.orbitVel, 0, 1.3, dt);
    this.orbitOffset = damp(this.orbitOffset, 0, 0.4, dt);

    const idle = Math.sin(time * 0.18) * 0.045;
    const targetYaw = BASE_YAW + this.dragYaw + idle + this.orbitOffset + intro * 0.5;
    const targetPitch = BASE_PITCH + this.dragPitch - intro * 0.22;
    this.yaw = damp(this.yaw, targetYaw, 3.4, dt);
    this.pitch = damp(this.pitch, targetPitch, 3.4, dt);

    this.lookAt.x = damp(this.lookAt.x, this.desiredLookAt.x, 3.2, dt);
    this.lookAt.y = damp(this.lookAt.y, this.desiredLookAt.y, 3.2, dt);
    this.lookAt.z = damp(this.lookAt.z, this.desiredLookAt.z, 3.2, dt);
    this.distance = damp(this.distance, this.desiredDistance * (1 + intro * 0.32), rate, dt);

    const cosP = Math.cos(this.pitch);
    const px = Math.sin(this.yaw) * cosP * this.distance;
    const pz = Math.cos(this.yaw) * cosP * this.distance;
    const py = Math.sin(this.pitch) * this.distance;

    this.shakeTime += dt * 34;
    if (this.shake > 0.0005) {
      const s = this.shake;
      this.shakeOffset.set(
        (Math.sin(this.shakeTime * 1.7) + Math.sin(this.shakeTime * 3.1)) * 0.5 * s,
        (Math.sin(this.shakeTime * 2.3 + 1.1) + Math.sin(this.shakeTime * 4.7)) * 0.5 * s,
        (Math.cos(this.shakeTime * 1.9 + 0.4) + Math.sin(this.shakeTime * 2.7)) * 0.5 * s,
      );
      this.shake = Math.max(0, this.shake - dt * (2.4 + this.shake * 3.6));
    } else {
      this.shakeOffset.multiplyScalar(0.85);
      this.shake = 0;
    }

    this.camera.position.set(
      this.lookAt.x + px + this.shakeOffset.x,
      this.lookAt.y + py + this.shakeOffset.y,
      this.lookAt.z + pz + this.shakeOffset.z,
    );
    this.fovOffset = damp(this.fovOffset, 0, 5.5, dt);
    this.camera.fov = this.baseFov + this.fovOffset;
    const roll = clamp(this.shakeOffset.x * 0.012, -0.06, 0.06) + this.orbitOffset * 0.05;
    this.camera.lookAt(this.lookAt);
    this.camera.rotation.z += roll;
    this.camera.updateProjectionMatrix();
  }

  screenPosition(
    v: THREE.Vector3,
    w: number,
    h: number,
  ): { x: number; y: number; visible: boolean } {
    const p = new THREE.Vector3().copy(v).project(this.camera);
    return {
      x: (p.x * 0.5 + 0.5) * w,
      y: (-p.y * 0.5 + 0.5) * h,
      visible: p.z < 1,
    };
  }
}
