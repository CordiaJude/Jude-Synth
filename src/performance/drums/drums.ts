// Drum machine: pure, window-based generator over the transport. Fills and drops are bar-addressed, so they
// land on the next bar line no matter when the gesture happened.

import { DRUM_VOICES, type DrumVoice, type MusicEvent } from '../../events/types';
import { hash01 } from '../arp';
import { beatAt, timeAtBeat, type Transport } from '../transport';
import { PATTERNS, STEP_VELOCITY, type Bar, type Genre } from './patterns';

export interface DrumSettings {
  enabled: boolean;
  genre: Genre;
  /** Override the genre's swing (null = use the pattern's). */
  swing: number | null;
  /** Bar index that plays the fill instead of the groove. */
  fillBar: number | null;
  /** Bar index that drops out (only a riser), followed by a crash on the next downbeat. */
  dropBar: number | null;
}

export const DEFAULT_DRUMS: DrumSettings = {
  enabled: false,
  genre: 'lofi',
  swing: null,
  fillBar: null,
  dropBar: null,
};

export const barAt = (t: Transport, time: number): number => Math.floor(beatAt(t, time) / 4 + 1e-9);

/** Schedule a fill (or drop) on the next bar line after `time`. */
export const nextBar = (t: Transport, time: number): number => barAt(t, time) + 1;

const DROP_BAR: Bar = { hat: '--------o-o-oooo', snare: '------------.-.x' };

function barFor(d: DrumSettings, bar: number): { bar: Bar; crash: boolean } {
  const p = PATTERNS[d.genre];
  if (d.dropBar === bar) return { bar: DROP_BAR, crash: false };
  if (d.fillBar === bar) return { bar: p.fill, crash: false };
  return {
    bar: p.bars[((bar % p.bars.length) + p.bars.length) % p.bars.length]!,
    crash: d.dropBar === bar - 1,
  };
}

export function drumEvents(d: DrumSettings, transport: Transport, from: number, to: number): MusicEvent[] {
  if (!d.enabled || to <= from) return [];
  const p = PATTERNS[d.genre];
  const swing = d.swing ?? p.swing;
  const sixteenth = 0.25; // beats
  const swingShift = (swing - 0.5) * 2 * sixteenth; // beats added to odd 16ths
  const events: MusicEvent[] = [];
  // Look a little before `from` so a swung step whose straight time is earlier isn't missed.
  const first = Math.floor((beatAt(transport, from) - swingShift) / sixteenth) - 1;
  const last = Math.ceil(beatAt(transport, to) / sixteenth);
  for (let s = first; s <= last; s++) {
    const beat = s * sixteenth + (s % 2 !== 0 ? swingShift : 0);
    const t = timeAtBeat(transport, beat);
    if (t < from || t >= to) continue;
    const bar = Math.floor(s / 16);
    const step = ((s % 16) + 16) % 16;
    const { bar: pattern, crash } = barFor(d, bar);
    if (crash && step === 0) events.push({ kind: 'drum', voice: 'crash', velocity: 0.9, time: t });
    for (const voice of DRUM_VOICES) {
      const ch = pattern[voice]?.[step];
      const v = ch ? STEP_VELOCITY[ch] : undefined;
      if (!v) continue;
      // Tiny deterministic velocity variation keeps loops from sounding machine-gunned.
      const human = 0.92 + 0.08 * hash01(s * 31 + DRUM_VOICES.indexOf(voice));
      events.push({ kind: 'drum', voice: voice as DrumVoice, velocity: Math.min(1, v * human), time: t });
    }
  }
  return events;
}
