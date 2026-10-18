// "Classic Two-Hand" (Phase 2, hard-wired; Phase 3 turns this into a declarative mapping preset).
//
//  Primary hand (left by default) picks the chord:
//    1 finger = I · 2 = ii · 3 = iii · 4 = IV · open hand = V · index+pinky = vi · thumb+index+pinky = vii°
//    fist = release · tilt the wrist past ~30° = borrow that chord from the parallel mode (IV → iv, VI → ♭VI…)
//  Secondary hand shapes and plays it:
//    1 finger = triad · 2 = 7th · 3 = 9th · 4 = sus4 · open = triad · fist = an octave lower
//    height = volume · wrist tilt = brightness (filter) · distance from camera = space (reverb)
//
// Pure: (state, gesture frame, audio time) → (state, events). Voice leading happens here, so every
// consumer of the event stream (synth, looper, MIDI) gets the same voicings.

import type { GestureFrame, HandGesture, PoseId } from '../gestures/types';
import type { EventCause, MusicEvent, ParamPath } from '../events/types';
import { diatonicChord, type Chord, type ChordQuality, type Degree, type Extension } from '../theory/chords';
import type { Key } from '../theory/modes';
import type { Midi } from '../theory/notes';
import { DEFAULT_VOICING, voiceLead, type VoicingOptions } from '../theory/voiceLeading';

export interface ClassicSettings {
  key: Key;
  voicing: VoicingOptions;
  bass: boolean;
  /** Wrist roll (degrees) that enters / leaves modal-interchange mode. */
  borrowEnterDeg: number;
  borrowExitDeg: number;
}

export const DEFAULT_CLASSIC: ClassicSettings = {
  key: { tonic: 0, mode: 'ionian' },
  voicing: DEFAULT_VOICING,
  bass: true,
  borrowEnterDeg: 30,
  borrowExitDeg: 18,
};

export interface ClassicState {
  degree: Degree | null;
  parallel: boolean;
  extension: Extension;
  quality: ChordQuality | 'diatonic';
  octave: -1 | 0;
  chord: Chord | null;
  voicing: Midi[];
  bassNote: Midi | null;
  /** Last value sent per continuous parameter (to avoid flooding the bus). */
  sent: Partial<Record<ParamPath, number>>;
}

export const initialClassicState = (): ClassicState => ({
  degree: null,
  parallel: false,
  extension: 'triad',
  quality: 'diatonic',
  octave: 0,
  chord: null,
  voicing: [],
  bassNote: null,
  sent: {},
});

const DEGREE_FOR_POSE: Partial<Record<PoseId, Degree | 'release'>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  open: 5,
  indexPinky: 6,
  thumbIndexPinky: 7,
  fist: 'release',
};

const SHAPE_FOR_POSE: Partial<Record<PoseId, { extension: Extension; quality: ChordQuality | 'diatonic' }>> =
  {
    one: { extension: 'triad', quality: 'diatonic' },
    two: { extension: 'seventh', quality: 'diatonic' },
    three: { extension: 'ninth', quality: 'diatonic' },
    four: { extension: 'triad', quality: 'sus4' },
    open: { extension: 'triad', quality: 'diatonic' },
  };

const lin = (x: number, a: number, b: number, lo: number, hi: number) =>
  lo + (hi - lo) * Math.max(0, Math.min(1, (x - a) / (b - a)));
const deg = (r: number) => (r * 180) / Math.PI;

export function classicStep(
  prev: ClassicState,
  frame: GestureFrame,
  time: number,
  settings: ClassicSettings = DEFAULT_CLASSIC,
): { state: ClassicState; events: MusicEvent[] } {
  const s: ClassicState = { ...prev, sent: { ...prev.sent } };
  const events: MusicEvent[] = [];
  const cause: EventCause = { captureTime: frame.timing.captureTime };
  const primary = frame.hands.find((h) => h.role === 'primary');
  const secondary = frame.hands.find((h) => h.role === 'secondary');
  let release = frame.events.some((e) => e.type === 'handLost' && e.role === 'primary');

  if (primary) {
    const target = DEGREE_FOR_POSE[primary.pose.pose];
    if (target === 'release') release = true;
    else if (target !== undefined) s.degree = target;
    const roll = Math.abs(deg(primary.features.roll));
    if (!s.parallel && roll > settings.borrowEnterDeg) s.parallel = true;
    else if (s.parallel && roll < settings.borrowExitDeg) s.parallel = false;
  }

  if (secondary) {
    const shape = SHAPE_FOR_POSE[secondary.pose.pose];
    if (shape) {
      s.extension = shape.extension;
      s.quality = shape.quality;
    }
    s.octave = secondary.pose.pose === 'fist' ? -1 : secondary.pose.pose === 'none' ? s.octave : 0;
    continuousParams(s, secondary, time, events);
  }

  if (release) {
    if (s.chord) {
      events.push({ kind: 'chord', slot: 'chords', chord: null, voicing: [], velocity: 0, time, cause });
      if (s.bassNote !== null)
        events.push({ kind: 'chord', slot: 'bass', chord: null, voicing: [], velocity: 0, time, cause });
    }
    s.degree = null;
    s.chord = null;
    s.voicing = [];
    s.bassNote = null;
    return { state: s, events };
  }

  if (s.degree === null) return { state: s, events };
  const wanted = diatonicChord(settings.key, {
    degree: s.degree,
    parallel: s.parallel,
    extension: s.extension,
    quality: s.quality,
  });
  const sameChord =
    s.chord && s.chord.root === wanted.root && s.chord.quality === wanted.quality && prev.octave === s.octave;
  if (sameChord) return { state: s, events };

  const shift = s.octave * 12;
  const register: [number, number] = [
    settings.voicing.register[0] + shift,
    settings.voicing.register[1] + shift,
  ];
  // On an octave change, lead from the previous voicing moved by that octave so the chord drops as a whole.
  const from = s.voicing.length ? s.voicing.map((n) => n + 12 * (s.octave - prev.octave)) : null;
  const voicing = voiceLead(from, wanted, { ...settings.voicing, register });
  const velocity = primary ? Math.min(1, 0.65 + primary.features.speed * 0.12) : 0.75;
  s.chord = wanted;
  s.voicing = voicing;
  events.push({ kind: 'chord', slot: 'chords', chord: wanted, voicing, velocity, time, cause });
  if (settings.bass) {
    const bassNote = 36 + wanted.root; // C2…B2
    if (bassNote !== s.bassNote) {
      s.bassNote = bassNote;
      events.push({ kind: 'chord', slot: 'bass', chord: wanted, voicing: [bassNote], velocity, time, cause });
    }
  }
  return { state: s, events };
}

function continuousParams(s: ClassicState, hand: HandGesture, time: number, events: MusicEvent[]) {
  if (hand.coasting) return;
  const f = hand.features;
  const targets: Array<[ParamPath, number]> = [
    ['master.volume', lin(f.palmY, 0.12, 0.88, 0, 1)],
    ['macro.brightness', lin(deg(f.roll), -50, 50, 0.05, 1)],
    ['macro.space', lin(f.depth, 0.25, 0.75, 0.1, 0.85)],
  ];
  for (const [target, value] of targets) {
    const last = s.sent[target];
    if (last !== undefined && Math.abs(last - value) < 0.004) continue;
    s.sent[target] = value;
    events.push({ kind: 'param', target, value, rampMs: 60, time });
  }
}
