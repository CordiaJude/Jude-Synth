// Edits on a loop project (track settings, piano-roll note edits, post-recording quantize). Pure: every
// function returns a new project and leaves the input untouched.

import { GRID_BEATS, type Grid } from '../performance/transport';
import {
  loopTicks,
  PPQ,
  sortNotes,
  wrapTick,
  type LoopProject,
  type LoopTrack,
  type NoteEvent,
  type TrackInstrument,
} from './model';

export const gridTicks = (grid: Exclude<Grid, 'off'>): number => Math.round(GRID_BEATS[grid] * PPQ);

export function updateTrack(p: LoopProject, id: string, fn: (t: LoopTrack) => LoopTrack): LoopProject {
  return { ...p, tracks: p.tracks.map((t) => (t.id === id ? fn(t) : t)) };
}

export const setMute = (p: LoopProject, id: string, mute: boolean) =>
  updateTrack(p, id, (t) => ({ ...t, mute }));
export const setSolo = (p: LoopProject, id: string, solo: boolean) =>
  updateTrack(p, id, (t) => ({ ...t, solo }));
export const setGain = (p: LoopProject, id: string, gainDb: number) =>
  updateTrack(p, id, (t) => ({ ...t, gainDb: Math.max(-60, Math.min(6, gainDb)) }));
export const renameTrack = (p: LoopProject, id: string, name: string) =>
  updateTrack(p, id, (t) => ({ ...t, name: name.slice(0, 40) || t.name }));

export function setInstrument(p: LoopProject, id: string, instrument: TrackInstrument): LoopProject {
  return updateTrack(p, id, (t) => (t.part === 'drums' || instrument === 'drums' ? t : { ...t, instrument }));
}

/** Delete a track. Deleting the last one empties the loop (its length is free again). */
export function removeTrack(p: LoopProject, id: string): LoopProject {
  const tracks = p.tracks.filter((t) => t.id !== id);
  return { ...p, tracks, bars: tracks.length ? p.bars : 0 };
}

export const clearProject = (p: LoopProject): LoopProject => ({ ...p, tracks: [], bars: 0 });

const clampPitch = (n: number) => Math.max(0, Math.min(127, n));

function editNotes(
  p: LoopProject,
  id: string,
  fn: (notes: NoteEvent[], L: number) => NoteEvent[],
): LoopProject {
  const L = loopTicks(p);
  return updateTrack(p, id, (t) => ({ ...t, notes: sortNotes(fn(t.notes, L)) }));
}

/** Add a note (piano roll). Drawn notes are plain notes, even on a chord track. */
export function addNote(p: LoopProject, id: string, note: Omit<NoteEvent, 'chord'>): LoopProject {
  return editNotes(p, id, (notes, L) => [
    ...notes,
    {
      ...note,
      tick: wrapTick(Math.round(note.tick), L),
      duration: Math.max(1, Math.min(L, Math.round(note.duration))),
      note: clampPitch(note.note),
    },
  ]);
}

export function deleteNotes(p: LoopProject, id: string, indices: readonly number[]): LoopProject {
  const drop = new Set(indices);
  return editNotes(p, id, (notes) => notes.filter((_, i) => !drop.has(i)));
}

/** Move notes in time (wrapping around the loop) and pitch. */
export function moveNotes(
  p: LoopProject,
  id: string,
  indices: readonly number[],
  dTick: number,
  dNote: number,
): LoopProject {
  const sel = new Set(indices);
  return editNotes(p, id, (notes, L) =>
    notes.map((n, i) =>
      sel.has(i)
        ? {
            ...n,
            tick: wrapTick(n.tick + Math.round(dTick), L),
            note: clampPitch(n.note + dNote),
            pitch: n.pitch?.map((pt) => ({ ...pt, note: clampPitch(pt.note + dNote) })),
          }
        : n,
    ),
  );
}

export function resizeNotes(
  p: LoopProject,
  id: string,
  indices: readonly number[],
  duration: (d: number) => number,
) {
  const sel = new Set(indices);
  return editNotes(p, id, (notes, L) =>
    notes.map((n, i) =>
      sel.has(i) ? { ...n, duration: Math.max(1, Math.min(L, Math.round(duration(n.duration)))) } : n,
    ),
  );
}

export function setVelocity(
  p: LoopProject,
  id: string,
  indices: readonly number[],
  velocity: number,
): LoopProject {
  const sel = new Set(indices);
  const v = Math.max(0.05, Math.min(1, velocity));
  return editNotes(p, id, (notes) => notes.map((n, i) => (sel.has(i) ? { ...n, velocity: v } : n)));
}

/**
 * Post-recording quantize: pull every note start toward the NEAREST grid line by `strength` (unlike live
 * quantize, recorded notes can move earlier). Chord tones that started together move together, and
 * lengths are kept.
 */
export function quantizeTrack(
  p: LoopProject,
  id: string,
  grid: Exclude<Grid, 'off'>,
  strength: number,
): LoopProject {
  const g = GRID_BEATS[grid] * PPQ;
  const s = Math.max(0, Math.min(1, strength));
  return editNotes(p, id, (notes, L) =>
    notes.map((n) => {
      const target = Math.round(n.tick / g) * g;
      return { ...n, tick: wrapTick(Math.round(n.tick + (target - n.tick) * s), L) };
    }),
  );
}

/** Apply `fn` to the given notes (e.g. drum notes moving between kit rows). */
export function mapNotes(
  p: LoopProject,
  id: string,
  indices: readonly number[],
  fn: (n: NoteEvent, L: number) => NoteEvent,
): LoopProject {
  const sel = new Set(indices);
  return editNotes(p, id, (notes, L) => notes.map((n, i) => (sel.has(i) ? fn(n, L) : n)));
}

/** A note's identity for selections that survive re-sorting. */
export const noteKey = (n: Pick<NoteEvent, 'tick' | 'note'>): string => `${n.tick}:${n.note}`;
