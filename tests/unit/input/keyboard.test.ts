import { describe, expect, it } from 'vitest';
import {
  handleKey,
  pitchForScaleIndex,
  type KeyboardContext,
  type KeyInput,
} from '../../../src/input/keyboard';
import type { Key } from '../../../src/theory/modes';
import { conduct, DEFAULT_CONDUCTOR, initialConductorState } from '../../../src/performance/conductor';
import type { MusicEvent } from '../../../src/events/types';

const ctx: KeyboardContext = {
  key: { tonic: 0, mode: 'ionian' },
  melody: { low: 60, high: 84 },
  octave: 0,
  inversionBias: 0,
};
const down = (code: string, shiftKey = false): KeyInput => ({ code, shiftKey, repeat: false, type: 'down' });
const up = (code: string): KeyInput => ({ code, shiftKey: false, repeat: false, type: 'up' });

function play(inputs: KeyInput[]) {
  let s = initialConductorState();
  let c = ctx;
  const held = new Set<string>();
  const all: MusicEvent[] = [];
  for (const i of inputs) {
    const r = handleKey(i, c, held);
    if (!r) continue;
    c = r.context;
    const out = conduct(s, { actions: r.actions, params: r.params }, 0, {
      ...DEFAULT_CONDUCTOR,
      melody: { ...ctx.melody, snap: 1 },
    });
    s = out.state;
    all.push(...out.events);
  }
  return all;
}

describe('keyboard fallback', () => {
  it('number keys play degrees, shift borrows, letters shape', () => {
    const ev = play([down('Digit1'), down('Digit4', true), down('Digit5'), down('KeyW')]);
    const names = ev
      .filter((e) => e.kind === 'chord' && e.slot === 'chords')
      .map((e) => (e as { chord: { name: string } }).chord.name);
    expect(names).toEqual(['C', 'Fm', 'G', 'G7']);
  });

  it('space releases, and unknown keys are left to the browser', () => {
    const ev = play([down('Digit2'), down('Space')]);
    expect(ev.filter((e) => e.kind === 'chord' && e.slot === 'chords').at(-1)).toMatchObject({ chord: null });
    expect(handleKey(down('KeyK'), ctx, new Set())).toBeNull();
    expect(handleKey(down('Tab'), ctx, new Set())).toBeNull();
  });

  it('melody keys play scale degrees and legato between held keys', () => {
    const ev = play([down('KeyZ'), down('KeyC'), up('KeyC'), up('KeyZ')]);
    expect(ev.map((e) => e.kind)).toEqual(['noteOn', 'pitch', 'pitch', 'noteOff']);
    expect((ev[0] as { note: number }).note).toBe(60);
    expect((ev[1] as { note: number }).note).toBe(64);
    expect((ev[2] as { note: number }).note).toBe(60);
  });

  it('maps scale indices onto the melody range in any mode', () => {
    const dorian: Key = { tonic: 2, mode: 'dorian' };
    const p = pitchForScaleIndex(dorian, { low: 60, high: 84 }, 0);
    expect(60 + p * 24).toBe(60); // C is in D dorian
    expect(60 + pitchForScaleIndex(dorian, { low: 60, high: 84 }, 1) * 24).toBe(62);
  });

  it('groove keys map to groove actions', () => {
    const acts = ['KeyA', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyT', 'Equal'].map(
      (c) => handleKey(down(c), ctx, new Set())!.actions[0]!.type,
    );
    expect(acts).toEqual([
      'arp.toggle',
      'drums.toggle',
      'drums.fill',
      'drums.drop',
      'drums.nextGenre',
      'bass.nextPattern',
      'tempo.tap',
      'tempo.nudge',
    ]);
    expect(handleKey(down('KeyS', true), ctx, new Set())!.actions[0]).toEqual({
      type: 'strum.strum',
      direction: 'up',
    });
  });

  it('octave and inversion keys are bounded', () => {
    let c = ctx;
    for (let i = 0; i < 4; i++) c = handleKey(down('ArrowUp'), c, new Set())!.context;
    expect(c.octave).toBe(1);
    for (let i = 0; i < 4; i++) c = handleKey(down('ArrowLeft'), c, new Set())!.context;
    expect(c.inversionBias).toBe(-1);
  });
});
