import * as THREE from 'three';
import type { CameraDirector } from '../scene/CameraDirector';
import { el } from './dom';

export interface FloatOptions {
  color?: string;
  size?: number;
  crit?: boolean;
  duration?: number;
}

export class Floats {
  private layer: HTMLElement;

  constructor(
    private director: CameraDirector,
    parent: HTMLElement,
  ) {
    this.layer = el('div');
    this.layer.id = 'floats';
    parent.appendChild(this.layer);
  }

  private project(world: THREE.Vector3): { x: number; y: number } {
    const s = this.director.screenPosition(world, window.innerWidth, window.innerHeight);
    return { x: s.x, y: s.y };
  }

  text(world: THREE.Vector3, value: string, opts: FloatOptions = {}): void {
    const p = this.project(world);
    const node = el('div', 'float-text' + (opts.crit ? ' crit' : ''), value);
    node.style.left = `${p.x}px`;
    node.style.top = `${p.y}px`;
    node.style.fontSize = `${opts.size ?? 22}px`;
    node.style.color = opts.color ?? '#ffe08a';
    if (opts.crit) node.style.color = '#fff';
    this.layer.appendChild(node);
    window.setTimeout(() => node.remove(), (opts.duration ?? 1.05) * 1000);
  }

  coins(world: THREE.Vector3, targetRect: DOMRect, count = 5): void {
    const p = this.project(world);
    for (let i = 0; i < count; i++) {
      const node = el('div', 'coin-fly');
      const jitterX = (Math.random() - 0.5) * 46;
      const jitterY = (Math.random() - 0.5) * 34;
      node.style.left = `${p.x + jitterX}px`;
      node.style.top = `${p.y + jitterY}px`;
      this.layer.appendChild(node);
      const dx = targetRect.left + targetRect.width * 0.24 - (p.x + jitterX);
      const dy = targetRect.top + targetRect.height * 0.5 - (p.y + jitterY);
      const anim = node.animate(
        [
          { transform: 'translate(0px, 0px) scale(0.5)', opacity: 0 },
          { transform: `translate(${dx * 0.12 - 10}px, ${dy * 0.1 - 34}px) scale(1.2)`, opacity: 1, offset: 0.28 },
          { transform: `translate(${dx}px, ${dy}px) scale(0.42)`, opacity: 0.15 },
        ],
        {
          duration: 620 + i * 55,
          delay: i * 28,
          easing: 'cubic-bezier(.35,.05,.45,1)',
          fill: 'forwards',
        },
      );
      anim.onfinish = () => node.remove();
    }
  }
}
