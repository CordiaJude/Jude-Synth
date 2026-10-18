import { describe, expect, it } from 'vitest';
import {
  assignVoices,
  diatonicChord,
  DEFAULT_VOICING,
  movementCost,
  nearestScaleNote,
  quantizePitch,
  tonesToVoice,
  voiceLead,
  type Degree,
  type Key,
} from '../../../src/theory';

const C: Key = { tonic: 0, mode: 'ionian' };
const chord = (degree: Degree, extension: 'triad' | 'seventh' | 'ninth' = 'triad') =>
  diatonicChord(C, { degree, extension });
const pcs = (v: number[]) => new Set(v.map((m) => ((m % 12) + 12) % 12));

/** Brute-force reference: every voicing in the register, cheapest movement. */
function bruteMin(prev: number[], target: Set<number>, voices: number, [lo, hi]: [number, number]): number {
  let best = Infinity;
  const notes: number[] = [];
  for (let m = lo; m <= hi; m++) if (target.has(m % 12)) notes.push(m);
  const rec = (start: number, cur: number[]) => {
    if (cur.length === voices) {
      if (pcs(cur).size === target.size || voices < target.size)
        best = Math.min(best, movementCost(prev, cur));
      return;
    }
    for (let i = start; i < notes.length; i++) rec(i + 1, [...cur, notes[i]!]);
  };
  rec(0, []);
  return best;
}

describe('assignVoices', () => {
  it('pairs voices with minimal total movement and never crosses them', () => {
    const pairs = assignVoices([60, 64, 67], [60, 65, 69]);
    expect(pairs).toEqual([
      { from: 60, to: 60 },
      { from: 64, to: 65 },
      { from: 67, to: 69 },
    ]);
  });

  it('starts and stops voices when the counts differ', () => {
    const pairs = assignVoices([60, 64, 67], [60, 64, 67, 71]);
    expect(pairs.filter((p) => p.from === null)).toEqual([{ from: null, to: 71 }]);
    const fewer = assignVoices([55, 60, 64, 67], [60, 64, 67]);
    expect(fewer.filter((p) => p.to === null)).toEqual([{ from: 55, to: null }]);
  });
});

describe('voiceLead', () => {
  it('voices every chord tone inside the register', () => {
    for (const d of [1, 2, 3, 4, 5, 6, 7] as const) {
      const c = chord(d);
      const v = voiceLead(null, c);
      expect(v).toHaveLength(4);
      for (const m of v) {
        expect(m).toBeGreaterThanOrEqual(52);
        expect(m).toBeLessThanOrEqual(76);
      }
      expect(pcs(v)).toEqual(new Set(c.pitchClasses));
    }
  });

  it('I → IV → V → I moves by common tones and steps', () => {
    let v = voiceLead(null, chord(1));
    let total = 0;
    for (const d of [4, 5, 1] as const) {
      const next = voiceLead(v, chord(d));
      for (const p of assignVoices(v, next))
        expect(Math.abs((p.from ?? 0) - (p.to ?? 0))).toBeLessThanOrEqual(5);
      total += movementCost(v, next);
      v = next;
    }
    expect(total).toBeLessThanOrEqual(16);
  });

  it('matches the brute-force minimum movement (within the colour/centre tie-breaks)', () => {
    const prog = [1, 6, 4, 5, 2, 5, 1, 3, 6, 2, 7, 1] as const;
    let v = voiceLead(null, chord(1));
    for (const d of prog) {
      const c = chord(d);
      const next = voiceLead(v, c, { ...DEFAULT_VOICING, maxSpan: 24 });
      const min = bruteMin(v, new Set(c.pitchClasses), 4, DEFAULT_VOICING.register);
      expect(movementCost(v, next)).toBeLessThanOrEqual(min + 2);
      v = next;
    }
  });

  it('does not drift out of the register over a long progression', () => {
    let v = voiceLead(null, chord(1));
    const means: number[] = [];
    for (let i = 0; i < 64; i++) {
      v = voiceLead(v, chord((((i * 3) % 7) + 1) as Degree, i % 2 ? 'seventh' : 'triad'));
      means.push(v.reduce((a, b) => a + b, 0) / v.length);
    }
    expect(Math.max(...means) - Math.min(...means)).toBeLessThan(9);
  });

  it('respects rootInBass and inversion bias', () => {
    const v = voiceLead(null, chord(5), { ...DEFAULT_VOICING, rootInBass: true });
    expect(v[0]! % 12).toBe(7);
    const up = voiceLead(null, chord(1), { ...DEFAULT_VOICING, inversionBias: 1 });
    const down = voiceLead(null, chord(1), { ...DEFAULT_VOICING, inversionBias: -1 });
    expect(up.reduce((a, b) => a + b)).toBeGreaterThan(down.reduce((a, b) => a + b));
  });

  it('fits extended chords to the voice count (drops the fifth first)', () => {
    const g9 = chord(5, 'ninth');
    expect(tonesToVoice(g9, 4).sort()).toEqual([7, 11, 5, 9].sort());
    expect(tonesToVoice(chord(1), 5)).toHaveLength(5);
  });

  it('is deterministic', () => {
    const a = voiceLead([55, 60, 64, 67], chord(6, 'seventh'));
    const b = voiceLead([55, 60, 64, 67], chord(6, 'seventh'));
    expect(a).toEqual(b);
  });
});

describe('quantizer', () => {
  it('hard snap lands on scale tones, free pitch passes through', () => {
    expect(quantizePitch(60.9, C, 1)).toBe(60);
    expect(quantizePitch(61.2, C, 1)).toBe(62);
    expect(quantizePitch(61.3, C, 0)).toBeCloseTo(61.3);
    expect(nearestScaleNote(66.4, C)).toBe(67);
    expect(nearestScaleNote(65.9, C)).toBe(65);
  });

  it('partial snap pulls toward the note proportionally', () => {
    expect(quantizePitch(60.4, C, 0.5)).toBeCloseTo(60.2);
    expect(quantizePitch(59.4, C, 0.75)).toBeCloseTo(59 + 0.4 * 0.25); // B (59) is the nearest tone
  });

  it('works in other modes', () => {
    const dDorian: Key = { tonic: 2, mode: 'dorian' };
    expect(quantizePitch(65.4, dDorian, 1)).toBe(65); // F natural in D dorian
  });
});

describe('performance budget', () => {
  it('voice-leads a chord change in well under a millisecond (main-thread budget)', () => {
    let v = voiceLead(null, chord(1));
    const t0 = performance.now();
    const N = 500;
    for (let i = 0; i < N; i++) v = voiceLead(v, chord(((i % 7) + 1) as Degree, i % 3 ? 'seventh' : 'ninth'));
    const perCall = (performance.now() - t0) / N;
    expect(perCall).toBeLessThan(1);
  });
});
