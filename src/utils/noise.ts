import { Rng } from './rng';

/** Cheap seeded value-noise (lattice + smoothstep interpolation). */
export class ValueNoise {
  private lattice: Float32Array;
  private period: number;

  constructor(period: number, r: Rng) {
    this.period = period;
    this.lattice = new Float32Array(period * period);
    for (let i = 0; i < this.lattice.length; i++) this.lattice[i] = r.next();
  }

  private at(ix: number, iy: number): number {
    const p = this.period;
    const x = ((ix % p) + p) % p;
    const y = ((iy % p) + p) % p;
    return this.lattice[y * p + x];
  }

  /** 2D noise in roughly [0,1]. */
  noise2(x: number, y: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const n00 = this.at(x0, y0);
    const n10 = this.at(x0 + 1, y0);
    const n01 = this.at(x0, y0 + 1);
    const n11 = this.at(x0 + 1, y0 + 1);
    const a = n00 + (n10 - n00) * sx;
    const b = n01 + (n11 - n01) * sx;
    return a + (b - a) * sy;
  }

  fbm(x: number, y: number, octaves = 3, gain = 0.5): number {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let freq = 1;
    for (let i = 0; i < octaves; i++) {
      sum += this.noise2(x * freq, y * freq) * amp;
      norm += amp;
      amp *= gain;
      freq *= 2.1;
    }
    return sum / norm;
  }
}
