import { describe, expect, it } from 'vitest';
import { detectSineClicks, detectTransientClicks } from '../../../src/audio/testing/clickDetect';
import { gaussian, mulberry32 } from '../../../src/gestures/testing/synthetic';

const SR = 48000;
const sig = (seconds: number, f: (t: number, i: number) => number) =>
  Float32Array.from({ length: Math.round(seconds * SR) }, (_, i) => f(i / SR, i));

describe('detectSineClicks', () => {
  it('passes smooth glides and smooth envelopes', () => {
    let phase = 0;
    const x = sig(1, (t) => {
      const f = 220 + 440 * Math.min(1, t * 2); // glide 220 → 660 Hz
      phase += (2 * Math.PI * f) / SR;
      const env = 1 - Math.exp(-t / 0.003); // fast but smooth attack
      return 0.5 * env * Math.sin(phase);
    });
    expect(detectSineClicks(x, SR, 700).clicks).toHaveLength(0);
  });

  it('flags a hard gain step (positive control)', () => {
    const x = sig(0.5, (t) => (t > 0.25 ? 0.5 : 0.1) * Math.sin(2 * Math.PI * 440 * t + 1));
    const r = detectSineClicks(x, SR, 500);
    expect(r.clicks.length).toBeGreaterThan(0);
    expect(r.clicks[0]!.time).toBeCloseTo(0.25, 2);
  });

  it('flags an oscillator restart (phase jump)', () => {
    const x = sig(
      0.5,
      (t) => 0.5 * Math.sin(2 * Math.PI * 440 * (t > 0.2 ? t - 0.2 : t) + (t > 0.2 ? 0 : 2)),
    );
    expect(detectSineClicks(x, SR, 500).clicks.length).toBeGreaterThan(0);
  });
});

describe('detectTransientClicks', () => {
  const rng = mulberry32(2);
  /** Band-limited saw (like an OscillatorNode's): harmonics up to 20 kHz. */
  const saw = (t: number, f: number) => {
    let v = 0;
    for (let k = 1; k * f < 20000; k++) v += Math.sin(2 * Math.PI * k * f * t) / k;
    return (v * 2) / Math.PI;
  };
  it('ignores a steady bright tone and slow swells', () => {
    const x = sig(1, (t) => 0.3 * Math.min(1, t * 3) * saw(t, 220) * 0.5 + gaussian(rng) * 1e-4);
    expect(detectTransientClicks(x, SR).clicks).toHaveLength(0);
  });

  it('a fast filter opening (sustained step up in brightness) is not a click', () => {
    let lp = 0;
    const x = sig(1, (t) => {
      const fc = t < 0.5 ? 800 : 800 + 9000 * Math.min(1, (t - 0.5) / 0.02); // opens over 20 ms
      const a = 1 - Math.exp((-2 * Math.PI * fc) / SR);
      lp += a * (saw(t, 220) * 0.3 - lp);
      return lp;
    });
    expect(detectTransientClicks(x, SR).clicks).toHaveLength(0);
  });

  it('flags a single-sample spike on top of music', () => {
    const x = sig(1, (t, i) => 0.2 * Math.sin(2 * Math.PI * 330 * t) + (i === 24000 ? 0.4 : 0));
    const r = detectTransientClicks(x, SR);
    expect(r.clicks.length).toBeGreaterThan(0);
    expect(r.clicks[0]!.time).toBeCloseTo(0.5, 2);
  });

  it('flags a hard cut of a sustained tone', () => {
    const x = sig(1, (t) => (t < 0.6 ? 0.4 * Math.sin(2 * Math.PI * 300 * t + 0.7) : 0));
    expect(detectTransientClicks(x, SR).clicks.length).toBeGreaterThan(0);
  });
});
