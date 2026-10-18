import { describe, expect, it } from 'vitest';
import { conduct, DEFAULT_CONDUCTOR, initialConductorState } from '../../../src/performance/conductor';
import { CHORDS_AND_MELODY, CLASSIC_TWO_HAND, DJ_FX, THEREMIN_PRO } from '../../../src/mapping/presets';
import type { PoseId } from '../../../src/gestures/types';
import type { MusicEvent } from '../../../src/events/types';
import { chordsOf, paramsOf, perform } from '../support/perform';

const deg = (d: number) => (d * Math.PI) / 180;
const primary = (pose: PoseId, extra = {}) => ({ primary: { pose, ...extra } });

describe('Classic Two-Hand (via mapping + conductor)', () => {
  it('maps primary poses to diatonic degrees with Roman numerals', () => {
    const poses: PoseId[] = ['one', 'two', 'three', 'four', 'open', 'indexPinky', 'thumbIndexPinky'];
    const { perFrame } = perform(
      CLASSIC_TWO_HAND,
      poses.map((p) => primary(p)),
    );
    expect(perFrame.map((e) => chordsOf(e)[0]!.chord!.roman)).toEqual([
      'I',
      'ii',
      'iii',
      'IV',
      'V',
      'vi',
      'vii°',
    ]);
  });

  it('only emits a chord when it changes, and voice-leads it', () => {
    const { perFrame } = perform(
      CLASSIC_TWO_HAND,
      ['one', 'one', 'four', 'open', 'one'].map((p) => primary(p as PoseId)),
    );
    expect(perFrame.map((e) => chordsOf(e).length)).toEqual([1, 0, 1, 1, 1]);
    const v = perFrame.filter((e) => chordsOf(e).length).map((e) => chordsOf(e)[0]!.voicing);
    for (let i = 1; i < v.length; i++)
      expect(v[i]!.reduce((a, n, k) => a + Math.abs(n - v[i - 1]![k]!), 0)).toBeLessThanOrEqual(8);
  });

  it('tilting the wrist borrows from the parallel mode, with hysteresis', () => {
    const { perFrame } = perform(
      CLASSIC_TWO_HAND,
      [5, 35, 22, 10].map((r) => primary('four', { roll: deg(r) })),
    );
    expect(perFrame.map((e) => chordsOf(e)[0]?.chord?.roman ?? '-')).toEqual(['IV', 'iv', '-', 'IV']);
  });

  it('secondary hand shapes the chord; fist drops it an octave', () => {
    const { perFrame } = perform(
      CLASSIC_TWO_HAND,
      (['one', 'two', 'three', 'four', 'fist'] as PoseId[]).map((p) => ({
        primary: { pose: 'open' as PoseId },
        secondary: { pose: p },
      })),
    );
    const chords = perFrame.map((e) => chordsOf(e)[0]);
    expect(chords.slice(0, 4).map((c) => c!.chord!.name)).toEqual(['G', 'G7', 'G9', 'Gsus4']);
    const mean = (v: number[]) => v.reduce((a, b) => a + b) / v.length;
    expect(mean(chords[3]!.voicing) - mean(chords[4]!.voicing)).toBeGreaterThan(9);
  });

  it('fist or losing the primary hand releases chord and bass', () => {
    const { perFrame, state } = perform(CLASSIC_TWO_HAND, [
      primary('one'),
      primary('fist'),
      primary('two'),
      {},
    ]);
    expect(
      perFrame[1]!.filter((e) => e.kind === 'chord').map((e) => (e as { chord: unknown }).chord),
    ).toEqual([null, null]);
    expect(chordsOf(perFrame[3]!)[0]!.chord).toBeNull();
    expect(state.chord).toBeNull();
  });

  it('plays the root in the bass and drives volume/brightness/space from the secondary hand', () => {
    const { perFrame } = perform(CLASSIC_TWO_HAND, [
      {
        primary: { pose: 'indexPinky' },
        secondary: { pose: 'open', palmY: 0.88, roll: deg(50), depth: 0.25 },
      },
    ]);
    const bass = perFrame[0]!.find((e) => e.kind === 'chord' && e.slot === 'bass') as Extract<
      MusicEvent,
      { kind: 'chord' }
    >;
    expect(bass.voicing).toEqual([45]);
    const p = paramsOf(perFrame[0]!);
    expect(p['master.volume']).toBeCloseTo(1);
    expect(p['macro.brightness']).toBeCloseTo(1);
    expect(p['macro.space']).toBeCloseTo(0.1);
  });

  it('carries the camera capture time for latency measurement', () => {
    const { perFrame } = perform(CLASSIC_TWO_HAND, [primary('one')]);
    expect(chordsOf(perFrame[0]!)[0]!.cause).toEqual({ captureTime: 1000 });
  });

  it('works in any key and mode', () => {
    const { perFrame } = perform(
      CLASSIC_TWO_HAND,
      ['one', 'four', 'indexPinky'].map((p) => primary(p as PoseId)),
      { key: { tonic: 2, mode: 'dorian' } },
    );
    expect(perFrame.map((e) => chordsOf(e)[0]!.chord!.name)).toEqual(['Dm', 'G', 'Bdim']);
  });
});

describe('One-Hand Chords + Melody', () => {
  it('pinch plays a scale-locked note at the hand height, release stops it', () => {
    const steps = [
      { secondary: { pose: 'open' as PoseId, palmY: 0.5 } },
      {
        secondary: { pose: 'open' as PoseId, palmY: 0.5 },
        events: [{ type: 'pinchStart' as const, hand: 2, role: 'secondary' as const, time: 0 }],
      },
      { secondary: { pose: 'open' as PoseId, palmY: 0.8 } },
      {
        secondary: { pose: 'open' as PoseId, palmY: 0.8 },
        events: [{ type: 'pinchEnd' as const, hand: 2, role: 'secondary' as const, time: 0 }],
      },
    ];
    const { perFrame } = perform(CHORDS_AND_MELODY, steps);
    const on = perFrame[1]!.find((e) => e.kind === 'noteOn') as Extract<MusicEvent, { kind: 'noteOn' }>;
    expect(on.slot).toBe('melody');
    expect(Number.isInteger(on.note)).toBe(true);
    expect([0, 2, 4, 5, 7, 9, 11]).toContain(on.note % 12);
    const bend = perFrame[2]!.find((e) => e.kind === 'pitch') as Extract<MusicEvent, { kind: 'pitch' }>;
    expect(bend.note).toBeGreaterThan(on.note);
    expect(perFrame[3]!.find((e) => e.kind === 'noteOff')).toBeTruthy();
  });

  it('the primary hand still plays chords at the same time', () => {
    const { perFrame } = perform(CHORDS_AND_MELODY, [
      { primary: { pose: 'four' }, secondary: { pose: 'open' } },
    ]);
    expect(chordsOf(perFrame[0]!)[0]!.chord!.roman).toBe('IV');
  });
});

describe('Theremin Pro', () => {
  it('sounds while the pitch hand is in view, with free-ish pitch and tremor vibrato', () => {
    const { perFrame } = perform(THEREMIN_PRO, [
      { secondary: { pose: 'open', palmY: 0.5, tremor: 0.3 }, primary: { pose: 'open', palmY: 0.6 } },
      { secondary: { pose: 'open', palmY: 0.52, tremor: 0.3 }, primary: { pose: 'open', palmY: 0.6 } },
      {},
    ]);
    const on = perFrame[0]!.find((e) => e.kind === 'noteOn') as Extract<MusicEvent, { kind: 'noteOn' }>;
    expect(on).toBeTruthy();
    const p = paramsOf(perFrame[0]!);
    expect(p['melody.vibrato']).toBeGreaterThan(0.3);
    expect(p['melody.level']).toBeGreaterThan(0.3);
    const bend = perFrame[1]!.find((e) => e.kind === 'pitch') as Extract<MusicEvent, { kind: 'pitch' }>;
    expect(bend).toBeTruthy();
    expect(Number.isInteger(bend.note)).toBe(false); // snap 0.6: pulled toward, not locked to, the scale
    expect(perFrame[2]!.find((e) => e.kind === 'noteOff')).toBeTruthy();
    expect(chordsOf(perFrame.flat())).toHaveLength(0);
  });
});

describe('DJ/FX', () => {
  it('sweeps the DJ filter with a bypass deadzone in the middle', () => {
    const { perFrame } = perform(DJ_FX, [
      { secondary: { pose: 'open', palmX: 0.75 } },
      { secondary: { pose: 'open', palmX: 0.55 } },
      { secondary: { pose: 'open', palmX: 0.95 } },
    ]);
    expect(paramsOf(perFrame[0]!)['fx.djFilter']).toBeCloseTo(0.5);
    expect(paramsOf(perFrame[1]!)['fx.djFilter']).toBeCloseTo(0);
    expect(paramsOf(perFrame[2]!)['fx.djFilter']).toBeCloseTo(1);
  });

  it('closing the FX hand adds grit', () => {
    const { perFrame } = perform(DJ_FX, [{ secondary: { pose: 'fist', openness: 0.1 } }]);
    expect(paramsOf(perFrame[0]!)['macro.grit']).toBeCloseTo(0.85);
  });
});

describe('conductor', () => {
  it('latch keeps the chord through a release', () => {
    let s = initialConductorState();
    s = conduct(s, { actions: [{ type: 'chord.degree', degree: 1 }], params: [] }, 0).state;
    s = conduct(s, { actions: [{ type: 'latch.toggle' }], params: [] }, 0).state;
    const r = conduct(s, { actions: [{ type: 'chord.release' }], params: [] }, 0);
    expect(r.events).toHaveLength(0);
    expect(r.state.chord?.name).toBe('C');
  });

  it('plays fixed borrowed chords and inversion bias', () => {
    let s = initialConductorState();
    const r1 = conduct(
      s,
      { actions: [{ type: 'chord.borrowed', chord: 'bVII' }], params: [] },
      0,
      DEFAULT_CONDUCTOR,
    );
    expect(chordsOf(r1.events)[0]!.chord!.roman).toBe('♭VII');
    s = r1.state;
    const r2 = conduct(s, { actions: [{ type: 'chord.inversionBias', value: 1 }], params: [] }, 0);
    const before = chordsOf(r1.events)[0]!.voicing;
    const after = chordsOf(r2.events)[0]!.voicing;
    expect(after.reduce((a, b) => a + b)).toBeGreaterThan(before.reduce((a, b) => a + b));
  });

  it('a melody gate opened before any pitch waits for the pitch', () => {
    let s = initialConductorState('melody');
    const r1 = conduct(s, { actions: [{ type: 'melody.gate', on: true }], params: [] }, 0);
    expect(r1.events).toHaveLength(0);
    s = r1.state;
    const r2 = conduct(
      s,
      { actions: [], params: [{ target: 'melody.pitch', value: 0.5, rampMs: 30, mappingId: 'x' }] },
      0,
    );
    expect(r2.events.map((e) => e.kind)).toEqual(['noteOn']);
  });
});
