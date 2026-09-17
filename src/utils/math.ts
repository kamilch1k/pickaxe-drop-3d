export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number) => (b === a ? 0 : (v - a) / (b - a));
export const smoothstep = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
export const easeOutQuint = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 5);
export const easeInOutSine = (t: number) => -(Math.cos(Math.PI * clamp(t, 0, 1)) - 1) / 2;

/** Frame-rate independent exponential smoothing. */
export const damp = (a: number, b: number, lambda: number, dt: number) =>
  lerp(a, b, 1 - Math.exp(-lambda * dt));

export const TAU = Math.PI * 2;

const GROUP_RE = /\B(?=(\d{3})+(?!\d))/g;

/** Fast integer formatting with thousands separators (no Intl per call). */
export function formatNumber(n: number): string {
  if (!isFinite(n)) return '0';
  const v = Math.floor(Math.abs(n));
  if (v < 1000) return (n < 0 ? '-' : '') + String(v);
  if (v < 10000) return (n < 0 ? '-' : '') + String(v).replace(GROUP_RE, ',');
  const units = [
    { s: 1e15, u: 'Q' },
    { s: 1e12, u: 'T' },
    { s: 1e9, u: 'B' },
    { s: 1e6, u: 'M' },
  ];
  for (const { s, u } of units) {
    if (v >= s) {
      const scaled = v / s;
      return (n < 0 ? '-' : '') + (scaled < 10 ? scaled.toFixed(1) : Math.floor(scaled).toString()) + u;
    }
  }
  return (n < 0 ? '-' : '') + String(v).replace(GROUP_RE, ',');
}


export function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
}
