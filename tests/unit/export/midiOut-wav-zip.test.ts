import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MidiTranslator } from '../../../src/export/midiTranslate';
import { encodeWav } from '../../../src/export/wav';
import { crc32, makeZip } from '../../../src/export/zip';
import type { MusicEvent } from '../../../src/events/types';
import { diatonicChord } from '../../../src/theory/chords';

const C = diatonicChord({ tonic: 0, mode: 'ionian' }, { degree: 1 });
const bytes = (msgs: Array<{ data: number[] }>) => msgs.map((m) => m.data);

describe('MIDI out translation', () => {
  it('turns voicing changes into note-offs then note-ons (common tones held)', () => {
    const t = new MidiTranslator();
    expect(
      bytes(
        t.translate({ kind: 'chord', slot: 'chords', chord: C, voicing: [60, 64, 67], velocity: 1, time: 0 }),
      ),
    ).toEqual([
      [0x90, 60, 127],
      [0x90, 64, 127],
      [0x90, 67, 127],
    ]);
    expect(
      bytes(
        t.translate({
          kind: 'chord',
          slot: 'chords',
          chord: C,
          voicing: [60, 65, 69],
          velocity: 0.5,
          time: 1,
        }),
      ),
    ).toEqual([
      [0x80, 64, 0],
      [0x80, 67, 0],
      [0x90, 65, 64],
      [0x90, 69, 64],
    ]);
    expect(
      bytes(t.translate({ kind: 'chord', slot: 'chords', chord: null, voicing: [], velocity: 0, time: 2 })),
    ).toEqual([
      [0x80, 60, 0],
      [0x80, 65, 0],
      [0x80, 69, 0],
    ]);
  });

  it('ignores harmony-only chords; sends drums on channel 10 with their own note-off', () => {
    const t = new MidiTranslator();
    expect(
      t.translate({
        kind: 'chord',
        slot: 'chords',
        chord: C,
        voicing: [60],
        velocity: 1,
        time: 0,
        play: false,
      }),
    ).toEqual([]);
    const d = t.translate({ kind: 'drum', voice: 'snare', velocity: 1, time: 1 });
    expect(d.map((m) => [m.data, m.time])).toEqual([
      [[0x99, 38, 127], 1],
      [[0x89, 38, 0], 1.06],
    ]);
  });

  it('routes live parts and loop tracks to their own channels (split) or one channel (single)', () => {
    const t = new MidiTranslator();
    t.setTracks(['t1', 't2']);
    let n = 0;
    const on = (slot: Extract<MusicEvent, { kind: 'noteOn' }>['slot']) =>
      t.translate({ kind: 'noteOn', id: `n${n++}`, slot, note: 60, velocity: 1, time: 0 }).at(-1)!.data[0]! &
      15;
    expect([on('melody'), on('bass'), on('loop:t1'), on('loop:t2')]).toEqual([1, 2, 3, 4]);
    expect(
      t.translate({ kind: 'noteOn', id: 'y', slot: 'loop:unknown', note: 60, velocity: 1, time: 0 }),
    ).toEqual([]);
    t.setLayout({ kind: 'single', channel: 5 });
    expect(on('loop:t2')).toBe(5);
  });

  it('sends glides as pitch bend (setting the bend range once) and brightness as CC 74', () => {
    const t = new MidiTranslator();
    t.translate({ kind: 'noteOn', id: 'g', slot: 'melody', note: 60, velocity: 1, time: 0 });
    const first = bytes(
      t.translate({ kind: 'pitch', id: 'g', slot: 'melody', note: 66, glide: 0.06, time: 0.1 }),
    );
    expect(first.slice(0, 6).map((m) => m[1])).toEqual([101, 100, 6, 38, 101, 100]);
    expect(first.at(-1)).toEqual([0xe1, bendOf(6) & 0x7f, bendOf(6) >> 7]);
    expect(
      bytes(t.translate({ kind: 'pitch', id: 'g', slot: 'melody', note: 60, glide: 0.06, time: 0.2 })),
    ).toHaveLength(1);
    expect(
      bytes(t.translate({ kind: 'param', target: 'macro.brightness', value: 1, rampMs: 20, time: 0 })),
    ).toEqual([
      [0xb0, 74, 127],
      [0xb1, 74, 127],
    ]);
  });

  it('panic turns off exactly what is on', () => {
    const t = new MidiTranslator();
    t.translate({ kind: 'chord', slot: 'chords', chord: C, voicing: [60, 64], velocity: 1, time: 0 });
    t.translate({ kind: 'noteOn', id: 'm', slot: 'melody', note: 72, velocity: 1, time: 0 });
    expect(bytes(t.panic(1)).sort()).toEqual(
      [
        [0x80, 60, 0],
        [0x80, 64, 0],
        [0x81, 72, 0],
        [0xb0, 123, 0],
        [0xb1, 123, 0],
      ].sort(),
    );
    expect(t.panic(2)).toEqual([]);
  });
});

function bendOf(semitones: number) {
  return 8192 + Math.round((semitones / 12) * 8191);
}

describe('WAV', () => {
  it('writes a valid 24-bit PCM header and exact samples', () => {
    const l = new Float32Array([0, 0.5, -1, 1]);
    const r = new Float32Array([1, -0.5, 0, 2]); // 2 clips to full scale; scaling is symmetric
    const w = encodeWav([l, r], 48000, 24);
    const v = new DataView(w.buffer);
    expect(String.fromCharCode(...w.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...w.slice(8, 16))).toBe('WAVEfmt ');
    expect([v.getUint16(22, true), v.getUint32(24, true), v.getUint16(34, true)]).toEqual([2, 48000, 24]);
    expect(v.getUint32(40, true)).toBe(4 * 2 * 3);
    const s24 = (i: number) =>
      v.getUint8(44 + i * 3) | (v.getUint8(45 + i * 3) << 8) | (v.getInt8(46 + i * 3) << 16);
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(s24)).toEqual([
      0, 8388607, 4194304, -4194303, -8388607, 0, 8388607, 8388607,
    ]);
  });

  it('16-bit output is dithered by at most ±1 LSB and reproducible', () => {
    const x = new Float32Array(1000).fill(0.25);
    const a = encodeWav([x], 44100, 16);
    expect(a).toEqual(encodeWav([x], 44100, 16));
    const v = new DataView(a.buffer);
    for (let i = 0; i < 1000; i++)
      expect(Math.abs(v.getInt16(44 + i * 2, true) - 8192)).toBeLessThanOrEqual(1);
  });
});

describe('ZIP', () => {
  it('crc32 matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('produces an archive the system unzip accepts, with the files intact', () => {
    const files = [
      { name: 'mix.wav', data: new Uint8Array([1, 2, 3, 4, 5]) },
      { name: 'stems/Chords.wav', data: new TextEncoder().encode('hello stems') },
    ];
    const dir = mkdtempSync(join(tmpdir(), 'hw-zip-'));
    const zip = join(dir, 'x.zip');
    writeFileSync(zip, makeZip(files, new Date(2026, 9, 18, 14, 30)));
    let unzip: string;
    try {
      unzip = execFileSync('unzip', ['-t', zip]).toString();
    } catch {
      return; // no unzip binary on this machine
    }
    expect(unzip).toMatch(/No errors detected/);
    execFileSync('unzip', ['-q', '-o', zip, '-d', dir]);
    expect([...readFileSync(join(dir, 'mix.wav'))]).toEqual([1, 2, 3, 4, 5]);
    expect(readFileSync(join(dir, 'stems/Chords.wav'), 'utf8')).toBe('hello stems');
  });
});
