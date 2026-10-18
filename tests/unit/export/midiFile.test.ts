// Round trip: record a performance → loop project → .mid → parse it back with an independent reader
// (@tonejs/midi) → it must match what was recorded.

import ToneMidi from '@tonejs/midi';
import { describe, expect, it } from 'vitest';
import { APP_NAME } from '../../../src/config/app';
import {
  bendValue,
  GM_PROGRAM,
  keySignature,
  noteSegments,
  toMidiFile,
  trackChannels,
} from '../../../src/export/midiFile';
import { emptyProject, loopTicks, PPQ, TICKS_PER_BAR, type LoopProject } from '../../../src/looper/model';
import { buildTake, LiveTracker, placeTake } from '../../../src/looper/recorder';
import { scriptedPerformance } from '../../../src/looper/testing/performance';
import { beatAt } from '../../../src/performance/transport';

const { Midi } = ToneMidi as unknown as typeof import('@tonejs/midi');

function recordedProject(): LoopProject {
  const perf = scriptedPerformance({ glide: true });
  const startBeat = beatAt(perf.transport, perf.start);
  const take = buildTake(new LiveTracker(), perf.events, perf.start, perf.end, (t) =>
    Math.round((beatAt(perf.transport, t) - startBeat) * PPQ),
  );
  const p: LoopProject = { ...emptyProject(perf.transport.bpm, perf.key), bars: perf.bars };
  return placeTake(p, take, {
    loopLength: loopTicks(p),
    offset: 0,
    mode: 'new',
    instruments: { chords: 'warmPoly', melody: 'thereminLead', bass: 'subBass', drums: 'drums' },
  }).project;
}

describe('.mid export', () => {
  const project = recordedProject();
  const midi = new Midi(toMidiFile(project));

  it('writes a type-1 file with the tempo, time and key signature, one MIDI track per loop track', () => {
    expect(midi.header.ppq).toBe(PPQ);
    expect(midi.header.tempos[0]!.bpm).toBeCloseTo(100, 3);
    expect(midi.header.timeSignatures[0]!.timeSignature).toEqual([4, 4]);
    // A minor: no sharps or flats, minor.
    expect(midi.header.keySignatures[0]).toMatchObject({ key: 'C', scale: 'minor' });
    // (This reader folds the tempo track into the header.)
    expect(midi.header.name).toBe(`${APP_NAME} loop`);
    expect(midi.tracks.map((t) => t.name)).toEqual(project.tracks.map((t) => t.name));
  });

  it('every recorded note comes back with its tick, length, pitch and velocity', () => {
    const channels = trackChannels(project.tracks);
    project.tracks.forEach((t, i) => {
      const mt = midi.tracks[i]!;
      expect(mt.channel, t.name).toBe(channels.get(t.id));
      if (t.part !== 'drums')
        expect(mt.instrument.number).toBe(GM_PROGRAM[t.instrument as keyof typeof GM_PROGRAM]);
      const expected = t.notes
        .map((n) => [n.tick, n.duration, Math.round(n.note), Math.round(n.velocity * 127)])
        .sort((a, b) => a[0]! - b[0]! || a[2]! - b[2]!);
      const got = mt.notes
        .map((n) => [n.ticks, n.durationTicks, n.midi, Math.round(n.velocity * 127)])
        .sort((a, b) => a[0]! - b[0]! || a[2]! - b[2]!);
      expect(got, t.name).toEqual(expected);
    });
    expect(midi.tracks.find((t) => t.channel === 9)!.notes.length).toBeGreaterThan(30);
  });

  it('writes theremin glides as pitch bends (±12 semitone range set by RPN)', () => {
    const melody = midi.tracks[project.tracks.findIndex((t) => t.part === 'melody')]!;
    const rpn = melody.controlChanges[6]?.[0];
    expect(Math.round((rpn?.value ?? 0) * 127)).toBe(12);
    const bends = melody.pitchBends.map((b) => +(b.value * 12).toFixed(2));
    expect(bends).toContain(3); // the glide reached +3 semitones over its base note
    expect(Math.max(...bends)).toBeLessThanOrEqual(3.01);
  });

  it('repeats the loop when asked, and the file ends at the loop end', () => {
    const twice = new Midi(toMidiFile(project, { repeats: 2 }));
    const drums = (m: InstanceType<typeof Midi>) => m.tracks.find((t) => t.channel === 9)!.notes.length;
    expect(drums(twice)).toBe(2 * drums(midi));
    expect(twice.durationTicks).toBeLessThanOrEqual(2 * loopTicks(project));
  });

  it('exports what you hear: muted tracks are left out unless asked', () => {
    const muted = { ...project, tracks: project.tracks.map((t, i) => (i === 0 ? { ...t, mute: true } : t)) };
    expect(new Midi(toMidiFile(muted)).tracks).toHaveLength(project.tracks.length - 1);
    expect(new Midi(toMidiFile(muted, { includeMuted: true })).tracks).toHaveLength(project.tracks.length);
  });
});

describe('MIDI helpers', () => {
  it('splits a note that wraps past the loop end into two segments', () => {
    expect(
      noteSegments({ tick: TICKS_PER_BAR - 100, duration: 300, note: 60, velocity: 1 }, TICKS_PER_BAR),
    ).toEqual([
      { tick: TICKS_PER_BAR - 100, duration: 100, from: 0 },
      { tick: 0, duration: 200, from: 100 },
    ]);
  });

  it('assigns drums to channel 10 and skips it for melodic tracks', () => {
    const tracks = Array.from(
      { length: 11 },
      (_, i) => ({ id: `t${i}`, part: i === 3 ? 'drums' : 'chords' }) as never,
    );
    const ch = trackChannels(tracks);
    expect(ch.get('t3')).toBe(9);
    expect([...ch.values()].filter((c) => c === 9)).toHaveLength(1);
  });

  it('key signatures: relative major for modes, minor for aeolian', () => {
    expect(keySignature({ tonic: 9, mode: 'aeolian' })).toEqual({ sf: 0, minor: true });
    expect(keySignature({ tonic: 2, mode: 'dorian' })).toEqual({ sf: 0, minor: false });
    expect(keySignature({ tonic: 7, mode: 'ionian' })).toEqual({ sf: 1, minor: false });
    expect(keySignature({ tonic: 5, mode: 'ionian' })).toEqual({ sf: -1, minor: false });
    expect(keySignature({ tonic: 3, mode: 'ionian' })).toEqual({ sf: -3, minor: false });
  });

  it('pitch bend values: centre, ends, clamped', () => {
    expect(bendValue(0)).toBe(8192);
    expect(bendValue(12)).toBe(16383);
    expect(bendValue(-12)).toBe(1);
    expect(bendValue(40)).toBe(16383);
  });
});
