import { describe, expect, it } from 'vitest';
import type { MusicEvent } from '../../../src/events/types';
import { arpEvents, arpSequence, DEFAULT_ARP } from '../../../src/performance/arp';
import { bassEvents } from '../../../src/performance/bass';
import { DEFAULT_DRUMS, drumEvents, nextBar } from '../../../src/performance/drums/drums';
import { GENRES, PATTERNS } from '../../../src/performance/drums/patterns';
import {
  DEFAULT_STRUM,
  initialStrumState,
  strumAll,
  strumCrossings,
  strumStep,
  strumVoicing,
} from '../../../src/performance/strum';
import type { Transport } from '../../../src/performance/transport';
import { diatonicChord } from '../../../src/theory/chords';

const T: Transport = { bpm: 120, origin: 0 }; // beat = 0.5 s, bar = 2 s
const C = diatonicChord({ tonic: 0, mode: 'ionian' }, { degree: 1 });
const Am7 = diatonicChord({ tonic: 0, mode: 'ionian' }, { degree: 6, extension: 'seventh' });

/** Render [0, end) in random-sized windows: must equal rendering it in one go. */
function windowed(gen: (a: number, b: number) => MusicEvent[], end: number) {
  const out: MusicEvent[] = [];
  let t = 0;
  let k = 1;
  while (t < end) {
    const next = Math.min(end, t + 0.013 * ((k++ * 7) % 11) + 0.004);
    out.push(...gen(t, next));
    t = next;
  }
  return out;
}
const key = (e: MusicEvent) => JSON.stringify(e);

describe('arpeggiator', () => {
  it('builds up / down / upDown sequences over octaves', () => {
    expect(arpSequence([64, 60, 67], 'up', 2)).toEqual([60, 64, 67, 72, 76, 79]);
    expect(arpSequence([60, 64, 67], 'down', 1)).toEqual([67, 64, 60]);
    expect(arpSequence([60, 64, 67], 'upDown', 1)).toEqual([60, 64, 67, 64]);
    expect(arpSequence([67, 60, 64], 'played', 1)).toEqual([67, 60, 64]);
  });

  it('places notes exactly on the grid with gate-length notes', () => {
    const ev = arpEvents(
      { ...DEFAULT_ARP, enabled: true, rate: '1/8', octaves: 1, gate: 0.5 },
      [60, 64, 67],
      T,
      0,
      1,
    );
    const ons = ev.filter((e) => e.kind === 'noteOn') as Extract<MusicEvent, { kind: 'noteOn' }>[];
    expect(ons.map((e) => e.time)).toEqual([0, 0.25, 0.5, 0.75]);
    expect(ons.map((e) => e.note)).toEqual([60, 64, 67, 60]);
    const off = ev.find((e) => e.kind === 'noteOff' && e.id === ons[0]!.id)!;
    expect(off.time).toBeCloseTo(0.125);
  });

  it('is window-independent: no gaps or doubles across scheduler windows', () => {
    const arp = { ...DEFAULT_ARP, enabled: true, rate: '1/16T' as const, mode: 'random' as const };
    const one = arpEvents(arp, [60, 64, 67], T, 0, 4).map(key);
    const many = windowed((a, b) => arpEvents(arp, [60, 64, 67], T, a, b), 4).map(key);
    expect(many).toEqual(one);
  });

  it('is silent when disabled or with no chord', () => {
    expect(arpEvents(DEFAULT_ARP, [60], T, 0, 2)).toEqual([]);
    expect(arpEvents({ ...DEFAULT_ARP, enabled: true }, [], T, 0, 2)).toEqual([]);
  });
});

describe('drum machine', () => {
  for (const genre of GENRES) {
    it(`${genre}: every pattern string is 16 steps`, () => {
      const p = PATTERNS[genre];
      for (const bar of [...p.bars, p.fill]) for (const s of Object.values(bar)) expect(s).toHaveLength(16);
    });
  }

  it('house is four on the floor', () => {
    const ev = drumEvents({ ...DEFAULT_DRUMS, enabled: true, genre: 'house', swing: 0.5 }, T, 0, 2);
    const kicks = ev.filter((e) => e.kind === 'drum' && e.voice === 'kick').map((e) => e.time);
    expect(kicks).toEqual([0, 0.5, 1, 1.5]);
  });

  it('swing delays only the off sixteenths', () => {
    const ev = drumEvents({ ...DEFAULT_DRUMS, enabled: true, genre: 'trap', swing: 0.66 }, T, 0, 2);
    const hats = ev.filter((e) => e.kind === 'drum' && e.voice === 'hat').map((e) => e.time);
    expect(hats[0]).toBeCloseTo(0);
    const sixteenth = 0.125;
    const offs = hats.filter((h) => Math.abs(((h / sixteenth) % 2) - 1) < 0.5);
    for (const h of offs) expect((h / sixteenth) % 1).toBeCloseTo(0.32, 1);
  });

  it('is window-independent (with swing)', () => {
    const d = { ...DEFAULT_DRUMS, enabled: true, genre: 'lofi' as const };
    expect(windowed((a, b) => drumEvents(d, T, a, b), 8).map(key)).toEqual(drumEvents(d, T, 0, 8).map(key));
  });

  it('fills and drops land on the next bar, then a crash brings it back', () => {
    const bar = nextBar(T, 2.7); // in bar 1 → bar 2 (4.0–6.0 s)
    expect(bar).toBe(2);
    const fill = drumEvents({ ...DEFAULT_DRUMS, enabled: true, genre: 'synthwave', fillBar: bar }, T, 4, 6);
    expect(fill.some((e) => e.kind === 'drum' && e.voice === 'tom')).toBe(true);
    const drop = drumEvents({ ...DEFAULT_DRUMS, enabled: true, genre: 'house', dropBar: bar }, T, 4, 8);
    const kicksInDrop = drop.filter((e) => e.kind === 'drum' && e.voice === 'kick' && e.time < 6);
    expect(kicksInDrop).toHaveLength(0);
    expect(drop.find((e) => e.kind === 'drum' && e.voice === 'crash')!.time).toBeCloseTo(6);
  });
});

describe('auto-bass', () => {
  it('root–fifth plays root and fifth on quarters', () => {
    const ev = bassEvents('rootFifth', C, 36, T, 0, 2).filter((e) => e.kind === 'noteOn') as Extract<
      MusicEvent,
      { kind: 'noteOn' }
    >[];
    expect(ev.map((e) => [e.time, e.note])).toEqual([
      [0, 36],
      [0.5, 43],
      [1, 36],
      [1.5, 43],
    ]);
  });

  it('walking bass uses chord tones (minor third on a minor chord)', () => {
    const ev = bassEvents('walk', Am7, 45, T, 0, 2).filter((e) => e.kind === 'noteOn') as Extract<
      MusicEvent,
      { kind: 'noteOn' }
    >[];
    expect(ev.map((e) => e.note - 45)).toEqual([0, 3, 7, 10]);
  });

  it('respects muted (dropped) bars and sustain mode', () => {
    expect(bassEvents('pulse', C, 36, T, 0, 4, (b) => b === 0).every((e) => e.time >= 2)).toBe(true);
    expect(bassEvents('sustain', C, 36, T, 0, 4)).toEqual([]);
  });

  it('is window-independent', () => {
    expect(windowed((a, b) => bassEvents('octaves', C, 36, T, a, b), 6).map(key)).toEqual(
      bassEvents('octaves', C, 36, T, 0, 6).map(key),
    );
  });
});

describe('strum', () => {
  const settings = { ...DEFAULT_STRUM, enabled: true };

  it('builds a guitar-like voicing: ascending chord tones, spaced, starting near E2', () => {
    for (const chord of [C, Am7]) {
      const v = strumVoicing(chord, 6);
      expect(v).toHaveLength(6);
      expect(v[0]).toBeGreaterThanOrEqual(40);
      expect(v[0]).toBeLessThanOrEqual(47);
      for (let i = 0; i < v.length; i++) {
        expect(chord.pitchClasses).toContain(v[i]! % 12);
        if (i) expect(v[i]! - v[i - 1]!).toBeGreaterThanOrEqual(3);
      }
    }
    expect(strumVoicing(Am7, 6)[0]).toBe(45); // A2: root is within a fourth of E2
  });

  it('crossings come out in the order the hand passed the strings', () => {
    const down = strumCrossings(0.3, 0.9, settings).map((c) => c.string);
    const up = strumCrossings(0.9, 0.3, settings).map((c) => c.string);
    expect(down).toEqual([0, 1, 2, 3, 4, 5]);
    expect(up).toEqual([5, 4, 3, 2, 1, 0]);
    expect(strumCrossings(0.3, 0.32, settings)).toEqual([]);
  });

  it('spreads crossings over the frame interval, faster hand = louder', () => {
    let st = initialStrumState();
    st = strumStep(st, 0.3, 1000, 5, C, settings).state;
    const slow = strumStep(st, 0.9, 1100, 5, C, settings).events;
    const fast = strumStep(st, 0.9, 1020, 5, C, settings).events;
    const ons = slow.filter((e) => e.kind === 'noteOn') as Extract<MusicEvent, { kind: 'noteOn' }>[];
    expect(ons).toHaveLength(6);
    for (let i = 1; i < ons.length; i++) expect(ons[i]!.time).toBeGreaterThan(ons[i - 1]!.time);
    expect(ons.at(-1)!.time - ons[0]!.time).toBeLessThanOrEqual(0.06);
    const fastVel = (fast.find((e) => e.kind === 'noteOn') as { velocity: number }).velocity;
    expect(fastVel).toBeGreaterThan(ons[0]!.velocity);
  });

  it('re-plucking a string stops its previous note; keyboard strum hits every string', () => {
    let st = initialStrumState();
    st = strumStep(st, 0.3, 0, 0, C, settings).state;
    st = strumStep(st, 0.9, 30, 0, C, settings).state;
    const back = strumStep(st, 0.3, 60, 0.03, C, settings).events;
    expect(back.filter((e) => e.kind === 'noteOff')).toHaveLength(6);
    const all = strumAll(initialStrumState(), 1, Am7, settings, 'up').events.filter(
      (e) => e.kind === 'noteOn',
    );
    expect(all).toHaveLength(6);
  });
});
