// Groove: transport, arpeggiator, strum, drums, auto-bass and quantize settings, and how they react to
// actions. Pure — the scheduler calls grooveWindow() for time-based events.

import type { MusicEvent } from '../events/types';
import type { Chord } from '../theory/chords';
import type { Midi } from '../theory/notes';
import { arpEvents, ARP_RATES, DEFAULT_ARP, type ArpSettings } from './arp';
import { bassEvents, BASS_PATTERNS, type BassPattern } from './bass';
import { DEFAULT_DRUMS, drumEvents, nextBar, type DrumSettings } from './drums/drums';
import { GENRES, PATTERNS, type Genre } from './drums/patterns';
import {
  DEFAULT_STRUM,
  initialStrumState,
  strumAll,
  strumStep,
  type StrumSettings,
  type StrumState,
} from './strum';
import { DEFAULT_QUANTIZE, setTempo, type QuantizeSettings, type Transport } from './transport';

export type GrooveAction =
  | { type: 'arp.toggle' }
  | { type: 'strum.toggle' }
  | { type: 'strum.strum'; direction: 'down' | 'up' }
  | { type: 'drums.toggle' }
  | { type: 'drums.fill' }
  | { type: 'drums.drop' }
  | { type: 'drums.nextGenre' }
  | { type: 'bass.nextPattern' }
  | { type: 'tempo.tap' }
  | { type: 'tempo.nudge'; delta: number };

export const GROOVE_ACTION_TYPES: ReadonlySet<string> = new Set([
  'arp.toggle',
  'strum.toggle',
  'strum.strum',
  'drums.toggle',
  'drums.fill',
  'drums.drop',
  'drums.nextGenre',
  'bass.nextPattern',
  'tempo.tap',
  'tempo.nudge',
]);

export type GrooveTarget = 'arp.rate' | 'arp.gate' | 'strum.position';
export const GROOVE_TARGETS: ReadonlySet<string> = new Set(['arp.rate', 'arp.gate', 'strum.position']);

export interface GrooveState {
  transport: Transport;
  quantize: QuantizeSettings;
  arp: ArpSettings;
  strum: StrumSettings;
  strumState: StrumState;
  drums: DrumSettings;
  bassPattern: BassPattern;
  harmony: { chord: Chord | null; voicing: Midi[]; bassNote: Midi | null };
  taps: number[];
}

export const initialGroove = (origin = 0): GrooveState => ({
  transport: { bpm: 96, origin },
  quantize: DEFAULT_QUANTIZE,
  arp: DEFAULT_ARP,
  strum: DEFAULT_STRUM,
  strumState: initialStrumState(),
  drums: DEFAULT_DRUMS,
  bassPattern: 'sustain',
  harmony: { chord: null, voicing: [], bassNote: null },
  taps: [],
});

/** Does the pad sound the chord itself, or is something else (arp, strum) playing it? */
export const padPlays = (g: GrooveState): boolean => !g.arp.enabled && !g.strum.enabled;

/** Re-sound the held chord on the pad (after arp/strum hand it back). */
function padChord(g: GrooveState, time: number): MusicEvent[] {
  const { chord, voicing } = g.harmony;
  return chord ? [{ kind: 'chord', slot: 'chords', chord, voicing, velocity: 0.75, time, play: true }] : [];
}

function bassChord(g: GrooveState, time: number): MusicEvent[] {
  const { chord, bassNote } = g.harmony;
  return chord && bassNote !== null
    ? [{ kind: 'chord', slot: 'bass', chord, voicing: [bassNote], velocity: 0.8, time, play: true }]
    : [];
}

export function grooveAction(
  prev: GrooveState,
  a: GrooveAction,
  time: number,
): { state: GrooveState; events: MusicEvent[] } {
  const g: GrooveState = { ...prev };
  const events: MusicEvent[] = [];
  switch (a.type) {
    case 'arp.toggle': {
      const wasPad = padPlays(g);
      g.arp = { ...g.arp, enabled: !g.arp.enabled };
      if (wasPad && !padPlays(g)) events.push({ kind: 'slotRelease', slot: 'chords', time });
      if (!wasPad && padPlays(g)) events.push(...padChord(g, time));
      break;
    }
    case 'strum.toggle': {
      const wasPad = padPlays(g);
      g.strum = { ...g.strum, enabled: !g.strum.enabled };
      g.strumState = initialStrumState(g.strum.strings);
      if (wasPad && !padPlays(g)) events.push({ kind: 'slotRelease', slot: 'chords', time });
      if (!wasPad && padPlays(g)) events.push(...padChord(g, time));
      break;
    }
    case 'strum.strum': {
      if (padPlays(g)) events.push({ kind: 'slotRelease', slot: 'chords', time });
      const r = strumAll(g.strumState, time, g.harmony.chord, g.strum, a.direction);
      g.strumState = r.state;
      events.push(...r.events);
      break;
    }
    case 'drums.toggle':
      g.drums = { ...g.drums, enabled: !g.drums.enabled, fillBar: null, dropBar: null };
      break;
    case 'drums.fill':
      g.drums = { ...g.drums, fillBar: nextBar(g.transport, time) };
      break;
    case 'drums.drop':
      g.drums = { ...g.drums, dropBar: nextBar(g.transport, time) };
      break;
    case 'drums.nextGenre':
      return setGenre(g, GENRES[(GENRES.indexOf(g.drums.genre) + 1) % GENRES.length]!, time);
    case 'bass.nextPattern':
      return setBassPattern(
        g,
        BASS_PATTERNS[(BASS_PATTERNS.indexOf(g.bassPattern) + 1) % BASS_PATTERNS.length]!,
        time,
      );
    case 'tempo.tap': {
      const taps = [...g.taps.filter((t) => time - t < 2.5), time].slice(-5);
      g.taps = taps;
      if (taps.length >= 3) {
        const intervals = taps.slice(1).map((t, i) => t - taps[i]!);
        const avg = intervals.reduce((x, y) => x + y, 0) / intervals.length;
        g.transport = setTempo(g.transport, Math.round(60 / avg), time);
      }
      break;
    }
    case 'tempo.nudge':
      g.transport = setTempo(g.transport, g.transport.bpm + a.delta, time);
      break;
  }
  return { state: g, events };
}

/** Switch drum style; the tempo moves to the style's own (without jumping the beat). */
export function setGenre(
  prev: GrooveState,
  genre: Genre,
  time: number,
): { state: GrooveState; events: MusicEvent[] } {
  return {
    state: {
      ...prev,
      drums: { ...prev.drums, genre },
      transport: setTempo(prev.transport, PATTERNS[genre].bpm, time),
    },
    events: [],
  };
}

/** Switch bass pattern: hand the bass between the sustained root and the pattern generator. */
export function setBassPattern(
  prev: GrooveState,
  pattern: BassPattern,
  time: number,
): { state: GrooveState; events: MusicEvent[] } {
  const g: GrooveState = { ...prev, bassPattern: pattern };
  const events: MusicEvent[] = [];
  if (prev.bassPattern === 'sustain' && pattern !== 'sustain')
    events.push({ kind: 'slotRelease', slot: 'bass', time });
  if (prev.bassPattern !== 'sustain' && pattern === 'sustain') events.push(...bassChord(g, time));
  return { state: g, events };
}

/** Continuous groove controls. `wallMs` is the camera frame time (strum needs real motion timing). */
export function grooveParam(
  prev: GrooveState,
  target: GrooveTarget,
  value: number,
  time: number,
  wallMs: number,
): { state: GrooveState; events: MusicEvent[] } {
  const g: GrooveState = { ...prev };
  switch (target) {
    case 'arp.rate': {
      const i = Math.min(ARP_RATES.length - 1, Math.max(0, Math.floor(value * ARP_RATES.length)));
      g.arp = { ...g.arp, rate: ARP_RATES[i]! };
      return { state: g, events: [] };
    }
    case 'arp.gate':
      g.arp = { ...g.arp, gate: 0.08 + 0.92 * Math.max(0, Math.min(1, value)) };
      return { state: g, events: [] };
    case 'strum.position': {
      const r = strumStep(g.strumState, value, wallMs, time, g.harmony.chord, g.strum);
      g.strumState = r.state;
      return { state: g, events: r.events };
    }
  }
}

/**
 * Track the harmony from the conductor's chord events and decide who sounds it: the pad (unless the arp or
 * strum has it) and the sustained bass (unless a bass pattern plays instead).
 */
export function grooveHarmony(prev: GrooveState, e: MusicEvent): { state: GrooveState; event: MusicEvent } {
  if (e.kind !== 'chord') return { state: prev, event: e };
  const g: GrooveState = { ...prev, harmony: { ...prev.harmony } };
  if (e.slot === 'chords') {
    g.harmony.chord = e.chord;
    g.harmony.voicing = e.voicing;
    if (!e.chord) g.harmony.bassNote = null;
    return { state: g, event: { ...e, play: padPlays(g) } };
  }
  if (e.slot === 'bass') {
    g.harmony.bassNote = e.chord ? (e.voicing[0] ?? null) : null;
    return { state: g, event: { ...e, play: g.bassPattern === 'sustain' } };
  }
  return { state: g, event: e };
}

/** Time-based events in [from, to): arpeggio, drums, patterned bass. */
export function grooveWindow(g: GrooveState, from: number, to: number): MusicEvent[] {
  const dropped = (bar: number) => g.drums.enabled && g.drums.dropBar === bar;
  return [
    ...drumEvents(g.drums, g.transport, from, to),
    ...arpEvents(g.arp, g.harmony.voicing, g.transport, from, to),
    ...bassEvents(g.bassPattern, g.harmony.chord, g.harmony.bassNote, g.transport, from, to, dropped),
  ].sort((a, b) => a.time - b.time);
}
