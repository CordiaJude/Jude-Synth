import { describe, expect, it } from 'vitest';
import type { MusicEvent } from '../../../src/events/types';
import { emptyProject, MAX_TRACKS, PPQ, TICKS_PER_BAR, thin, type Part } from '../../../src/looper/model';
import { barsForLength, buildTake, LiveTracker, placeTake, type Take } from '../../../src/looper/recorder';
import { beatAt, type Transport } from '../../../src/performance/transport';
import { diatonicChord } from '../../../src/theory/chords';

const T: Transport = { bpm: 120, origin: 0 }; // beat = 0.5 s, bar = 2 s
const toTick = (start: number) => (time: number) => Math.round((beatAt(T, time) - beatAt(T, start)) * PPQ);
const Am = diatonicChord({ tonic: 9, mode: 'aeolian' }, { degree: 1 });
const chord = (time: number, voicing: number[], extra: Partial<MusicEvent> = {}): MusicEvent =>
  ({
    kind: 'chord',
    slot: 'chords',
    chord: voicing.length ? Am : null,
    voicing,
    velocity: 0.8,
    time,
    ...extra,
  }) as MusicEvent;
const INSTRUMENTS = { chords: 'warmPoly', melody: 'fmKeys', bass: 'subBass', drums: 'drums' } as const;

describe('buildTake', () => {
  it('turns chord voicings into held chord notes (common tones keep sounding)', () => {
    const take = buildTake(
      new LiveTracker(),
      [chord(0, [57, 60, 64]), chord(2, [57, 60, 65]), chord(4, [])],
      0,
      8,
      toTick(0),
    );
    const notes = take.parts.chords!.notes;
    expect(notes.map((n) => [n.tick, n.duration, n.note])).toEqual([
      [0, 2 * TICKS_PER_BAR, 57],
      [0, 2 * TICKS_PER_BAR, 60],
      [0, TICKS_PER_BAR, 64],
      [TICKS_PER_BAR, TICKS_PER_BAR, 65],
    ]);
    expect(notes.every((n) => n.chord)).toBe(true);
    expect(take.length).toBe(4 * TICKS_PER_BAR);
  });

  it('starts notes that were already sounding at the take start, and closes held notes at the end', () => {
    const base = new LiveTracker();
    base.apply(chord(-1, [57, 60, 64]));
    base.apply({ kind: 'noteOn', id: 'x', slot: 'melody', note: 72, velocity: 0.5, time: -0.5 });
    const take = buildTake(base, [], 0, 2, toTick(0));
    expect(take.parts.chords!.notes.map((n) => [n.tick, n.duration])).toEqual([
      [0, TICKS_PER_BAR],
      [0, TICKS_PER_BAR],
      [0, TICKS_PER_BAR],
    ]);
    expect(take.parts.melody!.notes).toEqual([{ tick: 0, duration: TICKS_PER_BAR, note: 72, velocity: 0.5 }]);
  });

  it('ignores harmony-only chords and loop playback; slotRelease ends everything on the part', () => {
    const events: MusicEvent[] = [
      chord(0, [57, 60, 64], { play: false }),
      { kind: 'noteOn', id: 'a1', slot: 'chords', note: 69, velocity: 0.6, time: 0.5 },
      { kind: 'noteOn', id: 'l1', slot: 'loop:t1', note: 40, velocity: 1, time: 0.5 },
      { kind: 'drum', voice: 'kick', velocity: 1, time: 0.5, slot: 'loop:t2' },
      { kind: 'slotRelease', slot: 'chords', time: 1 },
    ];
    const take = buildTake(new LiveTracker(), events, 0, 2, toTick(0));
    expect(Object.keys(take.parts)).toEqual(['chords']);
    expect(take.parts.chords!.notes).toEqual([{ tick: PPQ, duration: PPQ, note: 69, velocity: 0.6 }]);
  });

  it('records drum hits as General MIDI notes, and only inside the window', () => {
    const events: MusicEvent[] = [
      { kind: 'drum', voice: 'kick', velocity: 1, time: -0.1 },
      { kind: 'drum', voice: 'kick', velocity: 1, time: 0 },
      { kind: 'drum', voice: 'snare', velocity: 0.7, time: 0.5 },
      { kind: 'drum', voice: 'hat', velocity: 0.4, time: 2 },
    ];
    const take = buildTake(new LiveTracker(), events, 0, 2, toTick(0));
    expect(take.parts.drums!.notes.map((n) => [n.tick, n.note, n.velocity])).toEqual([
      [0, 36, 1],
      [PPQ, 38, 0.7],
    ]);
  });

  it('keeps pitch glides relative to the note start', () => {
    const events: MusicEvent[] = [
      { kind: 'noteOn', id: 'g', slot: 'melody', note: 60, velocity: 0.8, time: 0.5 },
      { kind: 'pitch', id: 'g', slot: 'melody', note: 62, glide: 0.06, time: 1 },
      { kind: 'pitch', id: 'g', slot: 'melody', note: 64, glide: 0.06, time: 1.5 },
      { kind: 'noteOff', id: 'g', slot: 'melody', time: 2 },
    ];
    const [n] = buildTake(new LiveTracker(), events, 0, 4, toTick(0)).parts.melody!.notes;
    expect(n).toMatchObject({ tick: PPQ, duration: 3 * PPQ, note: 60 });
    expect(n!.pitch).toEqual([
      { tick: PPQ, note: 62, glide: 0.06 },
      { tick: 2 * PPQ, note: 64, glide: 0.06 },
    ]);
  });

  it('records brightness moves as a thinned automation lane, starting from the value at the take start', () => {
    const base = new LiveTracker();
    base.apply({ kind: 'param', target: 'macro.brightness', value: 0.3, rampMs: 30, time: -1 });
    const moves: MusicEvent[] = Array.from({ length: 40 }, (_, i) => ({
      kind: 'param',
      target: 'macro.brightness',
      value: 0.3 + i * 0.01, // a straight line: thins to its end points
      rampMs: 30,
      time: 0.05 * i,
    }));
    const take = buildTake(base, [chord(0, [57, 60, 64]), ...moves], 0, 2, toTick(0));
    const tp = take.parts.chords!;
    expect(tp.brightness).toBe(0.3);
    expect(tp.automation).toHaveLength(1);
    expect(tp.automation[0]!.points.length).toBeLessThanOrEqual(3);
    expect(tp.automation[0]!.points.at(-1)!.value).toBeCloseTo(0.69);
  });
});

describe('thin', () => {
  it('keeps corners, drops collinear points', () => {
    const pts = [0, 1, 2, 3, 4, 5, 6].map((tick) => ({ tick, v: tick <= 3 ? tick : 6 - tick }));
    expect(thin(pts, (p) => p.v, 0.01).map((p) => p.tick)).toEqual([0, 3, 6]);
  });
});

describe('placeTake', () => {
  const take = (parts: Part[], tick = 0, duration = 100): Take => ({
    length: TICKS_PER_BAR,
    parts: Object.fromEntries(
      parts.map((p) => [
        p,
        { notes: [{ tick, duration, note: 60, velocity: 0.8 }], automation: [], brightness: 1 },
      ]),
    ),
  });
  const project = { ...emptyProject(), bars: 1 };
  const o = { loopLength: TICKS_PER_BAR, offset: 0, mode: 'new' as const, instruments: INSTRUMENTS };

  it('creates one track per part that played, named by part, with the live instrument', () => {
    const r = placeTake(project, take(['chords', 'drums']), o);
    expect(r.project.tracks.map((t) => [t.name, t.part, t.instrument])).toEqual([
      ['Chords', 'chords', 'warmPoly'],
      ['Drums', 'drums', 'drums'],
    ]);
    const again = placeTake(r.project, take(['chords']), o);
    expect(again.project.tracks.map((t) => t.name)).toEqual(['Chords', 'Drums', 'Chords 2']);
    expect(new Set(again.project.tracks.map((t) => t.id)).size).toBe(3);
  });

  it('merges into the same part and instrument in merge mode', () => {
    const r = placeTake(project, take(['chords']), o);
    const m = placeTake(r.project, take(['chords'], 500), { ...o, mode: 'merge' });
    expect(m.merged).toEqual([r.added[0]]);
    expect(m.project.tracks).toHaveLength(1);
    expect(m.project.tracks[0]!.notes.map((n) => n.tick)).toEqual([0, 500]);
  });

  it('wraps an overdub that started mid-loop and caps notes at the loop length', () => {
    const r = placeTake(project, take(['melody'], TICKS_PER_BAR - 100, 5000), { ...o, offset: 1000 });
    const [n] = r.project.tracks[0]!.notes;
    expect(n!.tick).toBe(1000 + TICKS_PER_BAR - 100 - TICKS_PER_BAR);
    expect(n!.duration).toBe(TICKS_PER_BAR);
  });

  it(`never exceeds ${MAX_TRACKS} tracks: merges into a matching part, or reports what was dropped`, () => {
    let p = project;
    for (let i = 0; i < MAX_TRACKS; i++) p = placeTake(p, take(['chords']), o).project;
    expect(p.tracks).toHaveLength(MAX_TRACKS);
    const r = placeTake(p, take(['chords', 'drums']), o);
    expect(r.project.tracks).toHaveLength(MAX_TRACKS);
    expect(r.merged).toHaveLength(1);
    expect(r.dropped).toEqual(['drums']);
  });
});

describe('barsForLength', () => {
  it('rounds to the nearest whole bar, at least one', () => {
    expect(barsForLength(10)).toBe(1);
    expect(barsForLength(TICKS_PER_BAR * 2.4)).toBe(2);
    expect(barsForLength(TICKS_PER_BAR * 2.6)).toBe(3);
  });
});
