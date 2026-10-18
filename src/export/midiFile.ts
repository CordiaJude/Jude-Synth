// Standard MIDI File (type 1) writer for loop projects: a tempo track plus one track per loop track. Our own
// small encoder (no dependency); tests read the result back with an independent parser. Pure.

import { APP_NAME } from '../config/app';
import type { InstrumentId } from '../audio/instruments/types';
import { loopTicks, PPQ, type LoopProject, type LoopTrack, type NoteEvent } from '../looper/model';
import type { Key, Mode } from '../theory/modes';

/** General MIDI programs (0-based) closest to each instrument. */
export const GM_PROGRAM: Record<InstrumentId, number> = {
  supersawPad: 90, // Pad 3 (polysynth)
  warmPoly: 89, // Pad 2 (warm)
  subBass: 38, // Synth Bass 1
  fmKeys: 4, // Electric Piano 1
  pluck: 45, // Pizzicato Strings
  glassBell: 14, // Tubular Bells
  thereminLead: 80, // Lead 1 (square)
  testSine: 80,
};

/** Pitch-bend range written for tracks that bend (theremin glides). */
export const BEND_RANGE = 12;
export const DRUM_CHANNEL = 9;

/** MIDI channel per track: drums on channel 10, everything else in order, skipping 10. */
export function trackChannels(tracks: readonly LoopTrack[]): Map<string, number> {
  const out = new Map<string, number>();
  let next = 0;
  for (const t of tracks) {
    if (t.part === 'drums') {
      out.set(t.id, DRUM_CHANNEL);
      continue;
    }
    if (next === DRUM_CHANNEL) next++;
    out.set(t.id, Math.min(15, next++));
  }
  return out;
}

const RELATIVE_MAJOR_OFFSET: Record<Mode, number> = {
  ionian: 0,
  dorian: 2,
  phrygian: 4,
  lydian: 5,
  mixolydian: 7,
  aeolian: 9,
  locrian: 11,
};

/** Key signature meta values: sharps (+) / flats (−) and major/minor. */
export function keySignature(key: Key): { sf: number; minor: boolean } {
  const major = (((key.tonic - RELATIVE_MAJOR_OFFSET[key.mode]) % 12) + 12) % 12;
  const k = (major * 7) % 12;
  return { sf: k > 6 ? k - 12 : k, minor: key.mode === 'aeolian' };
}

function vlq(n: number): number[] {
  let v = Math.max(0, Math.round(n));
  const bytes = [v & 0x7f];
  while ((v >>= 7) > 0) bytes.unshift((v & 0x7f) | 0x80);
  return bytes;
}

const text = (s: string) => [...new TextEncoder().encode(s)];
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n: number) => [(n >>> 8) & 255, n & 255];

/** Event order within one tick: notes off, then controls, then notes on. */
interface TimedEvent {
  tick: number;
  order: number;
  bytes: number[];
}

function chunk(type: string, events: TimedEvent[], endTick: number): number[] {
  const sorted = [...events].sort((a, b) => a.tick - b.tick || a.order - b.order);
  const data: number[] = [];
  let last = 0;
  for (const e of sorted) {
    data.push(...vlq(e.tick - last), ...e.bytes);
    last = e.tick;
  }
  data.push(...vlq(Math.max(0, endTick - last)), 0xff, 0x2f, 0x00);
  return [...text(type), ...u32(data.length), ...data];
}

const meta = (tick: number, type: number, bytes: number[]): TimedEvent => ({
  tick,
  order: 0,
  bytes: [0xff, type, ...vlq(bytes.length), ...bytes],
});

/** 14-bit pitch-bend value for an offset in semitones. */
export const bendValue = (semitones: number): number =>
  Math.max(
    0,
    Math.min(
      16383,
      8192 + Math.round((Math.max(-BEND_RANGE, Math.min(BEND_RANGE, semitones)) / BEND_RANGE) * 8191),
    ),
  );

/**
 * A note as it sounds within one loop cycle: one segment, or two when it runs past the loop end and wraps
 * around to the start (so the exported file loops seamlessly in a DAW).
 */
export function noteSegments(
  n: NoteEvent,
  L: number,
): Array<{ tick: number; duration: number; from: number }> {
  const end = n.tick + n.duration;
  if (end <= L) return [{ tick: n.tick, duration: n.duration, from: 0 }];
  return [
    { tick: n.tick, duration: L - n.tick, from: 0 },
    { tick: 0, duration: end - L, from: L - n.tick },
  ];
}

function trackEvents(t: LoopTrack, channel: number, L: number, repeats: number): TimedEvent[] {
  const ev: TimedEvent[] = [meta(0, 0x03, text(t.name))];
  const ch = channel & 15;
  const drums = t.part === 'drums';
  if (!drums && t.instrument !== 'drums')
    ev.push({ tick: 0, order: 1, bytes: [0xc0 | ch, GM_PROGRAM[t.instrument]] });
  const bends = t.notes.some((n) => n.pitch?.length || n.note !== Math.round(n.note));
  if (bends) {
    for (const [cc, v] of [
      [101, 0],
      [100, 0],
      [6, BEND_RANGE],
      [38, 0],
      [101, 127],
      [100, 127],
    ] as const)
      ev.push({ tick: 0, order: 1, bytes: [0xb0 | ch, cc, v] });
  }
  if (!drums) {
    ev.push({ tick: 0, order: 1, bytes: [0xb0 | ch, 74, Math.round(t.brightness * 127)] });
  }
  for (let k = 0; k < repeats; k++) {
    const base = k * L;
    for (const n of t.notes) {
      const key = Math.max(0, Math.min(127, Math.round(n.note)));
      const vel = Math.max(1, Math.min(127, Math.round(n.velocity * 127)));
      for (const seg of noteSegments(n, L)) {
        const on = base + seg.tick;
        const off = on + seg.duration;
        if (bends) {
          // Pitch at the start of this segment, then every glide point inside it.
          const points = n.pitch ?? [];
          const before = [...points].reverse().find((p) => p.tick <= seg.from);
          ev.push({ tick: on, order: 1, bytes: bend(ch, (before?.note ?? n.note) - key) });
          for (const p of points) {
            if (p.tick <= seg.from || p.tick >= seg.from + seg.duration) continue;
            ev.push({ tick: on + p.tick - seg.from, order: 1, bytes: bend(ch, p.note - key) });
          }
        }
        ev.push({ tick: on, order: 2, bytes: [0x90 | ch, key, vel] });
        ev.push({ tick: off, order: 0, bytes: [0x80 | ch, key, 0] });
      }
    }
    for (const lane of t.automation) {
      if (lane.target !== 'macro.brightness' || drums) continue;
      for (const p of lane.points)
        ev.push({
          tick: base + p.tick,
          order: 1,
          bytes: [0xb0 | ch, 74, Math.round(Math.max(0, Math.min(1, p.value)) * 127)],
        });
    }
  }
  return ev;
}

function bend(ch: number, semitones: number): number[] {
  const v = bendValue(semitones);
  return [0xe0 | ch, v & 0x7f, (v >> 7) & 0x7f];
}

export interface MidiFileOptions {
  /** Write the loop this many times (default 1). */
  repeats?: number;
  /** Include muted tracks (default: export what you hear). */
  includeMuted?: boolean;
}

/** SMF type 1: track 0 = tempo / time / key signature, then one MTrk per loop track. */
export function toMidiFile(p: LoopProject, opts: MidiFileOptions = {}): Uint8Array {
  const L = loopTicks(p);
  const repeats = Math.max(1, Math.round(opts.repeats ?? 1));
  const end = L * repeats;
  const solo = p.tracks.some((t) => t.solo);
  const tracks = opts.includeMuted ? p.tracks : p.tracks.filter((t) => (solo ? t.solo : !t.mute));
  const channels = trackChannels(tracks);
  const ks = keySignature(p.key);
  const usPerQuarter = Math.round(60_000_000 / p.bpm);
  const tempo: TimedEvent[] = [
    meta(0, 0x03, text(`${APP_NAME} loop`)),
    meta(0, 0x51, [(usPerQuarter >> 16) & 255, (usPerQuarter >> 8) & 255, usPerQuarter & 255]),
    meta(0, 0x58, [4, 2, 24, 8]),
    meta(0, 0x59, [ks.sf & 255, ks.minor ? 1 : 0]),
  ];
  const bytes = [
    ...text('MThd'),
    ...u32(6),
    ...u16(1),
    ...u16(tracks.length + 1),
    ...u16(PPQ),
    ...chunk('MTrk', tempo, end),
    ...tracks.flatMap((t) => chunk('MTrk', trackEvents(t, channels.get(t.id)!, L, repeats), end)),
  ];
  return new Uint8Array(bytes);
}
