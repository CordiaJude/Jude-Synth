// Strum: the free hand sweeping sideways crosses virtual strings; each crossing plucks that string's note.
// Crossings found between two camera frames are spread over the frame interval in the order they happened,
// so a strum sounds like a strum (not a block chord) even at 30 fps.

import type { MusicEvent } from '../events/types';
import type { Chord } from '../theory/chords';
import { pc, type Midi } from '../theory/notes';

export interface StrumSettings {
  enabled: boolean;
  strings: number;
  /** Horizontal span of the strings in the frame (0..1, mirrored view). */
  span: [number, number];
}

export const DEFAULT_STRUM: StrumSettings = { enabled: false, strings: 6, span: [0.35, 0.85] };

export interface StrumState {
  lastX: number | null;
  lastTime: number | null;
  /** Note id currently ringing per string. */
  ringing: Array<string | null>;
  counter: number;
}

export const initialStrumState = (strings = 6): StrumState => ({
  lastX: null,
  lastTime: null,
  ringing: new Array<string | null>(strings).fill(null),
  counter: 0,
});

/** Guitar-like spread voicing: chord tones climbing from ~E2, at least a minor third apart. */
export function strumVoicing(chord: Chord, strings: number, low: Midi = 40): Midi[] {
  const pcs = new Set<number>(chord.pitchClasses);
  // Lowest string: the root if it's within a fourth of `low`, else the nearest chord tone above `low`.
  let m = low;
  while (pc(m) !== chord.root) m++;
  if (m - low > 5) {
    m = low;
    while (!pcs.has(pc(m))) m++;
  }
  const out: Midi[] = [m];
  while (out.length < strings) {
    m = out[out.length - 1]! + 3;
    while (!pcs.has(pc(m))) m++;
    out.push(m);
  }
  return out;
}

/** Strings crossed moving from x0 to x1, in crossing order, with the fraction of the move where each was hit. */
export function strumCrossings(
  x0: number,
  x1: number,
  settings: StrumSettings,
): Array<{ string: number; frac: number }> {
  const [lo, hi] = settings.span;
  const n = settings.strings;
  const out: Array<{ string: number; frac: number }> = [];
  if (x0 === x1) return out;
  for (let i = 0; i < n; i++) {
    const p = lo + ((i + 0.5) / n) * (hi - lo);
    if ((x0 < p && x1 >= p) || (x0 > p && x1 <= p)) out.push({ string: i, frac: (p - x0) / (x1 - x0) });
  }
  return out.sort((a, b) => a.frac - b.frac);
}

/**
 * Advance the strum with a new hand position. `time` is the audio time to start sounding this frame's
 * crossings; they are spread over `frameSeconds`. Velocity follows hand speed.
 */
export function strumStep(
  st: StrumState,
  x: number,
  wallMs: number,
  time: number,
  chord: Chord | null,
  settings: StrumSettings,
): { state: StrumState; events: MusicEvent[] } {
  const s: StrumState = { ...st, ringing: [...st.ringing] };
  const events: MusicEvent[] = [];
  const x0 = s.lastX;
  const t0 = s.lastTime;
  s.lastX = x;
  s.lastTime = wallMs;
  if (!settings.enabled || !chord || x0 === null || t0 === null) return { state: s, events };
  const dt = Math.min(0.06, Math.max(0.005, (wallMs - t0) / 1000));
  const crossings = strumCrossings(x0, x, settings);
  if (!crossings.length) return { state: s, events };
  const notes = strumVoicing(chord, settings.strings);
  const speed = Math.abs(x - x0) / dt; // frame-widths per second
  const velocity = Math.max(0.35, Math.min(1, 0.25 + speed * 0.055));
  for (const c of crossings) {
    const at = time + c.frac * dt;
    const prev = s.ringing[c.string];
    if (prev) events.push({ kind: 'noteOff', id: prev, slot: 'chords', time: at });
    s.counter++;
    const id = `strum${s.counter}`;
    s.ringing[c.string] = id;
    events.push({ kind: 'noteOn', id, slot: 'chords', note: notes[c.string]!, velocity, time: at });
  }
  return { state: s, events };
}

/** A keyboard/touch strum: all strings in order over `durationMs` (down = low → high). */
export function strumAll(
  st: StrumState,
  time: number,
  chord: Chord | null,
  settings: StrumSettings,
  direction: 'down' | 'up',
  durationMs = 60,
): { state: StrumState; events: MusicEvent[] } {
  const [lo, hi] = settings.span;
  const a = direction === 'down' ? lo - 0.01 : hi + 0.01;
  const b = direction === 'down' ? hi + 0.01 : lo - 0.01;
  const start: StrumState = { ...st, lastX: a, lastTime: 0 };
  return strumStep(start, b, durationMs, time, chord, { ...settings, enabled: true });
}
