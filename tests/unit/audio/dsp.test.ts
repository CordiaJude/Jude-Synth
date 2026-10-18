import { describe, expect, it } from 'vitest';
import { LimiterCore } from '../../../src/audio/dsp/limiter';
import { TapeCore } from '../../../src/audio/dsp/tape';
import { gaussian, mulberry32 } from '../../../src/gestures/testing/synthetic';

const SR = 48000;
const block = (n: number, f: (i: number) => number) => Float32Array.from({ length: n }, (_, i) => f(i));

function runLimiter(sig: Float32Array, ceilingDb = -1) {
  const lim = new LimiterCore(SR, ceilingDb);
  const out = new Float32Array(sig.length);
  const outR = new Float32Array(sig.length);
  for (let i = 0; i < sig.length; i += 128) {
    const a = sig.subarray(i, i + 128);
    lim.process(a, a, out.subarray(i, i + 128), outR.subarray(i, i + 128));
  }
  return { out, lim };
}

describe('LimiterCore', () => {
  it('never exceeds the ceiling, even on instant transients', () => {
    const rng = mulberry32(1);
    const sig = block(SR, (i) => (i > 10000 && i < 10010 ? 4 : 0) + gaussian(rng) * (i > 20000 ? 1.5 : 0.1));
    const { out } = runLimiter(sig);
    const ceiling = Math.pow(10, -1 / 20);
    let peak = 0;
    for (const v of out) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeLessThanOrEqual(ceiling * (1 + 1e-5)); // float32 rounding
  });

  it('is transparent (pure delay) below the ceiling', () => {
    const sig = block(4800, (i) => 0.5 * Math.sin(i * 0.05));
    const { out, lim } = runLimiter(sig);
    for (let i = lim.lookahead; i < sig.length; i++) expect(out[i]).toBeCloseTo(sig[i - lim.lookahead]!, 6);
  });

  it('changes gain smoothly: at most 1/(window) per sample, so it can never click', () => {
    const sig = block(SR / 2, (i) => (i > 5000 && i < 15000 ? 3 : 0.3) * Math.sin(i * 0.03));
    const lim = new LimiterCore(SR);
    const one = new Float32Array(1);
    const sink = new Float32Array(1);
    let prev = 1;
    let maxStep = 0;
    let minGain = 1;
    for (let i = 0; i < sig.length; i++) {
      one[0] = sig[i]!;
      lim.process(one, one, sink, sink);
      maxStep = Math.max(maxStep, Math.abs(lim.lastGain - prev));
      minGain = Math.min(minGain, lim.lastGain);
      prev = lim.lastGain;
    }
    expect(minGain).toBeLessThan(0.35); // it really limited
    expect(maxStep).toBeLessThanOrEqual(1 / (lim.lookahead + 1) + 1e-9);
  });
});

describe('TapeCore', () => {
  it('is an exact fixed delay when drive and wow are zero', () => {
    const tape = new TapeCore(SR);
    const sig = block(2048, (i) => Math.sin(i * 0.01));
    const out = new Float32Array(sig.length);
    tape.process(sig, sig, out, new Float32Array(sig.length), 0, 0);
    const d = Math.round(0.004 * SR);
    for (let i = d + 1; i < sig.length; i++) expect(out[i]).toBeCloseTo(sig[i - d]!, 5);
  });

  it('saturates loud signals and stays bounded', () => {
    const tape = new TapeCore(SR);
    const sig = block(4800, (i) => 3 * Math.sin(i * 0.02));
    const out = new Float32Array(sig.length);
    tape.process(sig, sig, out, new Float32Array(sig.length), 1, 0.5);
    for (const v of out) expect(Number.isFinite(v)).toBe(true);
    expect(Math.max(...out.map(Math.abs))).toBeLessThan(2); // saturates well short of the input's 3.0
  });

  it('keeps roughly unity gain at the nominal level as drive increases', () => {
    const rms = (d: number) => {
      const tape = new TapeCore(SR);
      const sig = block(9600, (i) => 0.25 * Math.sin(i * 0.02));
      const out = new Float32Array(sig.length);
      tape.process(sig, sig, out, new Float32Array(sig.length), d, 0);
      return Math.sqrt(out.slice(4800).reduce((a, v) => a + v * v, 0) / 4800);
    };
    const clean = rms(0);
    for (const d of [0.3, 0.6, 1]) expect(20 * Math.log10(rms(d) / clean)).toBeGreaterThan(-3);
  });
});
