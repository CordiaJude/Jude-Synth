// Polyphonic voice allocation for one instrument: voice-led chord changes (glide or crossfade per voice),
// individual notes, and voice stealing that always fades before reuse.

import type { BaseContext } from 'tone';
import type { ChordTransition } from '../events/types';
import type { Midi } from '../theory/notes';
import { assignVoices } from '../theory/voiceLeading';
import type { Patch } from './instruments/types';
import { Voice } from './voice';

export interface ChordOptions {
  transition?: ChordTransition;
  velocity?: number;
}

export class VoiceManager {
  readonly patch: Patch;
  private voices: Voice[];
  /** Voices currently holding chord tones, keyed by their note. */
  private chord = new Map<Midi, Voice>();
  private notes = new Map<string, Voice>();
  private brightness = 1;

  constructor(ctx: BaseContext, patch: Patch, destination: AudioNode) {
    this.patch = patch;
    this.voices = Array.from({ length: patch.maxVoices }, (_, i) => new Voice(ctx, patch, destination, i));
  }

  /** Pick a voice for a new note: a free one, else the quietest released one, else the oldest. */
  private allocate(time: number, protect: Set<Voice>): Voice {
    const free = this.voices.find((v) => !protect.has(v) && v.isFree(time));
    if (free) return free;
    const candidates = this.voices.filter((v) => !protect.has(v));
    const pool = candidates.length ? candidates : this.voices;
    const released = pool.filter((v) => !v.gateOn);
    if (released.length) return released.reduce((a, b) => (a.loudness(time) <= b.loudness(time) ? a : b));
    return pool.reduce((a, b) => (a.startedAt <= b.startedAt ? a : b));
  }

  private forget(v: Voice) {
    for (const [n, cv] of this.chord) if (cv === v) this.chord.delete(n);
    for (const [id, nv] of this.notes) if (nv === v) this.notes.delete(id);
  }

  /** Current chord notes (sorted). */
  chordNotes(): Midi[] {
    return [...this.chord.keys()].sort((a, b) => a - b);
  }

  /**
   * Move to a new voicing. Common tones keep sounding untouched. Moving tones either glide (legato) or
   * crossfade (old voice releases while a new one fades in). An empty voicing releases the chord.
   */
  setChord(voicing: readonly Midi[], time: number, opts: ChordOptions = {}): void {
    const p = this.patch;
    const transition = p.mono ? 'legato' : (opts.transition ?? p.transition);
    const velocity = opts.velocity ?? 0.8;
    const prev = new Map(this.chord);
    const next = new Map<Midi, Voice>();
    // Voices of the outgoing chord stay protected so their crossfade/release is never cut short by
    // allocation (unless every voice is busy, in which case allocate() steals with a fade).
    const protect = new Set<Voice>(prev.values());
    const take = () => {
      const v = this.allocate(time, new Set([...protect, ...next.values()]));
      for (const [id, nv] of this.notes) if (nv === v) this.notes.delete(id);
      return v;
    };

    const pairs = assignVoices([...prev.keys()], p.mono ? voicing.slice(0, 1) : voicing);
    for (const { from, to } of pairs) {
      if (from !== null && to !== null && from === to) next.set(to, prev.get(from)!);
    }
    for (const { from, to } of pairs) {
      if (from === null || to === null || from === to) continue;
      const v = prev.get(from)!;
      if (transition === 'legato') {
        v.glide(to, time);
        next.set(to, v);
      } else {
        v.release(time, Math.min(p.amp.release, p.crossfade));
        const nv = take();
        nv.start(to, velocity, time, Math.max(p.amp.attack, p.crossfade));
        next.set(to, nv);
      }
    }
    for (const { from, to } of pairs) {
      if (from !== null && to === null) prev.get(from)!.release(time);
      if (from === null && to !== null) {
        const nv = take();
        nv.start(to, velocity, time);
        next.set(to, nv);
      }
    }
    this.chord = next;
  }

  noteOn(id: string, note: Midi, velocity: number, time: number): void {
    this.noteOff(id, time);
    const v = this.allocate(time, new Set([...this.chord.values(), ...this.notes.values()]));
    this.forget(v);
    v.start(note, velocity, time);
    this.notes.set(id, v);
  }

  noteOff(id: string, time: number): void {
    const v = this.notes.get(id);
    if (!v) return;
    v.release(time);
    this.notes.delete(id);
  }

  releaseAll(time: number): void {
    for (const v of this.voices) v.release(time);
    this.chord.clear();
    this.notes.clear();
  }

  setBrightness(x01: number, time: number, seconds: number): void {
    this.brightness = x01;
    const [lo, hi] = this.patch.filter.cutoff;
    const hz = lo * Math.pow(hi / lo, Math.max(0, Math.min(1, x01)));
    for (const v of this.voices) v.setBrightness(hz, time, seconds, x01);
  }

  setVibrato(depth01: number, time: number, seconds: number): void {
    for (const v of this.voices) v.setVibrato(depth01, time, seconds);
  }

  /** Continuous pitch for a sounding note (theremin, melody glide). */
  pitchNote(id: string, note: Midi, time: number, glide: number): void {
    const v = this.notes.get(id);
    if (v) v.glide(note, time, glide);
  }

  setSpread(scale: number, time: number, seconds: number): void {
    for (const v of this.voices) v.setSpread(scale, time, seconds);
  }

  get brightnessValue(): number {
    return this.brightness;
  }

  /** Voices gated on or still audible at `time`. */
  activeVoices(time: number): number {
    return this.voices.filter((v) => !v.isFree(time)).length;
  }

  dispose(): void {
    for (const v of this.voices) v.dispose();
  }
}
