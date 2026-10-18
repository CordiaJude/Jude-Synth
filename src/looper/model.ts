// The looper's data model: a loop is plain data (notes in ticks), so it can be edited in the piano roll,
// undone, saved, exported as MIDI and re-rendered offline exactly. Pure — no audio, no timers.

import type { InstrumentId } from '../audio/instruments/types';
import type { ChordTransition, DrumVoice } from '../events/types';
import type { Key } from '../theory/modes';
import type { Midi } from '../theory/notes';

/** Ticks per quarter note (MIDI resolution). */
export const PPQ = 480;
export const BEATS_PER_BAR = 4;
export const TICKS_PER_BAR = PPQ * BEATS_PER_BAR;
export const MAX_TRACKS = 8;

/** The live part a track was recorded from. */
export const PARTS = ['chords', 'melody', 'bass', 'drums'] as const;
export type Part = (typeof PARTS)[number];

/** A pitch move inside a sounding note (theremin / melody glide). `tick` is relative to the note start. */
export interface PitchPoint {
  tick: number;
  note: Midi;
  /** Glide time (s) the live performance used for this move. */
  glide: number;
}

export interface NoteEvent {
  /** Start, in ticks from the loop start (0 ≤ tick < loop length). */
  tick: number;
  /** Length in ticks (≥ 1, ≤ loop length; may run past the loop end and wrap around). */
  duration: number;
  /** MIDI note; may be fractional for free pitch. Drum tracks use General MIDI drum numbers. */
  note: Midi;
  /** 0..1 */
  velocity: number;
  /** Part of a held chord (played back as a voice-led chord, like the pad). */
  chord?: boolean;
  /** The chord transition it was played with (chord notes only; undefined = the patch default). */
  transition?: ChordTransition;
  pitch?: PitchPoint[];
}

export const AUTOMATION_TARGETS = ['macro.brightness', 'melody.vibrato'] as const;
export type AutomationTarget = (typeof AUTOMATION_TARGETS)[number];

export interface AutomationLane {
  target: AutomationTarget;
  points: Array<{ tick: number; value: number }>;
}

export type TrackInstrument = InstrumentId | 'drums';

export interface LoopTrack {
  id: string;
  name: string;
  part: Part;
  instrument: TrackInstrument;
  notes: NoteEvent[];
  automation: AutomationLane[];
  /** Brightness the part had when it was recorded (0..1). */
  brightness: number;
  mute: boolean;
  solo: boolean;
  gainDb: number;
}

export interface LoopProject {
  version: 1;
  ppq: typeof PPQ;
  bpm: number;
  timeSig: [4, 4];
  /** Loop length; 0 = nothing recorded yet. */
  bars: number;
  key: Key;
  tracks: LoopTrack[];
  /** Counter for track ids (never reused, so undo/redo can't confuse two tracks). */
  nextTrackId: number;
}

export const emptyProject = (bpm = 96, key: Key = { tonic: 0, mode: 'ionian' }): LoopProject => ({
  version: 1,
  ppq: PPQ,
  bpm,
  timeSig: [4, 4],
  bars: 0,
  key,
  tracks: [],
  nextTrackId: 1,
});

export const loopTicks = (p: Pick<LoopProject, 'bars'>): number => p.bars * TICKS_PER_BAR;

/** Wrap a tick into [0, length). */
export const wrapTick = (tick: number, length: number): number => ((tick % length) + length) % length;

/** General MIDI percussion numbers for the kit's voices. */
export const DRUM_NOTE: Record<DrumVoice, number> = {
  kick: 36,
  rim: 37,
  snare: 38,
  clap: 39,
  hat: 42,
  tom: 45,
  openHat: 46,
  crash: 49,
};
const NOTE_TO_DRUM = new Map(Object.entries(DRUM_NOTE).map(([v, n]) => [n, v as DrumVoice]));
export const drumVoiceOf = (note: number): DrumVoice | null => NOTE_TO_DRUM.get(Math.round(note)) ?? null;

export const PART_LABEL: Record<Part, string> = {
  chords: 'Chords',
  melody: 'Melody',
  bass: 'Bass',
  drums: 'Drums',
};

/** Tracks that sound: the soloed ones if any track is soloed, otherwise every unmuted one. */
export function audibleTracks(p: LoopProject): Set<string> {
  const solo = p.tracks.some((t) => t.solo);
  return new Set(p.tracks.filter((t) => (solo ? t.solo : !t.mute)).map((t) => t.id));
}

/** Notes sorted by start, then pitch: the canonical order (stable ids, deterministic export). */
export const sortNotes = (notes: NoteEvent[]): NoteEvent[] =>
  [...notes].sort((a, b) => a.tick - b.tick || a.note - b.note);

/**
 * Ramer–Douglas–Peucker: drop points that lie within `epsilon` of the line through their neighbours.
 * Keeps the first and last point; used to keep automation and pitch curves small.
 */
export function thin<T extends { tick: number }>(points: T[], value: (p: T) => number, epsilon: number): T[] {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const pa = points[a]!;
    const pb = points[b]!;
    const span = pb.tick - pa.tick;
    let worst = -1;
    let worstAt = -1;
    for (let i = a + 1; i < b; i++) {
      const p = points[i]!;
      const f = span > 0 ? (p.tick - pa.tick) / span : 0;
      const d = Math.abs(value(p) - (value(pa) + (value(pb) - value(pa)) * f));
      if (d > worst) {
        worst = d;
        worstAt = i;
      }
    }
    if (worst > epsilon) {
      keep[worstAt] = 1;
      stack.push([a, worstAt], [worstAt, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}
