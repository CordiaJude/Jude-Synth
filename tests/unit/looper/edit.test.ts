import { describe, expect, it } from 'vitest';
import {
  addNote,
  deleteNotes,
  moveNotes,
  quantizeTrack,
  removeTrack,
  resizeNotes,
  setGain,
  setInstrument,
  setVelocity,
} from '../../../src/looper/edit';
import { canRedo, canUndo, commit, createHistory, redo, replace, undo } from '../../../src/looper/history';
import {
  audibleTracks,
  emptyProject,
  TICKS_PER_BAR,
  type LoopProject,
  type LoopTrack,
} from '../../../src/looper/model';
import { parseProject } from '../../../src/looper/schema';

const track = (id: string, over: Partial<LoopTrack> = {}): LoopTrack => ({
  id,
  name: id,
  part: 'melody',
  instrument: 'fmKeys',
  notes: [
    { tick: 0, duration: 240, note: 60, velocity: 0.8 },
    { tick: 470, duration: 240, note: 64, velocity: 0.8 },
    { tick: 965, duration: 240, note: 67, velocity: 0.8 },
  ],
  automation: [],
  brightness: 1,
  mute: false,
  solo: false,
  gainDb: 0,
  ...over,
});
const project = (): LoopProject => ({
  ...emptyProject(),
  bars: 1,
  tracks: [track('t1'), track('t2')],
  nextTrackId: 3,
});

describe('history', () => {
  it('undoes and redoes snapshots; a new edit clears the redo stack', () => {
    let h = createHistory(1);
    h = commit(h, 2);
    h = commit(h, 3);
    h = undo(h);
    expect(h.present).toBe(2);
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect(h.present).toBe(3);
    h = undo(undo(h));
    expect(h.present).toBe(1);
    expect(canUndo(h)).toBe(false);
    h = commit(redo(h), 9);
    expect(h.present).toBe(9);
    expect(canRedo(h)).toBe(false);
    expect(undo(h).present).toBe(2);
  });

  it('caps its size and treats replace as not undoable', () => {
    let h = createHistory(0);
    for (let i = 1; i <= 150; i++) h = commit(h, i);
    expect(h.past.length).toBe(100);
    h = replace(h, 999);
    expect(undo(h).present).toBe(149);
  });
});

describe('edits', () => {
  it('quantizes starts to the nearest grid line by strength, keeping lengths', () => {
    const full = quantizeTrack(project(), 't1', '1/8', 1).tracks[0]!.notes;
    expect(full.map((n) => [n.tick, n.duration])).toEqual([
      [0, 240],
      [480, 240],
      [960, 240],
    ]);
    const half = quantizeTrack(project(), 't1', '1/8', 0.5).tracks[0]!.notes;
    expect(half.map((n) => n.tick)).toEqual([0, 475, 963]);
    expect(project().tracks[0]!.notes[1]!.tick).toBe(470); // input untouched
  });

  it('moves notes in time (wrapping around the loop) and pitch', () => {
    const p = moveNotes(project(), 't1', [2], TICKS_PER_BAR - 900, 2);
    const moved = p.tracks[0]!.notes.find((n) => n.note === 69)!;
    expect(moved.tick).toBe(65);
    expect(p.tracks[0]!.notes.map((n) => n.tick)).toEqual([0, 65, 470]); // re-sorted
  });

  it('adds, resizes, re-velocities and deletes notes within bounds', () => {
    let p = addNote(project(), 't2', { tick: TICKS_PER_BAR + 10, duration: 99999, note: 200, velocity: 0.5 });
    const added = p.tracks[1]!.notes.find((n) => n.tick === 10)!;
    expect(added).toMatchObject({ duration: TICKS_PER_BAR, note: 127 });
    p = resizeNotes(p, 't2', [0], (d) => d * 2);
    p = setVelocity(p, 't2', [0], 3);
    expect(p.tracks[1]!.notes[0]).toMatchObject({ duration: 480, velocity: 1 });
    p = deleteNotes(p, 't2', [0, 1]);
    expect(p.tracks[1]!.notes).toHaveLength(2);
  });

  it('track settings: instrument (not on drums), gain clamp, solo/mute, delete', () => {
    let p = setInstrument(project(), 't1', 'glassBell');
    expect(p.tracks[0]!.instrument).toBe('glassBell');
    p = setGain(p, 't1', 40);
    expect(p.tracks[0]!.gainDb).toBe(6);
    p = { ...p, tracks: p.tracks.map((t) => (t.id === 't2' ? { ...t, solo: true } : t)) };
    expect([...audibleTracks(p)]).toEqual(['t2']);
    p = removeTrack(removeTrack(p, 't1'), 't2');
    expect(p.bars).toBe(0); // empty loop: the next take sets the length again
  });
});

describe('stored projects', () => {
  it('round-trip through JSON and reject malformed data', () => {
    const p = project();
    expect(parseProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(parseProject({ ...p, version: 2 })).toBeNull();
    expect(parseProject({ ...p, tracks: [{ ...p.tracks[0], instrument: 'kazoo' }] })).toBeNull();
    expect(parseProject('nope')).toBeNull();
  });
});
