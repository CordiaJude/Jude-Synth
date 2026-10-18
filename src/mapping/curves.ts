import type { Curve } from './types';

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Shape a normalized 0..1 value. Every curve maps 0 → 0 and 1 → 1 and is monotonic. */
export function applyCurve(x01: number, curve: Curve): number {
  const x = clamp01(x01);
  switch (curve.kind) {
    case 'linear':
      return x;
    case 'exp': {
      const k = Math.max(1e-3, curve.k);
      return (Math.exp(k * x) - 1) / (Math.exp(k) - 1);
    }
    case 'log': {
      const k = Math.max(1e-3, curve.k);
      return Math.log1p(k * x) / Math.log1p(k);
    }
    case 'pow':
      return Math.pow(x, Math.max(0.05, curve.gamma));
    case 'smoothstep':
      return x * x * (3 - 2 * x);
    case 'steps': {
      const n = Math.max(1, Math.round(curve.n));
      return n === 1 ? (x < 1 ? 0 : 1) : Math.min(n - 1, Math.floor(x * n)) / (n - 1);
    }
  }
}

/** Map an input in [a, b] to 0..1 with an optional centred deadzone (fraction of the range). */
export function normalizeInput(v: number, [a, b]: [number, number], deadzone = 0): number {
  let x = clamp01((v - a) / (b - a || 1e-9));
  const dz = Math.max(0, Math.min(0.49, deadzone));
  if (dz > 0) {
    const lo = 0.5 - dz;
    const hi = 0.5 + dz;
    x = x < lo ? (x / lo) * 0.5 : x > hi ? 0.5 + ((x - hi) / (1 - hi)) * 0.5 : 0.5;
  }
  return x;
}

export const CURVE_PRESETS: Array<{ label: string; curve: Curve }> = [
  { label: 'Linear', curve: { kind: 'linear' } },
  { label: 'Exponential', curve: { kind: 'exp', k: 3 } },
  { label: 'Logarithmic', curve: { kind: 'log', k: 9 } },
  { label: 'S-curve', curve: { kind: 'smoothstep' } },
  { label: 'Steps (4)', curve: { kind: 'steps', n: 4 } },
];
