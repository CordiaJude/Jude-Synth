import { describe, expect, it } from 'vitest';
import {
  classicStep,
  DEFAULT_CLASSIC,
  initialClassicState,
  type ClassicState,
} from '../../../src/performance/classic';
import type { GestureEvent, GestureFrame, HandGesture, PoseId } from '../../../src/gestures/types';
import type { MusicEvent } from '../../../src/events/types';

const deg = (d: number) => (d * Math.PI) / 180;

function hand(
  role: 'primary' | 'secondary',
  pose: PoseId,
  f: Partial<HandGesture['features']> = {},
): HandGesture {
  const finger = { extension: 0, extended: false, velocity: 0 };
  return {
    id: role === 'primary' ? 1 : 2,
    role,
    handedness: role === 'primary' ? 'Left' : 'Right',
    presence: 1,
    coasting: false,
    fingers: { thumb: finger, index: finger, middle: finger, ring: finger, pinky: finger },
    count: 0,
    pinching: false,
    pose: { pose, confidence: 1, ranked: [], heldMs: 100, tentative: false },
    features: {
      palmX: 0.5,
      palmY: 0.5,
      depth: 0.5,
      roll: 0,
      pitch: 0,
      yaw: 0,
      palmFacing: 1,
      pinch: 1,
      openness: 0.5,
      velocity: { x: 0, y: 0, z: 0 },
      acceleration: { x: 0, y: 0, z: 0 },
      speed: 0,
      tremor: 0,
      ...f,
    },
  };
}

const frame = (hands: HandGesture[], events: GestureEvent[] = []): GestureFrame => ({
  frameId: 0,
  time: 1000,
  hands,
  twoHand: null,
  events,
  quality: { meanPresence: 1, lowLight: false },
  timing: { captureTime: 1000, detectStart: 1000, detectEnd: 1010, recognizeEnd: 1011 },
});

function play(frames: GestureFrame[], settings = DEFAULT_CLASSIC) {
  let st: ClassicState = initialClassicState();
  const all: MusicEvent[][] = [];
  frames.forEach((f, i) => {
    const r = classicStep(st, f, i * 0.05, settings);
    st = r.state;
    all.push(r.events);
  });
  return { st, all };
}

const chordEvents = (evs: MusicEvent[]) =>
  evs.filter((e): e is Extract<MusicEvent, { kind: 'chord' }> => e.kind === 'chord' && e.slot === 'chords');

describe('Classic Two-Hand', () => {
  it('maps primary poses to diatonic degrees with Roman numerals', () => {
    const poses: PoseId[] = ['one', 'two', 'three', 'four', 'open', 'indexPinky', 'thumbIndexPinky'];
    const { all } = play(poses.map((p) => frame([hand('primary', p)])));
    expect(all.map((e) => chordEvents(e)[0]!.chord!.roman)).toEqual([
      'I',
      'ii',
      'iii',
      'IV',
      'V',
      'vi',
      'vii°',
    ]);
  });

  it('only emits a chord when it actually changes', () => {
    const { all } = play([
      frame([hand('primary', 'one')]),
      frame([hand('primary', 'one')]),
      frame([hand('primary', 'one')]),
    ]);
    expect(all.map((e) => chordEvents(e).length)).toEqual([1, 0, 0]);
  });

  it('voice-leads consecutive chords (small moves)', () => {
    const { all } = play(['one', 'four', 'open', 'one'].map((p) => frame([hand('primary', p as PoseId)])));
    const voicings = all.map((e) => chordEvents(e)[0]!.voicing);
    for (let i = 1; i < voicings.length; i++) {
      const moved = voicings[i]!.reduce((acc, n, k) => acc + Math.abs(n - voicings[i - 1]![k]!), 0);
      expect(moved).toBeLessThanOrEqual(8);
    }
  });

  it('tilting the wrist borrows from the parallel mode, with hysteresis', () => {
    const { all } = play([
      frame([hand('primary', 'four', { roll: deg(5) })]),
      frame([hand('primary', 'four', { roll: deg(35) })]),
      frame([hand('primary', 'four', { roll: deg(22) })]), // inside hysteresis band: stays borrowed
      frame([hand('primary', 'four', { roll: deg(10) })]),
    ]);
    expect(all.map((e) => chordEvents(e)[0]?.chord?.roman ?? '-')).toEqual(['IV', 'iv', '-', 'IV']);
  });

  it('secondary hand chooses triad / 7th / 9th / sus4 and fist drops an octave', () => {
    const { all } = play([
      frame([hand('primary', 'open'), hand('secondary', 'one')]),
      frame([hand('primary', 'open'), hand('secondary', 'two')]),
      frame([hand('primary', 'open'), hand('secondary', 'three')]),
      frame([hand('primary', 'open'), hand('secondary', 'four')]),
      frame([hand('primary', 'open'), hand('secondary', 'fist')]),
    ]);
    const chords = all.map((e) => chordEvents(e)[0]);
    expect(chords.slice(0, 4).map((c) => c!.chord!.name)).toEqual(['G', 'G7', 'G9', 'Gsus4']);
    const before = chords[3]!.voicing.reduce((a, b) => a + b) / chords[3]!.voicing.length;
    const after = chords[4]!.voicing.reduce((a, b) => a + b) / chords[4]!.voicing.length;
    expect(before - after).toBeGreaterThan(6);
  });

  it('fist on the primary hand (or losing it) releases chord and bass', () => {
    const { all, st } = play([
      frame([hand('primary', 'one')]),
      frame([hand('primary', 'fist')]),
      frame([hand('primary', 'two')]),
      frame([], [{ type: 'handLost', hand: 1, role: 'primary', time: 0 }]),
    ]);
    expect(all[1]!.filter((e) => e.kind === 'chord').map((e) => (e as { chord: unknown }).chord)).toEqual([
      null,
      null,
    ]);
    expect(chordEvents(all[3]!)[0]!.chord).toBeNull();
    expect(st.chord).toBeNull();
  });

  it('plays the root in the bass', () => {
    const { all } = play([frame([hand('primary', 'indexPinky')])]);
    const bass = all[0]!.find((e) => e.kind === 'chord' && e.slot === 'bass') as Extract<
      MusicEvent,
      { kind: 'chord' }
    >;
    expect(bass.voicing).toEqual([45]); // A2 under Am
  });

  it('secondary height/tilt/depth drive volume, brightness and space, without flooding', () => {
    const { all } = play([
      frame([hand('secondary', 'open', { palmY: 0.88, roll: deg(50), depth: 0.25 })]),
      frame([hand('secondary', 'open', { palmY: 0.881, roll: deg(50), depth: 0.25 })]),
    ]);
    const params = Object.fromEntries(
      all[0]!
        .filter((e) => e.kind === 'param')
        .map((e) => [(e as { target: string }).target, (e as { value: number }).value]),
    );
    expect(params).toEqual({ 'master.volume': 1, 'macro.brightness': 1, 'macro.space': 0.1 });
    expect(all[1]!.filter((e) => e.kind === 'param')).toHaveLength(0);
  });

  it('events carry the camera capture time for latency measurement', () => {
    const { all } = play([frame([hand('primary', 'one')])]);
    expect(chordEvents(all[0]!)[0]!.cause).toEqual({ captureTime: 1000 });
  });

  it('works in any key and mode', () => {
    const { all } = play(
      ['one', 'four', 'indexPinky'].map((p) => frame([hand('primary', p as PoseId)])),
      {
        ...DEFAULT_CLASSIC,
        key: { tonic: 2, mode: 'dorian' },
      },
    );
    expect(all.map((e) => chordEvents(e)[0]!.chord!.name)).toEqual(['Dm', 'G', 'Bdim']);
  });
});
