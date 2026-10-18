// One Euro filter (Casiez, Roussel & Vogel, CHI 2012): an adaptive low-pass whose cutoff rises with speed,
// so slow movements are smoothed heavily (no jitter) and fast movements pass with little lag.

export interface OneEuroParams {
  /** Cutoff (Hz) at zero speed. Lower = smoother at rest, more lag. */
  minCutoff: number;
  /** Speed coefficient. Higher = less lag on fast motion. */
  beta: number;
  /** Cutoff (Hz) for the derivative estimate. */
  dCutoff: number;
}

/**
 * Tuned for normalized image coordinates (a fast hand moves ~2–4 frame-widths per second), so beta is far
 * larger than the 0.007 often quoted for pixel coordinates.
 */
export const DEFAULT_ONE_EURO: OneEuroParams = { minCutoff: 1.2, beta: 4, dCutoff: 1.0 };

/**
 * For hand-centred world landmarks (metres). They only move with articulation, and finger curls must come
 * through fast because they change chords — so a higher floor cutoff and a steep beta.
 */
export const DEFAULT_ONE_EURO_WORLD: OneEuroParams = { minCutoff: 2.5, beta: 20, dCutoff: 1.0 };

const alpha = (cutoff: number, dt: number): number => {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
};

/**
 * A bank of N independent One Euro filters sharing one timestamp — one per landmark coordinate.
 * State lives in typed arrays so filtering a hand allocates nothing.
 */
export class OneEuroBank {
  private x: Float64Array;
  private dx: Float64Array;
  private lastT = -1;

  constructor(
    readonly size: number,
    public params: OneEuroParams = DEFAULT_ONE_EURO,
  ) {
    this.x = new Float64Array(size);
    this.dx = new Float64Array(size);
  }

  reset(): void {
    this.lastT = -1;
  }

  /**
   * Filter `input` in place into `out` (may alias input). `tMs` is a monotonic timestamp in milliseconds.
   * The first sample after a reset passes through unchanged.
   */
  filter(input: ArrayLike<number>, tMs: number, out: Float32Array | Float64Array): void {
    const n = this.size;
    if (this.lastT < 0 || tMs <= this.lastT) {
      const first = this.lastT < 0;
      for (let i = 0; i < n; i++) {
        const v = input[i] ?? 0;
        if (first) {
          this.x[i] = v;
          this.dx[i] = 0;
        }
        out[i] = this.x[i]!;
      }
      if (first) this.lastT = tMs;
      return;
    }
    const dt = (tMs - this.lastT) / 1000;
    this.lastT = tMs;
    const { minCutoff, beta, dCutoff } = this.params;
    const aD = alpha(dCutoff, dt);
    for (let i = 0; i < n; i++) {
      const v = input[i] ?? 0;
      const prev = this.x[i]!;
      const rawD = (v - prev) / dt;
      const d = this.dx[i]! + aD * (rawD - this.dx[i]!);
      this.dx[i] = d;
      const cutoff = minCutoff + beta * Math.abs(d);
      const filtered = prev + alpha(cutoff, dt) * (v - prev);
      this.x[i] = filtered;
      out[i] = filtered;
    }
  }
}
