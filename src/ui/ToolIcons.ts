import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { buildTool } from '../entities/ToolFactory';
import type { ToolDef } from '../content/tools';

/**
 * Renders each tool once into an offscreen buffer so the toolbar can show a
 * real 3D icon instead of a flat glyph.
 */
export function renderToolIcons(
  defs: ToolDef[],
  rapier: typeof RAPIER,
  size = 108,
): Map<string, string> {
  const out = new Map<string, string>();
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
  } catch {
    return out;
  }
  renderer.setSize(size, size, false);
  renderer.setPixelRatio(2);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 60);
  scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x2a2440, 1.5));
  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(3, 5, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x86b6ff, 1.3);
  rim.position.set(-4, 1.5, -3);
  scene.add(rim);

  const holder = new THREE.Group();
  scene.add(holder);

  for (const def of defs) {
    try {
      const built = buildTool(def, rapier);
      const group = built.group;
      const box = new THREE.Box3().setFromObject(group);
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      group.position.sub(sphere.center);
      group.rotation.set(0.22, 0.72, -0.24);
      holder.add(group);

      const dist = (sphere.radius * 1.28) / Math.sin((camera.fov * Math.PI) / 360);
      camera.position.set(0, 0, dist);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      out.set(def.id, renderer.domElement.toDataURL('image/png'));
      holder.remove(group);
    } catch {
      /* skip broken icons */
    }
  }

  renderer.dispose();
  renderer.forceContextLoss();
  return out;
}
