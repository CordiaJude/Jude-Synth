// The conductor: musical state + actions/params → MusicEvents. Pure. Gestures (through a mapping preset),
// the keyboard and the touch pad all speak the same Action language, so they behave identically.

import type { EventCause, MusicEvent } from '../events/types';
import type { Action, MappingPreset, ParamUpdate, PerformanceMode } from '../mapping/types';
import {
  diatonicChord,
  type BorrowedChord,
  type Chord,
  type ChordQuality,
  type Degree,
  type Extension,
} from '../theory/chords';
import type { Key } from '../theory/modes';
import type { Midi } from '../theory/notes';
import { quantizePitch } from '../theory/quantizer';
import { DEFAULT_VOICING, voiceLead, type VoicingOptions } from '../theory/voiceLeading';

export interface ConductorSettings {
  key: Key;
  voicing: VoicingOptions;
  bass: boolean;
  melody: MappingPreset['melody'];
}

export const DEFAULT_CONDUCTOR: ConductorSettings = {
  key: { tonic: 0, mode: 'ionian' },
  voicing: DEFAULT_VOICING,
  bass: true,
  melody: { low: 60, high: 84, snap: 1 },
};

export interface MelodyState {
  gate: boolean;
  /** Last pitch control value, 0..1 (null until the pitch hand has been seen). */
  pitch01: number | null;
  /** Sounding note id and pitch. */
  id: string | null;
  note: Midi | null;
  octave: number;
  counter: number;
}

export interface ConductorState {
  mode: PerformanceMode;
  latched: boolean;
  degree: Degree | null;
  borrowed: BorrowedChord | null;
  parallel: boolean;
  extension: Extension;
  quality: ChordQuality | 'diatonic';
  octave: -1 | 0 | 1;
  inversionBias: -1 | 0 | 1;
  chord: Chord | null;
  voicing: Midi[];
  /** Octave the current voicing was built in (to lead from it when the octave changes). */
  voicedOctave: number;
  voicedBias: number;
  bassNote: Midi | null;
  melody: MelodyState;
}

export const initialConductorState = (mode: PerformanceMode = 'chords'): ConductorState => ({
  mode,
  latched: false,
  degree: null,
  borrowed: null,
  parallel: false,
  extension: 'triad',
  quality: 'diatonic',
  octave: 0,
  inversionBias: 0,
  chord: null,
  voicing: [],
  voicedOctave: 0,
  voicedBias: 0,
  bassNote: null,
  melody: { gate: false, pitch01: null, id: null, note: null, octave: 0, counter: 0 },
});

export interface ConductorInput {
  actions: readonly Action[];
  params: readonly ParamUpdate[];
  /** Velocity for notes and chords triggered by this input, 0..1. */
  velocity?: number;
  cause?: EventCause;
}

function melodyNote(m: MelodyState, s: ConductorSettings): Midi | null {
  if (m.pitch01 === null) return null;
  const raw = s.melody.low + m.pitch01 * (s.melody.high - s.melody.low) + 12 * m.octave;
  return quantizePitch(raw, s.key, s.melody.snap);
}

export function conduct(
  prev: ConductorState,
  input: ConductorInput,
  time: number,
  settings: ConductorSettings = DEFAULT_CONDUCTOR,
): { state: ConductorState; events: MusicEvent[] } {
  const s: ConductorState = { ...prev, melody: { ...prev.melody } };
  const events: MusicEvent[] = [];
  const cause = input.cause;
  const velocity = input.velocity ?? 0.8;
  let dirty = false;
  let release = false;

  const melodyOn = () => {
    const note = melodyNote(s.melody, settings);
    if (note === null || s.melody.id) return;
    s.melody.counter++;
    s.melody.id = `m${s.melody.counter}`;
    s.melody.note = note;
    events.push({ kind: 'noteOn', id: s.melody.id, slot: 'melody', note, velocity, time, cause });
  };
  const melodyOff = () => {
    if (!s.melody.id) return;
    events.push({ kind: 'noteOff', id: s.melody.id, slot: 'melody', time });
    s.melody.id = null;
    s.melody.note = null;
  };
  const melodyRetune = () => {
    if (!s.melody.id) return;
    const note = melodyNote(s.melody, settings);
    if (note === null || s.melody.note === null || Math.abs(note - s.melody.note) < 0.01) return;
    s.melody.note = note;
    const glide = settings.melody.snap >= 1 ? 0.03 : 0.06;
    events.push({ kind: 'pitch', id: s.melody.id, slot: 'melody', note, glide, time });
  };

  for (const p of input.params) {
    if (p.target === 'melody.pitch') {
      s.melody.pitch01 = p.value;
      if (s.melody.gate) {
        if (s.melody.id) melodyRetune();
        else melodyOn();
      }
    } else {
      events.push({ kind: 'param', target: p.target, value: p.value, rampMs: p.rampMs, time });
    }
  }

  for (const a of input.actions) {
    switch (a.type) {
      case 'chord.degree':
        s.degree = a.degree;
        s.borrowed = null;
        dirty = true;
        release = false;
        break;
      case 'chord.borrowed':
        s.borrowed = a.chord;
        s.degree ??= 1;
        dirty = true;
        release = false;
        break;
      case 'chord.parallel':
        s.parallel = a.value;
        dirty = true;
        break;
      case 'chord.quality':
        s.quality = a.quality;
        dirty = true;
        break;
      case 'chord.extension':
        s.extension = a.extension;
        dirty = true;
        break;
      case 'chord.shape':
        s.extension = a.extension;
        s.quality = a.quality;
        dirty = true;
        break;
      case 'chord.octave':
        s.octave = a.value;
        dirty = true;
        break;
      case 'chord.inversionBias':
        s.inversionBias = a.value;
        dirty = true;
        break;
      case 'chord.release':
        if (!s.latched) release = true;
        break;
      case 'latch.toggle':
        s.latched = !s.latched;
        break;
      case 'mode.set':
        s.mode = a.mode;
        break;
      case 'melody.gate':
        s.melody.gate = a.on;
        if (a.on) melodyOn();
        else melodyOff();
        break;
      case 'melody.octave':
        s.melody.octave = Math.max(-2, Math.min(2, s.melody.octave + a.delta));
        melodyRetune();
        break;
    }
  }

  if (release) {
    if (s.chord) {
      events.push({ kind: 'chord', slot: 'chords', chord: null, voicing: [], velocity: 0, time, cause });
      if (s.bassNote !== null) {
        events.push({ kind: 'chord', slot: 'bass', chord: null, voicing: [], velocity: 0, time, cause });
      }
    }
    s.degree = null;
    s.borrowed = null;
    s.chord = null;
    s.voicing = [];
    s.bassNote = null;
    return { state: s, events };
  }

  if (!dirty || s.degree === null) return { state: s, events };
  const wanted = diatonicChord(settings.key, {
    degree: s.degree,
    borrowed: s.borrowed ?? undefined,
    parallel: s.parallel,
    extension: s.extension,
    quality: s.quality,
  });
  const same =
    s.chord &&
    s.chord.root === wanted.root &&
    s.chord.quality === wanted.quality &&
    s.voicedOctave === s.octave &&
    s.voicedBias === s.inversionBias;
  if (same) return { state: s, events };

  // Same chord, new inversion bias: rotate to the next inversion (lowest note up / highest note down).
  const sameChordOnly =
    s.chord &&
    s.chord.root === wanted.root &&
    s.chord.quality === wanted.quality &&
    s.voicedOctave === s.octave;
  if (sameChordOnly && s.voicing.length) {
    const v = [...s.voicing].sort((a, b) => a - b);
    const steps = s.inversionBias - s.voicedBias;
    for (let k = 0; k < Math.abs(steps); k++) {
      if (steps > 0) v.push(v.shift()! + 12);
      else v.unshift(v.pop()! - 12);
    }
    s.voicing = v;
    s.voicedBias = s.inversionBias;
    events.push({ kind: 'chord', slot: 'chords', chord: wanted, voicing: v, velocity, time, cause });
    return { state: s, events };
  }

  const shift = s.octave * 12;
  const register: [number, number] = [
    settings.voicing.register[0] + shift,
    settings.voicing.register[1] + shift,
  ];
  // On an octave change, lead from the previous voicing moved by that octave so the chord moves as a whole.
  const from = s.voicing.length ? s.voicing.map((n) => n + 12 * (s.octave - s.voicedOctave)) : null;
  const voicing = voiceLead(from, wanted, { ...settings.voicing, register, inversionBias: s.inversionBias });
  s.chord = wanted;
  s.voicing = voicing;
  s.voicedOctave = s.octave;
  s.voicedBias = s.inversionBias;
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
