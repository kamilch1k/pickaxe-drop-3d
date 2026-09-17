import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { CameraDirector } from './CameraDirector';

export class SceneRig {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly director: CameraDirector;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private renderPass: RenderPass;
  private bloomEnabled = true;
  private frameTimes: number[] = [];
  private qualityCooldown = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.22;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.director = new CameraDirector(window.innerWidth / window.innerHeight);

    const w = window.innerWidth;
    const h = window.innerHeight;
    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.renderPass = new RenderPass(this.scene, this.director.camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.52, 0.62, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.addLights();
    window.addEventListener('resize', () => this.resize());
  }

  private keyLight!: THREE.DirectionalLight;
  private fillLight!: THREE.DirectionalLight;
  private rimLight!: THREE.DirectionalLight;

  private addLights(): void {
    const hemi = new THREE.HemisphereLight(0xb4cfff, 0x624a72, 0.7);
    this.scene.add(hemi);

    this.keyLight = new THREE.DirectionalLight(0xfff0d6, 2.3);
    this.keyLight.position.set(30, 42, 22);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    this.keyLight.shadow.camera.near = 1;
    this.keyLight.shadow.camera.far = 140;
    const sc = this.keyLight.shadow.camera as THREE.OrthographicCamera;
    sc.left = -30;
    sc.right = 30;
    sc.top = 30;
    sc.bottom = -30;
    this.keyLight.shadow.bias = -0.0009;
    this.keyLight.shadow.normalBias = 0.035;
    this.keyLight.target.position.set(0, 4, 0);
    this.scene.add(this.keyLight);
    this.scene.add(this.keyLight.target);

    this.fillLight = new THREE.DirectionalLight(0x8fb4ff, 0.5);
    this.fillLight.position.set(-26, 16, -20);
    this.scene.add(this.fillLight);

    this.rimLight = new THREE.DirectionalLight(0xff9a63, 0.55);
    this.rimLight.position.set(-14, 10, 26);
    this.scene.add(this.rimLight);
  }

  /** Test/benchmark helper: disables the expensive parts of the pipeline. */
  forceLowQuality(): void {
    this.setBloom(false);
    this.renderer.setPixelRatio(1);
    this.composer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = false;
    this.keyLight.castShadow = false;
  }

  setBloom(enabled: boolean): void {
    this.bloomEnabled = enabled;
    this.bloom.enabled = enabled;
  }

  get bloomIsOn(): boolean {
    return this.bloomEnabled;
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.director.camera.aspect = w / h;
    this.director.camera.updateProjectionMatrix();
  }

  /** Drops pixel ratio / bloom if the frame budget is repeatedly blown. */
  private adapt(dt: number): void {
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 90) this.frameTimes.shift();
    if (this.frameTimes.length < 90) return;
    this.qualityCooldown -= dt;
    if (this.qualityCooldown > 0) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    if (avg > 0.024 && this.renderer.getPixelRatio() > 1) {
      this.renderer.setPixelRatio(1);
      this.composer.setPixelRatio(1);
      this.qualityCooldown = 3;
    } else if (avg > 0.033 && this.bloomEnabled) {
      this.setBloom(false);
      this.qualityCooldown = 6;
    }
  }

  render(dt: number): void {
    this.adapt(dt);
    if (this.bloomEnabled) this.composer.render();
    else {
      this.renderer.render(this.scene, this.director.camera);
    }
  }
}
