// Click / discontinuity detectors for offline renders. Pure functions over sample arrays.

export interface Click {
  index: number;
  time: number;
  ratio: number;
}

export interface ClickReport {
  clicks: Click[];
  worstRatio: number;
  peak: number;
  nonFinite: number;
}

/** Peak absolute value in a centred window, computed in O(n) blocks (approximate, block-max based). */
function localPeak(x: Float32Array, halfWindow: number): Float32Array {
  const block = Math.max(1, halfWindow);
  const blocks = Math.ceil(x.length / block);
  const bmax = new Float32Array(blocks);
  for (let i = 0; i < x.length; i++) {
    const b = (i / block) | 0;
    const a = Math.abs(x[i]!);
    if (a > bmax[b]!) bmax[b] = a;
  }
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const b = (i / block) | 0;
    out[i] = Math.max(bmax[b]!, bmax[b - 1] ?? 0, bmax[b + 1] ?? 0);
  }
  return out;
}

/**
 * Strict detector for signals made of (enveloped) sinusoids up to `maxFreq`. For a sum of sines with
 * amplitude A, |x''| ≤ A·ω², so the second difference is bounded by A·(2π·f/sr)². Any amplitude step or
 * phase jump blows through that bound by orders of magnitude.
 */
export function detectSineClicks(
  x: Float32Array,
  sampleRate: number,
  maxFreq: number,
  margin = 3,
): ClickReport {
  const w = (2 * Math.PI * maxFreq) / sampleRate;
  const bound = w * w;
  const env = localPeak(x, Math.round(sampleRate * 0.004));
  const clicks: Click[] = [];
  let worst = 0;
  let peak = 0;
  let nonFinite = 0;
  for (let i = 2; i < x.length; i++) {
    const v = x[i]!;
    if (!Number.isFinite(v)) {
      nonFinite++;
      continue;
    }
    peak = Math.max(peak, Math.abs(v));
    const d2 = Math.abs(v - 2 * x[i - 1]! + x[i - 2]!);
    // −80 dBFS absolute floor: a step that small is inaudible (and browsers snap decayed envelopes to their
    // target at around that level).
    const allowed = Math.max(env[i]! * bound * margin, 1e-4);
    const ratio = d2 / allowed;
    if (ratio > worst) worst = ratio;
    if (ratio > 1 && (clicks.length === 0 || i - clicks[clicks.length - 1]!.index > sampleRate * 0.005)) {
      clicks.push({ index: i, time: i / sampleRate, ratio });
    }
  }
  return { clicks, worstRatio: worst, peak, nonFinite };
}

/** 2nd-order high-pass (RBJ biquad), in place on a copy. */
export function highpass(x: Float32Array, sampleRate: number, fc: number): Float32Array {
  const w0 = (2 * Math.PI * fc) / sampleRate;
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
  const cos = Math.cos(w0);
  const a0 = 1 + alpha;
  const b0 = (1 + cos) / 2 / a0;
  const b1 = -(1 + cos) / a0;
  const b2 = b0;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;
  const y = new Float32Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i]!;
    const yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    y[i] = yi;
    x2 = x1;
    x1 = xi;
    y2 = y1;
    y1 = yi;
  }
  return y;
}

/**
 * Broadband-transient detector for real instruments. A click is a short broadband BURST: high-band energy
 * far above what comes both before and after it. (A sustained step up — the filter opening, a bright chord
 * starting — is a timbre change, not a click, so it is compared against the louder of the two sides.)
 * Windows span a full waveform period so a band-limited saw's per-cycle edge doesn't count.
 */
export function detectTransientClicks(
  x: Float32Array,
  sampleRate: number,
  opts: { cutoff?: number; ratio?: number; floorDb?: number; windowMs?: number } = {},
): ClickReport {
  const hp = highpass(x, sampleRate, opts.cutoff ?? 9000);
  const win = Math.round(sampleRate * ((opts.windowMs ?? 6) / 1000));
  const n = Math.floor(hp.length / win);
  const rms = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let s = 0;
    for (let i = k * win; i < (k + 1) * win; i++) s += hp[i]! * hp[i]!;
    rms[k] = Math.sqrt(s / win);
  }
  const floor = Math.pow(10, (opts.floorDb ?? -66) / 20);
  const ratioLimit = opts.ratio ?? 4;
  const ctxWin = Math.round(120 / (opts.windowMs ?? 6));
  const clicks: Click[] = [];
  let worst = 0;
  let peak = 0;
  let nonFinite = 0;
  for (const v of x) {
    if (!Number.isFinite(v)) nonFinite++;
    else peak = Math.max(peak, Math.abs(v));
  }
  const median = (lo: number, hi: number) => {
    const xs: number[] = [];
    for (let j = Math.max(0, lo); j < Math.min(n, hi); j++) xs.push(rms[j]!);
    xs.sort((a, b) => a - b);
    return xs[xs.length >> 1] ?? 0;
  };
  for (let k = 0; k < n; k++) {
    const before = median(k - ctxWin, k - 1);
    const after = median(k + 2, k + 2 + ctxWin);
    const ratio = rms[k]! / Math.max(before, after, floor);
    if (rms[k]! > floor && ratio > worst) worst = ratio;
    if (rms[k]! > floor && ratio > ratioLimit)
      clicks.push({ index: k * win, time: (k * win) / sampleRate, ratio });
  }
  return { clicks, worstRatio: worst, peak, nonFinite };
}
