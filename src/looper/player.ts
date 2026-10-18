// Loop playback: the events a project produces in a time window. Pure and window-independent (like the
// arp and drum generators), so the scheduler can slice time any way it likes. Chord notes are played back
// as voicings at every change of the held set, so the instrument voice-leads exactly as it did live.

import { loopSlot, type ChordTransition, type MusicEvent } from '../events/types';
import { beatAt, timeAtBeat, type Transport } from '../performance/transport';
import type { Midi } from '../theory/notes';
import {
  drumVoiceOf,
  loopTicks,
  PPQ,
  wrapTick,
  type LoopProject,
  type LoopTrack,
  type NoteEvent,
} from './model';

/** Where the loop sits on the transport: tick 0 of cycle 0 is at `startBeat`. */
export interface LoopClock {
  transport: Transport;
  startBeat: number;
}

export interface PlayOptions {
  audible: ReadonlySet<string>;
  /** Finite playback (export): play this many cycles, then release. Omitted = loop forever. */
  cycles?: number;
}

export interface ChordChange {
  tick: number;
  voicing: Midi[];
  velocity: number;
  transition?: ChordTransition;
}

const covers = (n: NoteEvent, t: number, L: number) => wrapTick(t - n.tick, L) < n.duration;
/** Sounding just before tick t (a note that starts at t isn't; one that ends at t is). */
const coversBefore = (n: NoteEvent, t: number, L: number) => {
  const d = wrapTick(t - n.tick, L);
  return d === 0 ? n.duration >= L : d <= n.duration;
};

const setKey = (notes: Midi[]) => notes.join(',');
const voicingOf = (notes: NoteEvent[]) => [...new Set(notes.map((n) => n.note))].sort((a, b) => a - b);

/** The held chord at a tick (sorted MIDI notes). */
export function chordAt(notes: readonly NoteEvent[], tick: number, L: number): Midi[] {
  return voicingOf(notes.filter((n) => n.chord && covers(n, tick, L)));
}

const changesCache = new WeakMap<readonly NoteEvent[], ChordChange[]>();

/** Every tick where the held chord changes, cyclically around the loop. */
export function chordChanges(notes: readonly NoteEvent[], L: number): ChordChange[] {
  const hit = changesCache.get(notes);
  if (hit) return hit;
  const chordNotes = notes.filter((n) => n.chord);
  const ticks = [...new Set(chordNotes.flatMap((n) => [n.tick, wrapTick(n.tick + n.duration, L)]))].sort(
    (a, b) => a - b,
  );
  const out: ChordChange[] = [];
  for (const t of ticks) {
    const now = voicingOf(chordNotes.filter((n) => covers(n, t, L)));
    const before = voicingOf(chordNotes.filter((n) => coversBefore(n, t, L)));
    if (setKey(now) === setKey(before)) continue;
    const starting = chordNotes.filter((n) => n.tick === t);
    out.push({
      tick: t,
      voicing: now,
      velocity: starting.length ? Math.max(...starting.map((n) => n.velocity)) : 0.8,
      transition: starting.find((n) => n.transition)?.transition,
    });
  }
  changesCache.set(notes, out);
  return out;
}

/** Same-time events in a fixed order (releases first), so playback is deterministic. */
const KIND_ORDER: Record<MusicEvent['kind'], number> = {
  slotRelease: 0,
  noteOff: 1,
  chord: 2,
  noteOn: 3,
  pitch: 4,
  drum: 5,
  param: 6,
  transport: 7,
};
const slotOf = (e: MusicEvent): string => ('slot' in e ? (e.slot ?? '') : '');
const pitchOf = (e: MusicEvent): number =>
  e.kind === 'noteOn' || e.kind === 'pitch' ? e.note : e.kind === 'drum' ? e.voice.length : 0;

export function compareEvents(a: MusicEvent, b: MusicEvent): number {
  return (
    a.time - b.time ||
    KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
    slotOf(a).localeCompare(slotOf(b)) ||
    pitchOf(a) - pitchOf(b)
  );
}

/** All events the audible tracks produce with times in [from, to). */
export function loopEvents(
  p: LoopProject,
  clock: LoopClock,
  from: number,
  to: number,
  opts: PlayOptions,
): MusicEvent[] {
  const L = loopTicks(p);
  if (L <= 0 || to <= from) return [];
  const tickAt = (time: number) => (beatAt(clock.transport, time) - clock.startBeat) * PPQ;
  const timeAt = (abs: number) => timeAtBeat(clock.transport, clock.startBeat + abs / PPQ);
  const tFrom = tickAt(from);
  const tTo = tickAt(to);
  const inWindow = (abs: number) => abs >= tFrom && abs < tTo;
  const lastCycle = opts.cycles !== undefined ? opts.cycles - 1 : Infinity;
  // One cycle earlier too: a note started there may end (or glide) in this window.
  const cMin = Math.max(0, Math.floor(tFrom / L) - 1);
  const cMax = Math.min(lastCycle, Math.floor(tTo / L));
  const out: MusicEvent[] = [];

  for (const track of p.tracks) {
    if (!opts.audible.has(track.id)) continue;
    const slot = loopSlot(track.id);
    if (track.part === 'drums') {
      for (let c = cMin; c <= cMax; c++) {
        for (const n of track.notes) {
          const abs = c * L + n.tick;
          const voice = drumVoiceOf(n.note);
          if (voice && inWindow(abs))
            out.push({ kind: 'drum', voice, velocity: n.velocity, time: timeAt(abs), slot });
        }
      }
      continue;
    }
    for (let c = cMin; c <= cMax; c++) {
      track.notes.forEach((n) => {
        if (n.chord) return;
        const abs = c * L + n.tick;
        const id = `${track.id}:${c}:${n.tick}:${n.note}`;
        if (inWindow(abs))
          out.push({ kind: 'noteOn', id, slot, note: n.note, velocity: n.velocity, time: timeAt(abs) });
        for (const pt of n.pitch ?? []) {
          if (pt.tick < n.duration && inWindow(abs + pt.tick))
            out.push({
              kind: 'pitch',
              id,
              slot,
              note: pt.note,
              glide: pt.glide,
              time: timeAt(abs + pt.tick),
            });
        }
        if (inWindow(abs + n.duration))
          out.push({ kind: 'noteOff', id, slot, time: timeAt(abs + n.duration) });
      });
      out.push(...chordEvents(track, slot, c, L, inWindow, timeAt));
      for (const lane of track.automation) {
        lane.points.forEach((pt, i) => {
          const abs = c * L + pt.tick;
          if (!inWindow(abs)) return;
          // Thinned automation is a line between kept points: ramp all the way to the next one.
          const next = lane.points[i + 1]?.tick ?? L + (lane.points[0]?.tick ?? 0);
          const rampMs = Math.max(20, (timeAt(c * L + next) - timeAt(abs)) * 1000);
          out.push({ kind: 'param', target: lane.target, value: pt.value, rampMs, time: timeAt(abs), slot });
        });
      }
    }
    // Finite playback ends by releasing whatever chord is still held.
    if (opts.cycles !== undefined) {
      const end = opts.cycles * L;
      if (inWindow(end) && chordAt(track.notes, L - 1, L).length)
        out.push({ kind: 'chord', slot, chord: null, voicing: [], velocity: 0, time: timeAt(end) });
    }
  }
  return out.sort(compareEvents);
}

function chordEvents(
  track: LoopTrack,
  slot: ReturnType<typeof loopSlot>,
  c: number,
  L: number,
  inWindow: (abs: number) => boolean,
  timeAt: (abs: number) => number,
): MusicEvent[] {
  const changes = chordChanges(track.notes, L);
  const out: MusicEvent[] = [];
  const chordEvent = (abs: number, ch: Omit<ChordChange, 'tick'>): MusicEvent => ({
    kind: 'chord',
    slot,
    chord: null,
    voicing: ch.voicing,
    velocity: ch.velocity,
    transition: ch.transition,
    time: timeAt(abs),
  });
  // The very first cycle starts from silence: sound the chord held at tick 0 even if it was "already
  // held" cyclically (it wraps around from the loop end).
  if (c === 0 && inWindow(0) && !changes.some((ch) => ch.tick === 0)) {
    const voicing = chordAt(track.notes, 0, L);
    if (voicing.length) {
      const starting = track.notes.filter((n) => n.chord && n.tick === 0);
      out.push(
        chordEvent(0, {
          voicing,
          velocity: starting.length ? Math.max(...starting.map((n) => n.velocity)) : 0.8,
          transition: undefined,
        }),
      );
    }
  }
  for (const ch of changes) {
    const abs = c * L + ch.tick;
    if (inWindow(abs)) out.push(chordEvent(abs, ch));
  }
  return out;
}

/**
 * Starting (or unmuting) mid-loop: re-sound the chords that should already be held at `time`. Plain notes
 * simply come in at their next start.
 */
export function resumeEvents(
  p: LoopProject,
  trackIds: Iterable<string>,
  clock: LoopClock,
  time: number,
): MusicEvent[] {
  const L = loopTicks(p);
  if (L <= 0) return [];
  const tick = wrapTick(Math.floor((beatAt(clock.transport, time) - clock.startBeat) * PPQ), L);
  const out: MusicEvent[] = [];
  for (const id of trackIds) {
    const t = p.tracks.find((x) => x.id === id);
    if (!t || t.part === 'drums') continue;
    const voicing = chordAt(t.notes, tick, L);
    if (voicing.length)
      out.push({ kind: 'chord', slot: loopSlot(t.id), chord: null, voicing, velocity: 0.75, time });
  }
  return out;
}
