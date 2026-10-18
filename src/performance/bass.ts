// Auto-bass: follows the current chord root with a selectable rhythmic pattern. Pure, window-based.

import type { MusicEvent } from '../events/types';
import type { Chord } from '../theory/chords';
import type { Midi } from '../theory/notes';
import { beatAt, timeAtBeat, type Transport } from './transport';

export const BASS_PATTERNS = ['sustain', 'pulse', 'rootFifth', 'octaves', 'offbeat', 'walk'] as const;
export type BassPattern = (typeof BASS_PATTERNS)[number];

export const BASS_PATTERN_LABEL: Record<BassPattern, string> = {
  sustain: 'Sustained root',
  pulse: 'Root 8ths',
  rootFifth: 'Root–fifth',
  octaves: 'Octaves',
  offbeat: 'Offbeat (house)',
  walk: 'Walking',
};

interface Step {
  /** Beat offset within the bar (4/4). */
  beat: number;
  /** Semitones above the bass root, or 'third' / 'fifth' / 'sixth' resolved from the chord. */
  pitch: number | 'third' | 'fifth' | 'sixth';
  /** Length in beats. */
  length: number;
  velocity: number;
}

const PATTERNS: Record<Exclude<BassPattern, 'sustain'>, Step[]> = {
  pulse: Array.from({ length: 8 }, (_, i) => ({
    beat: i / 2,
    pitch: 0,
    length: 0.4,
    velocity: i % 2 ? 0.7 : 0.9,
  })),
  rootFifth: [0, 1, 2, 3].map((b) => ({
    beat: b,
    pitch: b % 2 ? ('fifth' as const) : 0,
    length: 0.85,
    velocity: 0.85,
  })),
  octaves: Array.from({ length: 8 }, (_, i) => ({
    beat: i / 2,
    pitch: i % 2 ? 12 : 0,
    length: 0.35,
    velocity: i % 2 ? 0.75 : 0.9,
  })),
  offbeat: [0.5, 1.5, 2.5, 3.5].map((b) => ({ beat: b, pitch: 0, length: 0.35, velocity: 0.9 })),
  walk: [
    { beat: 0, pitch: 0, length: 0.9, velocity: 0.9 },
    { beat: 1, pitch: 'third', length: 0.9, velocity: 0.75 },
    { beat: 2, pitch: 'fifth', length: 0.9, velocity: 0.8 },
    { beat: 3, pitch: 'sixth', length: 0.9, velocity: 0.75 },
  ],
};

function resolve(p: Step['pitch'], root: Midi, chord: Chord): Midi {
  if (typeof p === 'number') return root + p;
  const find = (cands: number[]) => cands.find((i) => chord.intervals.includes(i)) ?? cands[0]!;
  if (p === 'third') return root + find([4, 3, 5, 2]);
  if (p === 'fifth') return root + find([7, 6, 8]);
  return root + find([9, 10, 8]);
}

/**
 * Bass notes for [from, to). `mutedBar(bar)` silences whole bars (drum drops). Step ids are derived from
 * bar + index so windows never double-trigger.
 */
export function bassEvents(
  pattern: BassPattern,
  chord: Chord | null,
  root: Midi | null,
  transport: Transport,
  from: number,
  to: number,
  mutedBar: (bar: number) => boolean = () => false,
): MusicEvent[] {
  if (pattern === 'sustain' || !chord || root === null || to <= from) return [];
  const steps = PATTERNS[pattern];
  const spb = 60 / transport.bpm;
  const events: MusicEvent[] = [];
  const firstBar = Math.floor(beatAt(transport, from) / 4);
  const lastBar = Math.floor(beatAt(transport, to) / 4);
  for (let bar = firstBar; bar <= lastBar; bar++) {
    if (mutedBar(bar)) continue;
    steps.forEach((st, i) => {
      const t = timeAtBeat(transport, bar * 4 + st.beat);
      if (t < from || t >= to) return;
      const id = `bass${bar}.${i}`;
      events.push({
        kind: 'noteOn',
        id,
        slot: 'bass',
        note: resolve(st.pitch, root, chord),
        velocity: st.velocity,
        time: t,
      });
      events.push({ kind: 'noteOff', id, slot: 'bass', time: t + st.length * spb });
    });
  }
  return events;
}
