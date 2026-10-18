import { describe, expect, it } from 'vitest';
import { applyCurve, normalizeInput } from '../../../src/mapping/curves';
import { createMappingState, evaluateMapping, mapValue, readSource } from '../../../src/mapping/evaluate';
import { BUILT_IN_PRESETS, CLASSIC_TWO_HAND } from '../../../src/mapping/presets';
import { validatePreset } from '../../../src/mapping/schema';
import type { ContinuousMapping, Curve, MappingPreset } from '../../../src/mapping/types';
import { framesFrom } from '../support/gestures';

const curves: Curve[] = [
  { kind: 'linear' },
  { kind: 'exp', k: 3 },
  { kind: 'log', k: 9 },
  { kind: 'pow', gamma: 2 },
  { kind: 'smoothstep' },
  { kind: 'steps', n: 4 },
];

describe('curves', () => {
  for (const c of curves) {
    it(`${c.kind}: maps 0→0, 1→1, monotonic, clamped`, () => {
      expect(applyCurve(0, c)).toBeCloseTo(0);
      expect(applyCurve(1, c)).toBeCloseTo(1);
      expect(applyCurve(-3, c)).toBeCloseTo(0);
      expect(applyCurve(7, c)).toBeCloseTo(1);
      let last = -1;
      for (let x = 0; x <= 1.0001; x += 0.01) {
        const y = applyCurve(x, c);
        expect(y).toBeGreaterThanOrEqual(last - 1e-12);
        last = y;
      }
    });
  }

  it('exp is slow then fast, log is fast then slow', () => {
    expect(applyCurve(0.5, { kind: 'exp', k: 3 })).toBeLessThan(0.3);
    expect(applyCurve(0.5, { kind: 'log', k: 9 })).toBeGreaterThan(0.6);
  });

  it('steps quantize into n levels', () => {
    const levels = new Set(
      Array.from({ length: 101 }, (_, i) => applyCurve(i / 100, { kind: 'steps', n: 4 })),
    );
    expect([...levels].sort()).toEqual([0, 1 / 3, 2 / 3, 1]);
  });

  it('deadzone holds the centre at 0.5 and still reaches both ends', () => {
    expect(normalizeInput(0.5, [0, 1], 0.1)).toBe(0.5);
    expect(normalizeInput(0.55, [0, 1], 0.1)).toBe(0.5);
    expect(normalizeInput(0, [0, 1], 0.1)).toBe(0);
    expect(normalizeInput(1, [0, 1], 0.1)).toBe(1);
    expect(normalizeInput(0.3, [0, 1], 0.1)).toBeCloseTo(0.375);
  });
});

describe('mapValue', () => {
  const m: ContinuousMapping = {
    id: 'x',
    source: 'secondary.palmY',
    target: 'master.volume',
    inRange: [0.2, 0.8],
    outRange: [0.1, 0.9],
    curve: { kind: 'linear' },
    invert: false,
  };
  it('scales input range to output range', () => {
    expect(mapValue(m, 0.5).output).toBeCloseTo(0.5);
    expect(mapValue(m, 0.2).output).toBeCloseTo(0.1);
    expect(mapValue(m, 0.95).output).toBeCloseTo(0.9);
  });
  it('inverts', () => {
    expect(mapValue({ ...m, invert: true }, 0.2).output).toBeCloseTo(0.9);
  });
  it('supports reversed ranges', () => {
    expect(mapValue({ ...m, inRange: [0.8, 0.2] }, 0.8).output).toBeCloseTo(0.1);
  });
});

describe('readSource', () => {
  const [f] = framesFrom([{ primary: { pose: 'open', roll: -0.7, palmY: 0.3 } }]);
  it('reads features, derived features and missing hands', () => {
    expect(readSource(f!, 'primary.palmY')).toBe(0.3);
    expect(readSource(f!, 'primary.rollAbs')).toBeCloseTo(0.7);
    expect(readSource(f!, 'primary.finger.index')).toBe(0.5);
    expect(readSource(f!, 'secondary.palmY')).toBeNull();
    expect(readSource(f!, 'twoHand.distance')).toBeNull();
  });
});

describe('evaluateMapping', () => {
  it('fires pose triggers on enter (and onExit), not while held', () => {
    let st = createMappingState();
    const out = framesFrom([
      { secondary: { pose: 'two' } },
      { secondary: { pose: 'two' } },
      { secondary: { pose: 'fist' } },
      { secondary: { pose: 'open' } },
    ]).map((f) => {
      const r = evaluateMapping(CLASSIC_TWO_HAND, f, st, 'chords');
      st = r.state;
      return r.out.actions;
    });
    expect(out[0]).toEqual([{ type: 'chord.shape', extension: 'seventh', quality: 'diatonic' }]);
    expect(out[1]).toEqual([]);
    expect(out[2]).toEqual([{ type: 'chord.octave', value: -1 }]);
    expect(out[3]).toEqual(
      expect.arrayContaining([
        { type: 'chord.octave', value: 0 },
        { type: 'chord.shape', extension: 'triad', quality: 'diatonic' },
      ]),
    );
  });

  it('treats an already-held pose as entered on the first frame (e.g. after switching presets)', () => {
    const [, f] = framesFrom([{ primary: { pose: 'four' } }, { primary: { pose: 'four' } }]);
    const r = evaluateMapping(CLASSIC_TWO_HAND, f!, createMappingState(), 'chords');
    expect(r.out.actions).toContainEqual({ type: 'chord.degree', degree: 4 });
  });

  it('threshold triggers have hysteresis and exit when the hand disappears', () => {
    let st = createMappingState();
    const deg = (d: number) => (d * Math.PI) / 180;
    const steps = [5, 35, 22, 10, 35].map((r) => ({ primary: { pose: 'none' as const, roll: deg(r) } }));
    const frames = [...framesFrom(steps), ...framesFrom([{}])];
    const out = frames.map((f) => {
      const r = evaluateMapping(CLASSIC_TWO_HAND, f, st, 'chords');
      st = r.state;
      return r.out.actions
        .filter((a) => a.type === 'chord.parallel')
        .map((a) => (a as { value: boolean }).value);
    });
    expect(out).toEqual([[], [true], [], [false], [true], [false]]);
  });

  it('emits continuous params only when they change, and reports live inputs', () => {
    let st = createMappingState();
    const frames = framesFrom([
      { secondary: { pose: 'open', palmY: 0.5 } },
      { secondary: { pose: 'open', palmY: 0.5005 } },
      { secondary: { pose: 'open', palmY: 0.7 } },
    ]);
    const vol = frames.map((f) => {
      const r = evaluateMapping(CLASSIC_TWO_HAND, f, st, 'chords');
      st = r.state;
      expect(r.out.inputs['c-vol']!.active).toBe(true);
      return r.out.params.filter((p) => p.target === 'master.volume').length;
    });
    expect(vol).toEqual([1, 0, 1]);
  });

  it('honours enabledWhen conditions', () => {
    const preset: MappingPreset = {
      ...CLASSIC_TWO_HAND,
      discrete: [],
      continuous: [
        { ...CLASSIC_TWO_HAND.continuous[0]!, enabledWhen: { pose: { role: 'secondary', is: ['open'] } } },
      ],
    };
    const [a, b] = framesFrom([
      { secondary: { pose: 'open', palmY: 0.4 } },
      { secondary: { pose: 'fist', palmY: 0.8 } },
    ]);
    const st = createMappingState();
    expect(evaluateMapping(preset, a!, st, 'chords').out.params).toHaveLength(1);
    expect(evaluateMapping(preset, b!, st, 'chords').out.params).toHaveLength(0);
  });

  it('matches swipe directions', () => {
    const preset = BUILT_IN_PRESETS.find((p) => p.id === 'chords-melody')!;
    const [f] = framesFrom([
      {
        secondary: { pose: 'open' },
        events: [{ type: 'swipe', hand: 2, role: 'secondary', time: 0, direction: 'up', speed: 3 }],
      },
    ]);
    const r = evaluateMapping(preset, f!, createMappingState(), 'melody');
    expect(r.out.actions).toContainEqual({ type: 'melody.octave', delta: 1 });
    expect(r.out.actions).not.toContainEqual({ type: 'melody.octave', delta: -1 });
  });
});

describe('presets', () => {
  it('ships four built-in presets that all validate', () => {
    expect(BUILT_IN_PRESETS.map((p) => p.name)).toEqual([
      'Classic Two-Hand',
      'One-Hand Chords + Melody',
      'Theremin Pro',
      'DJ/FX',
    ]);
    for (const p of BUILT_IN_PRESETS) {
      const r = validatePreset(JSON.parse(JSON.stringify(p)));
      expect(r.ok, JSON.stringify(r)).toBe(true);
    }
  });

  it('has unique mapping ids within each preset', () => {
    for (const p of BUILT_IN_PRESETS) {
      const ids = [...p.continuous, ...p.discrete].map((m) => m.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('rejects malformed presets with readable errors', () => {
    const bad = { ...JSON.parse(JSON.stringify(CLASSIC_TWO_HAND)), version: 2 };
    bad.continuous[0].target = 'master.nonsense';
    bad.discrete[0].trigger.pose = 'wave';
    const r = validatePreset(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join('\n')).toMatch(/version/);
      expect(r.errors.join('\n')).toMatch(/continuous\.0\.target/);
      expect(r.errors.join('\n')).toMatch(/discrete\.0\.trigger/);
    }
  });
});
