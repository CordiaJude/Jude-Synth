import { describe, expect, it } from 'vitest';
import type { MusicEvent } from '../../../src/events/types';
import {
  audibleTracks,
  emptyProject,
  loopTicks,
  PPQ,
  TICKS_PER_BAR,
  type LoopProject,
} from '../../../src/looper/model';
import {
  chordAt,
  chordChanges,
  compareEvents,
  loopEvents,
  resumeEvents,
  type LoopClock,
} from '../../../src/looper/player';
import { buildTake, isLiveEvent, LiveTracker, placeTake } from '../../../src/looper/recorder';
import { scriptedPerformance } from '../../../src/looper/testing/performance';
import { beatAt, setTempo, timeAtBeat } from '../../../src/performance/transport';

const INSTRUMENTS = { chords: 'warmPoly', melody: 'fmKeys', bass: 'subBass', drums: 'drums' } as const;

function recorded(opts: Parameters<typeof scriptedPerformance>[0] = {}) {
  const perf = scriptedPerformance(opts);
  const startBeat = beatAt(perf.transport, perf.start);
  const take = buildTake(new LiveTracker(), perf.events, perf.start, perf.end, (t) =>
    Math.round((beatAt(perf.transport, t) - startBeat) * PPQ),
  );
  const project: LoopProject = { ...emptyProject(perf.transport.bpm, perf.key), bars: perf.bars };
  const placed = placeTake(project, take, {
    loopLength: loopTicks(project),
    offset: 0,
    mode: 'new',
    instruments: INSTRUMENTS,
  });
  return { perf, project: placed.project, clock: { transport: perf.transport, startBeat } as LoopClock };
}

/** What an event does, without ids or slots (live and loop use different ones). */
function signature(e: MusicEvent): string {
  const t = e.time.toFixed(9);
  switch (e.kind) {
    case 'chord':
      return `${t} chord ${e.voicing.join(',')} v${e.velocity}`;
    case 'noteOn':
      return `${t} on ${e.note} v${e.velocity}`;
    case 'noteOff':
      return `${t} off`;
    case 'pitch':
      return `${t} pitch ${e.note}`;
    case 'drum':
      return `${t} drum ${e.voice} v${e.velocity}`;
    default:
      return `${t} ${e.kind}`;
  }
}
const partOfEvent = (e: MusicEvent, p: LoopProject): string => {
  if (e.kind === 'drum') return 'drums';
  const slot = 'slot' in e ? e.slot : undefined;
  if (slot?.startsWith('loop:')) return p.tracks.find((t) => `loop:${t.id}` === slot)!.part;
  return slot as string;
};

describe('loop playback', () => {
  it('reproduces the recorded performance event for event (chords, notes, drums, glides)', () => {
    const { perf, project, clock } = recorded({ glide: true });
    const played = loopEvents(project, clock, 0, perf.end + 1, {
      audible: audibleTracks(project),
      cycles: 1,
    });
    // The live side, as the engine hears it: harmony-only chords and empty releases don't sound.
    const live = perf.events
      .filter(isLiveEvent)
      .filter((e) => !(e.kind === 'chord' && e.play === false))
      .sort(compareEvents);
    for (const part of ['chords', 'melody', 'bass', 'drums']) {
      const a = live.filter((e) => partOfEvent(e, project) === part).map(signature);
      const b = played.filter((e) => partOfEvent(e, project) === part).map(signature);
      expect(b, part).toEqual(a);
    }
    expect(project.tracks.map((t) => t.part).sort()).toEqual(['bass', 'chords', 'drums', 'melody']);
  });

  it('is window-independent: any slicing of time gives the same events', () => {
    const { perf, project, clock } = recorded();
    const audible = audibleTracks(project);
    const end = perf.end + timeAtBeat(perf.transport, 16) - perf.start; // two cycles
    const whole = loopEvents(project, clock, 0, end, { audible }).map(signature);
    const sliced: string[] = [];
    let t = 0;
    let k = 1;
    while (t < end) {
      const next = Math.min(end, t + 0.011 * ((k++ * 7) % 13) + 0.003);
      sliced.push(...loopEvents(project, clock, t, next, { audible }).map(signature));
      t = next;
    }
    expect(sliced).toEqual(whole);
  });

  it('repeats every cycle, shifted by exactly one loop length', () => {
    const { perf, project, clock } = recorded({ melody: false });
    const audible = audibleTracks(project);
    const loopSec = perf.end - perf.start;
    const c0 = loopEvents(project, clock, perf.start + 0.001, perf.end - 0.001, { audible });
    const c1 = loopEvents(project, clock, perf.end + 0.001, perf.end + loopSec - 0.001, { audible });
    expect(c1.map((e) => (e.time - loopSec).toFixed(6))).toEqual(c0.map((e) => e.time.toFixed(6)));
  });

  it('plays only the audible tracks (mute / solo)', () => {
    const { perf, project, clock } = recorded();
    const drums = project.tracks.find((t) => t.part === 'drums')!;
    const solo = {
      ...project,
      tracks: project.tracks.map((t) => (t.id === drums.id ? { ...t, solo: true } : t)),
    };
    const ev = loopEvents(solo, clock, 0, perf.end, { audible: audibleTracks(solo) });
    expect(ev.length).toBeGreaterThan(20);
    expect(ev.every((e) => e.kind === 'drum')).toBe(true);
  });

  it('follows tempo changes without losing its place (positions are in beats)', () => {
    const { project, clock } = recorded({ melody: false });
    const audible = audibleTracks(project);
    const changeAt = timeAtBeat(clock.transport, clock.startBeat + 6);
    const faster = setTempo(clock.transport, 150, changeAt);
    const ev = loopEvents(project, { ...clock, transport: faster }, changeAt, changeAt + 10, { audible });
    const onsets = ev.filter((e) => e.kind === 'noteOn' || e.kind === 'drum' || e.kind === 'chord');
    expect(onsets.length).toBeGreaterThan(20);
    const beats = onsets.map((e) => beatAt(faster, e.time) - clock.startBeat);
    // Everything lands on the sixteenth grid of the same beat numbering.
    for (const b of beats) expect(Math.abs(b * 4 - Math.round(b * 4))).toBeLessThan(1e-6);
    expect(Math.min(...beats)).toBeGreaterThanOrEqual(6);
  });
});

describe('chord tracks', () => {
  const p: LoopProject = {
    ...emptyProject(),
    bars: 1,
    tracks: [
      {
        id: 't1',
        name: 'Chords',
        part: 'chords',
        instrument: 'warmPoly',
        brightness: 1,
        mute: false,
        solo: false,
        gainDb: 0,
        automation: [],
        notes: [
          // Held all the way round (wraps), plus a change in the middle.
          { tick: 0, duration: TICKS_PER_BAR, note: 57, velocity: 0.8, chord: true },
          { tick: 0, duration: 960, note: 60, velocity: 0.8, chord: true },
          { tick: 960, duration: 960, note: 62, velocity: 0.6, chord: true, transition: 'crossfade' },
        ],
      },
    ],
  };
  const clock: LoopClock = { transport: { bpm: 120, origin: 0 }, startBeat: 0 };
  const L = loopTicks(p);

  it('lists the changes of the held set, cyclically', () => {
    expect(chordChanges(p.tracks[0]!.notes, L)).toEqual([
      { tick: 0, voicing: [57, 60], velocity: 0.8, transition: undefined },
      { tick: 960, voicing: [57, 62], velocity: 0.6, transition: 'crossfade' },
    ]);
    expect(chordAt(p.tracks[0]!.notes, 1500, L)).toEqual([57, 62]);
  });

  it('resumes the held chord when playback starts mid-loop', () => {
    const t = timeAtBeat(clock.transport, 3);
    expect(resumeEvents(p, ['t1'], clock, t)).toMatchObject([{ kind: 'chord', voicing: [57, 62], time: t }]);
  });

  it('finite playback releases the chord at the end', () => {
    const ev = loopEvents(p, clock, 0, 10, { audible: new Set(['t1']), cycles: 1 });
    expect(ev.at(-1)).toMatchObject({ kind: 'chord', voicing: [], time: 2 });
  });
});
