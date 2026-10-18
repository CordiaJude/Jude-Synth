// Procedural stereo reverb impulse response: sparse early reflections + exponentially decaying noise whose
// high frequencies die faster (damping). Deterministic for a given seed, so offline renders are repeatable.

import { mulberry32 } from '../../gestures/testing/synthetic';

export interface ReverbShape {
  /** RT60 in seconds. */
  decay: number;
  /** 0 = bright hall, 1 = very dark. */
  damping: number;
  preDelay: number;
  seed?: number;
}

export function generateIR(sampleRate: number, shape: ReverbShape): [Float32Array, Float32Array] {
  const length = Math.ceil(sampleRate * (shape.preDelay + shape.decay * 1.1));
  const out: [Float32Array, Float32Array] = [new Float32Array(length), new Float32Array(length)];
  const pre = Math.floor(shape.preDelay * sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const rng = mulberry32((shape.seed ?? 7) + ch * 101);
    const buf = out[ch]!;
    let lp = 0;
    for (let i = pre; i < length; i++) {
      const t = (i - pre) / sampleRate;
      const env = Math.exp((-6.9 * t) / shape.decay); // −60 dB at t = decay
      // Damping: the lowpass closes over time (cutoff from ~12 kHz down toward ~1.5 kHz × (1 − damping)).
      const fc = 1500 + (12000 - 1500) * Math.exp(-t * (1 + shape.damping * 6)) * (1 - shape.damping * 0.6);
      const a = 1 - Math.exp((-2 * Math.PI * fc) / sampleRate);
      lp += a * (rng() * 2 - 1 - lp);
      // Fade in over the first 8 ms so the tail onset is smooth.
      const fadeIn = Math.min(1, t / 0.008);
      buf[i] = lp * env * fadeIn;
    }
    // Early reflections: a handful of decorrelated taps in the first 70 ms.
    for (let k = 0; k < 9; k++) {
      const at = pre + Math.floor((0.007 + rng() * 0.063) * sampleRate);
      if (at < length) buf[at] = (buf[at] ?? 0) + (rng() * 2 - 1) * 0.5 * Math.exp(-k * 0.25);
    }
  }
  // Normalize to unit energy per channel so mix levels mean the same thing for every shape.
  for (const buf of out) {
    let e = 0;
    for (const v of buf) e += v * v;
    const g = 1 / Math.sqrt(e || 1);
    for (let i = 0; i < buf.length; i++) buf[i]! *= g;
  }
  return out;
}
