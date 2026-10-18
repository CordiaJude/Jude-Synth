import { describe, expect, it } from 'vitest';
import { OneEuroBank } from '../../../src/vision/oneEuro';
import { gaussian, mulberry32 } from '../../../src/gestures/testing/synthetic';

const run = (bank: OneEuroBank, signal: (t: number) => number, frames: number, dtMs: number) => {
  const out = new Float64Array(1);
  const res: number[] = [];
  for (let i = 0; i < frames; i++) {
    bank.filter([signal(i * dtMs)], i * dtMs, out);
    res.push(out[0]!);
  }
  return res;
};

const std = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};

describe('OneEuroBank', () => {
  it('passes the first sample through unchanged', () => {
    const bank = new OneEuroBank(3);
    const out = new Float32Array(3);
    bank.filter([1, 2, 3], 0, out);
    expect(Array.from(out)).toEqual([1, 2, 3]);
  });

  it('removes most jitter from a hand held still', () => {
    const rng = mulberry32(7);
    const noise = Array.from({ length: 300 }, () => gaussian(rng) * 0.004);
    const bank = new OneEuroBank(1);
    const out = run(bank, (t) => 0.5 + noise[Math.round(t / 33)]!, 300, 33);
    expect(std(out.slice(30))).toBeLessThan(std(noise) * 0.4);
  });

  it('tracks fast motion with little lag thanks to beta', () => {
    const fast = new OneEuroBank(1);
    const slowOnly = new OneEuroBank(1, { ...fast.params, beta: 0 });
    const ramp = (t: number) => t / 500; // 2 frame-widths per second: a quick hand sweep
    const a = run(fast, ramp, 30, 16);
    const b = run(slowOnly, ramp, 30, 16);
    const lagA = ramp(29 * 16) - a[29]!;
    const lagB = ramp(29 * 16) - b[29]!;
    expect(lagA).toBeLessThan(lagB * 0.5);
  });

  it('holds the value on duplicate timestamps and resets cleanly', () => {
    const bank = new OneEuroBank(1);
    const out = new Float64Array(1);
    bank.filter([0], 0, out);
    bank.filter([1], 0, out);
    expect(out[0]).toBe(0);
    bank.reset();
    bank.filter([5], 10, out);
    expect(out[0]).toBe(5);
  });
});
