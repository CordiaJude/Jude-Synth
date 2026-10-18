// MusicEvents → MIDI messages, for Web MIDI out. Stateful (it remembers which notes each slot holds, so
// chord voicings become note-ons/offs and every note gets its off), but pure: no I/O.

import { isLoopSlot, type MusicEvent, type SlotRef } from '../events/types';
import { DRUM_NOTE } from '../looper/model';
import { bendValue, BEND_RANGE, DRUM_CHANNEL } from './midiFile';

export interface MidiMessage {
  data: number[];
  /** Audio-clock time (s) the message belongs to. */
  time: number;
}

export type ChannelLayout =
  /** Live chords 1 · melody 2 · bass 3 · drums 10 · loop tracks 4–9, 11–12 (one channel per track). */
  | { kind: 'split' }
  /** Every melodic part on one channel (0-based), drums on 10. */
  | { kind: 'single'; channel: number };

const LIVE_SPLIT: Record<string, number> = { chords: 0, melody: 1, bass: 2 };
/** Loop track channels in order of the track list (0-based), skipping the drum channel. */
const LOOP_CHANNELS = [3, 4, 5, 6, 7, 8, 10, 11];
const DRUM_MS = 0.06;

export class MidiTranslator {
  private layout: ChannelLayout;
  /** Loop track id → position in the track list (for split channels). */
  private trackIndex = new Map<string, number>();
  private chords = new Map<SlotRef, Set<number>>();
  private notes = new Map<string, { channel: number; key: number }>();
  /** Channels that have had their pitch-bend range set. */
  private bendReady = new Set<number>();
  /** Every (channel, key) currently on, for a clean panic. */
  private sounding = new Map<string, number>();

  constructor(layout: ChannelLayout = { kind: 'split' }) {
    this.layout = layout;
  }

  setLayout(layout: ChannelLayout): void {
    this.layout = layout;
  }

  setTracks(ids: readonly string[]): void {
    this.trackIndex = new Map(ids.map((id, i) => [id, i]));
  }

  /** null = this slot isn't sent. */
  channelOf(slot: SlotRef | 'drums', drum = false): number | null {
    if (drum) return DRUM_CHANNEL;
    if (this.layout.kind === 'single') return this.layout.channel & 15;
    if (isLoopSlot(slot)) {
      const i = this.trackIndex.get(slot.slice(5));
      return i === undefined ? null : (LOOP_CHANNELS[i] ?? null);
    }
    return LIVE_SPLIT[slot] ?? null;
  }

  private on(channel: number, key: number, velocity: number, time: number, out: MidiMessage[]) {
    const k = `${channel}:${key}`;
    // Same key already on this channel (e.g. two parts share a channel): retrigger cleanly.
    if (this.sounding.get(k)) out.push({ data: [0x80 | channel, key, 0], time });
    this.sounding.set(k, (this.sounding.get(k) ?? 0) + 1);
    out.push({ data: [0x90 | channel, key, Math.max(1, Math.min(127, Math.round(velocity * 127)))], time });
  }

  private off(channel: number, key: number, time: number, out: MidiMessage[]) {
    const k = `${channel}:${key}`;
    const n = this.sounding.get(k) ?? 0;
    if (n <= 0) return;
    if (n === 1) this.sounding.delete(k);
    else this.sounding.set(k, n - 1);
    out.push({ data: [0x80 | channel, key, 0], time });
  }

  private ensureBend(channel: number, time: number, out: MidiMessage[]) {
    if (this.bendReady.has(channel)) return;
    this.bendReady.add(channel);
    for (const [cc, v] of [
      [101, 0],
      [100, 0],
      [6, BEND_RANGE],
      [38, 0],
      [101, 127],
      [100, 127],
    ] as const)
      out.push({ data: [0xb0 | channel, cc, v], time });
  }

  translate(e: MusicEvent): MidiMessage[] {
    const out: MidiMessage[] = [];
    switch (e.kind) {
      case 'chord': {
        if (e.play === false) break;
        const ch = this.channelOf(e.slot);
        if (ch === null) break;
        const held = this.chords.get(e.slot) ?? new Set<number>();
        const next = new Set((e.chord || isLoopSlot(e.slot) ? e.voicing : []).map((n) => Math.round(n)));
        for (const k of held) if (!next.has(k)) this.off(ch, k, e.time, out);
        for (const k of next) if (!held.has(k)) this.on(ch, k, e.velocity, e.time, out);
        this.chords.set(e.slot, next);
        break;
      }
      case 'noteOn': {
        const ch = this.channelOf(e.slot);
        if (ch === null) break;
        const id = `${e.slot}|${e.id}`;
        const prev = this.notes.get(id);
        if (prev) this.off(prev.channel, prev.key, e.time, out);
        const key = Math.max(0, Math.min(127, Math.round(e.note)));
        if (e.note !== key) {
          this.ensureBend(ch, e.time, out);
          out.push({ data: bendMsg(ch, e.note - key), time: e.time });
        }
        this.on(ch, key, e.velocity, e.time, out);
        this.notes.set(id, { channel: ch, key });
        break;
      }
      case 'noteOff': {
        const id = `${e.slot}|${e.id}`;
        const n = this.notes.get(id);
        if (!n) break;
        this.off(n.channel, n.key, e.time, out);
        this.notes.delete(id);
        break;
      }
      case 'pitch': {
        const n = this.notes.get(`${e.slot}|${e.id}`);
        if (!n) break;
        this.ensureBend(n.channel, e.time, out);
        out.push({ data: bendMsg(n.channel, e.note - n.key), time: e.time });
        break;
      }
      case 'slotRelease': {
        const ch = this.channelOf(e.slot);
        for (const k of this.chords.get(e.slot) ?? []) if (ch !== null) this.off(ch, k, e.time, out);
        this.chords.delete(e.slot);
        for (const [id, n] of this.notes) {
          if (!id.startsWith(`${e.slot}|`)) continue;
          this.off(n.channel, n.key, e.time, out);
          this.notes.delete(id);
        }
        break;
      }
      case 'drum': {
        const key = DRUM_NOTE[e.voice];
        const vel = Math.max(1, Math.min(127, Math.round(e.velocity * 127)));
        out.push({ data: [0x90 | DRUM_CHANNEL, key, vel], time: e.time });
        out.push({ data: [0x80 | DRUM_CHANNEL, key, 0], time: e.time + DRUM_MS });
        break;
      }
      case 'param': {
        // Brightness → CC 74 ("brightness" / filter cutoff on most synths).
        if (e.target !== 'macro.brightness') break;
        const value = Math.round(Math.max(0, Math.min(1, e.value)) * 127);
        const channels = e.slot
          ? [this.channelOf(e.slot)]
          : this.layout.kind === 'single'
            ? [this.layout.channel & 15]
            : [LIVE_SPLIT.chords!, LIVE_SPLIT.melody!];
        for (const ch of channels) if (ch !== null) out.push({ data: [0xb0 | ch, 74, value], time: e.time });
        break;
      }
      default:
        break;
    }
    return out;
  }

  /** Note-off for everything still on, plus all-notes-off on every channel used. */
  panic(time: number): MidiMessage[] {
    const out: MidiMessage[] = [];
    const channels = new Set<number>();
    for (const k of this.sounding.keys()) {
      const [ch, key] = k.split(':').map(Number) as [number, number];
      channels.add(ch);
      out.push({ data: [0x80 | ch, key, 0], time });
    }
    for (const ch of channels) out.push({ data: [0xb0 | ch, 123, 0], time });
    this.sounding.clear();
    this.chords.clear();
    this.notes.clear();
    return out;
  }
}

const bendMsg = (ch: number, semitones: number): number[] => {
  const v = bendValue(semitones);
  return [0xe0 | ch, v & 0x7f, (v >> 7) & 0x7f];
};
