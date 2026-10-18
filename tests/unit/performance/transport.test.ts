import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../../src/gestures/testing/synthetic';
import {
  beatAt,
  DEFAULT_QUANTIZE,
  quantizeTime,
  setTempo,
  timeAtBeat,
  type Transport,
} from '../../../src/performance/transport';

const T: Transport = { bpm: 120, origin: 10 }; // a beat every 0.5 s

describe('transport', () => {
  it('converts between time and beats', () => {
    expect(beatAt(T, 11)).toBeCloseTo(2);
    expect(timeAtBeat(T, 3)).toBeCloseTo(11.5);
  });

  it('changes tempo without moving the current beat', () => {
    const t2 = setTempo(T, 90, 12);
    expect(beatAt(t2, 12)).toBeCloseTo(beatAt(T, 12));
    expect(t2.bpm).toBe(90);
    expect(setTempo(T, 999, 12).bpm).toBe(220);
  });
});

describe('quantizeTime', () => {
  const q = { ...DEFAULT_QUANTIZE, grid: '1/8' as const }; // grid every 0.25 s

  it('off leaves timing alone', () => {
    expect(quantizeTime(11.1, T, DEFAULT_QUANTIZE, 0)).toBe(11.1);
  });

  it('pulls a late-ish event forward to the next grid line', () => {
    expect(quantizeTime(11.1, T, q, 0)).toBeCloseTo(11.25);
  });

  it('plays immediately if a grid line just passed (late tolerance)', () => {
    expect(quantizeTime(11.02, T, q, 0)).toBeCloseTo(11.02);
  });

  it('strength interpolates toward the grid', () => {
    expect(quantizeTime(11.1, T, { ...q, strength: 0.5 }, 0)).toBeCloseTo(11.175);
  });

  it('supports triplet sixteenths', () => {
    const out = quantizeTime(11.05, T, { ...q, grid: '1/16T' }, 0);
    expect(out).toBeCloseTo(11 + 0.5 / 6);
  });

  it('humanize stays within ± bounds and never schedules before `earliest`', () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 500; i++) {
      const out = quantizeTime(11.25, T, { ...q, grid: 'off', humanizeMs: 15 }, 11.24, rng);
      expect(out).toBeGreaterThanOrEqual(11.24);
      expect(Math.abs(out - 11.25)).toBeLessThanOrEqual(0.015 + 1e-9);
    }
  });
});
