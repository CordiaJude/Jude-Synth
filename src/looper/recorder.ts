// Recording: turns the live MusicEvent stream into loop notes. Pure.
//
// A LiveTracker follows what is sounding on each live part (chord voicings, individual notes with their
// pitch moves, the brightness / vibrato controls). buildTake() replays the events of a recording window
// through it and returns notes in ticks relative to the window start; placeTake() lays a take into the
// project (as new tracks, or merged into existing ones).

import type { ChordTransition, DrumVoice, MusicEvent, SlotRef } from '../events/types';
import { isLoopSlot } from '../events/types';
import type { Midi } from '../theory/notes';
import {
  DRUM_NOTE,
  MAX_TRACKS,
  PART_LABEL,
  PPQ,
  sortNotes,
  thin,
  TICKS_PER_BAR,
  wrapTick,
  type AutomationLane,
  type AutomationTarget,
  type LoopProject,
  type LoopTrack,
  type NoteEvent,
  type Part,
  type TrackInstrument,
} from './model';

interface Sounding {
  part: Part;
  note: Midi;
  velocity: number;
  /** Audio time it started. */
  start: number;
  chord: boolean;
  transition?: ChordTransition;
  pitch: Array<{ time: number; note: Midi; glide: number }>;
}

interface Closed extends Sounding {
  end: number;
}

const MELODIC: ReadonlySet<SlotRef> = new Set(['chords', 'melody', 'bass']);
const partOf = (slot: SlotRef): Part | null => (MELODIC.has(slot) ? (slot as Part) : null);

export interface LiveControls {
  brightness: number;
  vibrato: number;
}

/** What is sounding on the live parts right now. Mutable, with an explicit clone (cheap: a few notes). */
export class LiveTracker {
  /** Chord tones per part, keyed by MIDI note. */
  chord = new Map<Part, Map<Midi, Sounding>>();
  /** Individually triggered notes, keyed by slot + id. */
  notes = new Map<string, Sounding>();
  controls: LiveControls = { brightness: 1, vibrato: 0 };

  clone(): LiveTracker {
    const t = new LiveTracker();
    for (const [p, m] of this.chord) t.chord.set(p, new Map([...m].map(([k, s]) => [k, copy(s)])));
    for (const [k, s] of this.notes) t.notes.set(k, copy(s));
    t.controls = { ...this.controls };
    return t;
  }

  /** Apply one live event; returns the notes it ended. Loop playback events are ignored. */
  apply(e: MusicEvent): Closed[] {
    const closed: Closed[] = [];
    switch (e.kind) {
      case 'chord': {
        const part = partOf(e.slot);
        if (!part || e.play === false) break;
        const held = this.chord.get(part) ?? new Map<Midi, Sounding>();
        const next = new Set(e.chord ? e.voicing : []);
        for (const [n, s] of held) {
          if (!next.has(n)) {
            closed.push({ ...s, end: e.time });
            held.delete(n);
          }
        }
        for (const n of next) {
          if (held.has(n)) continue;
          held.set(n, {
            part,
            note: n,
            velocity: e.velocity,
            start: e.time,
            chord: true,
            transition: e.transition,
            pitch: [],
          });
        }
        this.chord.set(part, held);
        break;
      }
      case 'noteOn': {
        const part = partOf(e.slot);
        if (!part) break;
        const key = `${e.slot}|${e.id}`;
        const prev = this.notes.get(key);
        if (prev) closed.push({ ...prev, end: e.time });
        this.notes.set(key, {
          part,
          note: e.note,
          velocity: e.velocity,
          start: e.time,
          chord: false,
          pitch: [],
        });
        break;
      }
      case 'noteOff': {
        const key = `${e.slot}|${e.id}`;
        const s = this.notes.get(key);
        if (s) {
          closed.push({ ...s, end: e.time });
          this.notes.delete(key);
        }
        break;
      }
      case 'pitch': {
        const s = this.notes.get(`${e.slot}|${e.id}`);
        if (s) s.pitch.push({ time: e.time, note: e.note, glide: e.glide });
        break;
      }
      case 'slotRelease': {
        const part = partOf(e.slot);
        if (!part) break;
        for (const s of this.chord.get(part)?.values() ?? []) closed.push({ ...s, end: e.time });
        this.chord.delete(part);
        for (const [k, s] of this.notes) {
          if (s.part !== part) continue;
          closed.push({ ...s, end: e.time });
          this.notes.delete(k);
        }
        break;
      }
      case 'param':
        if (e.slot) break;
        if (e.target === 'macro.brightness') this.controls.brightness = e.value;
        else if (e.target === 'melody.vibrato') this.controls.vibrato = e.value;
        break;
      default:
        break;
    }
    return closed;
  }

  /** Everything still sounding (closed at `time`). */
  sounding(): Sounding[] {
    return [...[...this.chord.values()].flatMap((m) => [...m.values()]), ...this.notes.values()];
  }
}

const copy = (s: Sounding): Sounding => ({ ...s, pitch: [...s.pitch] });

/** Only live events are recorded: not looper playback, not other loop tracks' automation. */
export function isLiveEvent(e: MusicEvent): boolean {
  if (e.kind === 'drum' || e.kind === 'param') return !e.slot;
  if (e.kind === 'transport') return false;
  return !isLoopSlot(e.slot);
}

export interface TakePart {
  /** Ticks relative to the take start. */
  notes: NoteEvent[];
  automation: AutomationLane[];
  /** Brightness when the take started. */
  brightness: number;
}

export interface Take {
  parts: Partial<Record<Part, TakePart>>;
  /** Length of the recording window in ticks. */
  length: number;
}

/** Which parts each live control is recorded onto. */
const CONTROL_PARTS: Record<AutomationTarget, Part[]> = {
  'macro.brightness': ['chords', 'melody'],
  'melody.vibrato': ['melody'],
};

/**
 * Replay `events` (live, any order) from the `baseline` state and collect what sounded in [start, end).
 * `toTick` maps an audio time to ticks from the take start (the caller knows the tempo).
 */
export function buildTake(
  baseline: LiveTracker,
  events: readonly MusicEvent[],
  start: number,
  end: number,
  toTick: (time: number) => number,
): Take {
  const tracker = baseline.clone();
  const sorted = events.filter(isLiveEvent).sort((a, b) => a.time - b.time);
  let i = 0;
  for (; i < sorted.length && sorted[i]!.time < start; i++) tracker.apply(sorted[i]!);

  // Whatever was already sounding when recording started begins at the take start, at its current pitch.
  for (const s of tracker.sounding()) {
    const last = [...s.pitch].reverse().find((p) => p.time <= start);
    s.note = last?.note ?? s.note;
    s.pitch = s.pitch.filter((p) => p.time > start);
    s.start = Math.max(s.start, start);
  }
  const startControls = { ...tracker.controls };
  const closed: Closed[] = [];
  const hits: Array<{ voice: DrumVoice; velocity: number; time: number }> = [];
  const moves: Array<{ target: AutomationTarget; time: number; value: number }> = [];
  for (; i < sorted.length && sorted[i]!.time < end; i++) {
    const e = sorted[i]!;
    if (e.kind === 'drum') hits.push(e);
    else if (e.kind === 'param' && (e.target === 'macro.brightness' || e.target === 'melody.vibrato'))
      moves.push({ target: e.target, time: e.time, value: e.value });
    closed.push(...tracker.apply(e));
  }
  for (const s of tracker.sounding()) closed.push({ ...s, end });

  const length = Math.max(1, toTick(end));
  const parts: Partial<Record<Part, TakePart>> = {};
  const partOfTake = (p: Part): TakePart =>
    (parts[p] ??= { notes: [], automation: [], brightness: startControls.brightness });

  for (const c of closed) {
    if (c.end <= start) continue;
    const tick = Math.max(0, toTick(Math.max(c.start, start)));
    if (tick >= length) continue;
    const endTick = Math.min(length, toTick(Math.min(c.end, end)));
    const note: NoteEvent = {
      tick,
      duration: Math.max(1, endTick - tick),
      note: c.note,
      velocity: c.velocity,
    };
    if (c.chord) {
      note.chord = true;
      if (c.transition) note.transition = c.transition;
    }
    const pitch = c.pitch
      .filter((p) => p.time >= start && p.time < Math.min(c.end, end))
      .map((p) => ({ tick: Math.max(0, toTick(p.time) - tick), note: p.note, glide: p.glide }));
    // Every pitch move is a short glide to a target (not a point on a line), so the curve can't be
    // simplified without changing the sound: only moves that don't actually move are dropped.
    const moves = pitch.filter((p, k) => k === 0 || Math.abs(p.note - pitch[k - 1]!.note) > 0.002);
    if (moves.length) note.pitch = moves;
    partOfTake(c.part).notes.push(note);
  }
  for (const h of hits) {
    const tick = toTick(h.time);
    if (tick < 0 || tick >= length) continue;
    partOfTake('drums').notes.push({
      tick,
      duration: PPQ / 4,
      note: DRUM_NOTE[h.voice],
      velocity: h.velocity,
    });
  }
  for (const [p, tp] of Object.entries(parts) as Array<[Part, TakePart]>) {
    tp.notes = sortNotes(tp.notes);
    for (const target of ['macro.brightness', 'melody.vibrato'] as const) {
      if (!CONTROL_PARTS[target].includes(p)) continue;
      const own = moves.filter((m) => m.target === target);
      if (!own.length) continue;
      const initial = target === 'macro.brightness' ? startControls.brightness : startControls.vibrato;
      const points = [
        { tick: 0, value: initial },
        ...own.map((m) => ({ tick: Math.max(0, toTick(m.time)), value: m.value })),
      ];
      tp.automation.push({ target, points: thin(points, (x) => x.value, 0.004) });
    }
  }
  return { parts, length };
}

/** Round a recording to whole bars (nearest, at least one). */
export const barsForLength = (ticks: number): number => Math.max(1, Math.round(ticks / TICKS_PER_BAR));

export interface PlaceOptions {
  /** Loop length in ticks. */
  loopLength: number;
  /** Where in the loop the take started (ticks). */
  offset: number;
  /** New tracks for every pass, or merge into the existing track of the same part and instrument. */
  mode: 'new' | 'merge';
  instruments: Record<Part, TrackInstrument>;
}

export interface PlaceResult {
  project: LoopProject;
  added: string[];
  merged: string[];
  /** Parts that didn't fit (track limit reached and nothing to merge into). */
  dropped: Part[];
}

/** Lay a take into the project. Notes are wrapped into the loop; nothing is longer than the loop. */
export function placeTake(project: LoopProject, take: Take, o: PlaceOptions): PlaceResult {
  const L = o.loopLength;
  let tracks = [...project.tracks];
  let nextTrackId = project.nextTrackId;
  const added: string[] = [];
  const merged: string[] = [];
  const dropped: Part[] = [];
  for (const part of ['chords', 'bass', 'melody', 'drums'] as const) {
    const tp = take.parts[part];
    if (!tp?.notes.length) continue;
    const notes = tp.notes.map((n) => ({
      ...n,
      tick: wrapTick(o.offset + n.tick, L),
      duration: Math.min(n.duration, L),
    }));
    const automation = tp.automation.map((a) => ({
      ...a,
      points: a.points
        .map((p) => ({ ...p, tick: wrapTick(o.offset + p.tick, L) }))
        .sort((x, y) => x.tick - y.tick),
    }));
    const instrument = o.instruments[part];
    const same = tracks.find((t) => t.part === part && t.instrument === instrument);
    const samePart = [...tracks].reverse().find((t) => t.part === part);
    // Full: merge into the closest match rather than lose the take.
    const target =
      (o.mode === 'merge' ? same : undefined) ??
      (tracks.length >= MAX_TRACKS ? (same ?? samePart) : undefined);
    if (target) {
      const lanes = new Map(target.automation.map((a) => [a.target, a]));
      for (const a of automation) lanes.set(a.target, a);
      tracks = tracks.map((t) =>
        t.id === target.id
          ? { ...t, notes: sortNotes([...t.notes, ...notes]), automation: [...lanes.values()] }
          : t,
      );
      merged.push(target.id);
      continue;
    }
    if (tracks.length >= MAX_TRACKS) {
      dropped.push(part);
      continue;
    }
    const count = tracks.filter((t) => t.part === part).length;
    const track: LoopTrack = {
      id: `t${nextTrackId++}`,
      name: count ? `${PART_LABEL[part]} ${count + 1}` : PART_LABEL[part],
      part,
      instrument,
      notes: sortNotes(notes),
      automation,
      brightness: tp.brightness,
      mute: false,
      solo: false,
      gainDb: 0,
    };
    tracks.push(track);
    added.push(track.id);
  }
  return { project: { ...project, tracks, nextTrackId }, added, merged, dropped };
}

/** Convenience for tests and the controller: ticks from `startBeat` for a beat position. */
export const ticksFromBeats = (beat: number, startBeat: number): number =>
  Math.round((beat - startBeat) * PPQ);
