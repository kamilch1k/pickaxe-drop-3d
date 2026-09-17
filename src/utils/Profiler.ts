/**
 * Tiny frame profiler. Zero-cost when disabled: every call site is guarded by
 * `enabled` in dev builds only.
 */
export class Profiler {
  enabled = false;
  private acc = new Map<string, number>();
  private frames = 0;
  private worst = new Map<string, number>();

  begin(): number {
    return this.enabled ? performance.now() : 0;
  }

  end(key: string, t0: number): void {
    if (!this.enabled || t0 === 0) return;
    const dt = performance.now() - t0;
    this.acc.set(key, (this.acc.get(key) ?? 0) + dt);
    if (dt > (this.worst.get(key) ?? 0)) this.worst.set(key, dt);
  }

  tick(): void {
    if (this.enabled) this.frames++;
  }

  reset(): void {
    this.acc.clear();
    this.worst.clear();
    this.frames = 0;
  }

  report(): { frames: number; avg: Record<string, number>; worst: Record<string, number> } {
    const avg: Record<string, number> = {};
    const worst: Record<string, number> = {};
    const n = Math.max(1, this.frames);
    for (const [k, v] of this.acc) avg[k] = +(v / n).toFixed(3);
    for (const [k, v] of this.worst) worst[k] = +v.toFixed(2);
    return { frames: this.frames, avg, worst };
  }
}
