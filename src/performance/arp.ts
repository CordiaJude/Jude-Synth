// Arpeggiator: a pure, window-based generator. Step k always falls at the same beat and plays the same note,
// so rendering [a, b) then [b, c) is identical to rendering [a, c) — no gaps or doubles across windows.

import type { MusicEvent } from '../events/types';
import type { Midi } from '../theory/notes';
import { beatAt, GRID_BEATS, timeAtBeat, type Grid, type Transport } from './transport';

export const ARP_MODES = ['up', 'down', 'upDown', 'random', 'played'] as const;
export type ArpMode = (typeof ARP_MODES)[number];
export const ARP_RATES = ['1/4', '1/8', '1/16', '1/16T', '1/32'] as const satisfies readonly Exclude<
  Grid,
  'off'
>[];
export type ArpRate = (typeof ARP_RATES)[number];

export interface ArpSettings {
  enabled: boolean;
  mode: ArpMode;
  rate: ArpRate;
  octaves: 1 | 2 | 3;
  /** Note length as a fraction of the step, 0.05..1. */
  gate: number;
}

export const DEFAULT_ARP: ArpSettings = { enabled: false, mode: 'up', rate: '1/16', octaves: 2, gate: 0.6 };

/** The repeating note sequence for a set of chord notes. */
export function arpSequence(notes: readonly Midi[], mode: ArpMode, octaves: number): Midi[] {
  if (!notes.length) return [];
  const base = mode === 'played' ? [...notes] : [...notes].sort((a, b) => a - b);
  const span: Midi[] = [];
  for (let o = 0; o < octaves; o++) for (const n of base) span.push(n + 12 * o);
  switch (mode) {
    case 'up':
    case 'played':
    case 'random':
      return span;
    case 'down':
      return [...span].reverse();
    case 'upDown':
      return span.length <= 2 ? span : [...span, ...span.slice(1, -1).reverse()];
  }
}

/** Deterministic hash → [0, 1) so "random" is repeatable per step (window-independent). */
export function hash01(k: number): number {
  let x = (k | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

export function arpEvents(
  arp: ArpSettings,
  notes: readonly Midi[],
  transport: Transport,
  from: number,
  to: number,
): MusicEvent[] {
  if (!arp.enabled || !notes.length || to <= from) return [];
  const seq = arpSequence(notes, arp.mode, arp.octaves);
  const step = GRID_BEATS[arp.rate];
  const stepSeconds = (60 / transport.bpm) * step;
  const first = Math.ceil(beatAt(transport, from) / step - 1e-9);
  const events: MusicEvent[] = [];
  for (let k = first; ; k++) {
    const t = timeAtBeat(transport, k * step);
    if (t >= to) break;
    if (t < from) continue;
    const idx =
      arp.mode === 'random'
        ? Math.floor(hash01(k) * seq.length)
        : ((k % seq.length) + seq.length) % seq.length;
    const note = seq[idx]!;
    const onBeat = Math.abs(k * step - Math.round(k * step)) < 1e-6;
    const id = `arp${k}`;
    events.push({ kind: 'noteOn', id, slot: 'chords', note, velocity: onBeat ? 0.9 : 0.7, time: t });
    events.push({
      kind: 'noteOff',
      id,
      slot: 'chords',
      time: t + stepSeconds * Math.max(0.05, Math.min(1, arp.gate)),
    });
  }
  return events;
}
