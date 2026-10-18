import { describe, expect, it } from 'vitest';
import type { MusicEvent } from '../../../src/events/types';
import {
  grooveAction,
  grooveHarmony,
  grooveParam,
  grooveWindow,
  initialGroove,
  type GrooveState,
} from '../../../src/performance/groove';
import { diatonicChord } from '../../../src/theory/chords';
import { beatAt } from '../../../src/performance/transport';

const C = diatonicChord({ tonic: 0, mode: 'ionian' }, { degree: 1 });
const chordEv = (play?: boolean): MusicEvent => ({
  kind: 'chord',
  slot: 'chords',
  chord: C,
  voicing: [60, 64, 67],
  velocity: 0.8,
  time: 1,
  play,
});
const bassEv: MusicEvent = { kind: 'chord', slot: 'bass', chord: C, voicing: [36], velocity: 0.8, time: 1 };

function withChord(g: GrooveState = initialGroove()): GrooveState {
  g = grooveHarmony(g, chordEv()).state;
  return grooveHarmony(g, bassEv).state;
}

describe('groove', () => {
  it('the pad plays chords until the arp takes over, and gets them back after', () => {
    let g = withChord();
    expect(grooveHarmony(g, chordEv()).event).toMatchObject({ play: true });
    const on = grooveAction(g, { type: 'arp.toggle' }, 2);
    expect(on.events).toEqual([{ kind: 'slotRelease', slot: 'chords', time: 2 }]);
    g = on.state;
    expect(grooveHarmony(g, chordEv()).event).toMatchObject({ play: false });
    const ev = grooveWindow(g, 2, 3);
    expect(ev.filter((e) => e.kind === 'noteOn' && e.slot === 'chords').length).toBeGreaterThan(5);
    const off = grooveAction(g, { type: 'arp.toggle' }, 3);
    expect(off.events[0]).toMatchObject({ kind: 'chord', play: true, voicing: [60, 64, 67] });
  });

  it('arp rate and gate follow continuous controls', () => {
    let g = grooveAction(withChord(), { type: 'arp.toggle' }, 0).state;
    g = grooveParam(g, 'arp.rate', 0, 0, 0).state;
    expect(g.arp.rate).toBe('1/4');
    g = grooveParam(g, 'arp.rate', 0.99, 0, 0).state;
    expect(g.arp.rate).toBe('1/32');
    g = grooveParam(g, 'arp.gate', 0, 0, 0).state;
    expect(g.arp.gate).toBeCloseTo(0.08);
  });

  it('a bass pattern replaces the sustained bass, and dropping a bar mutes it', () => {
    let g = withChord();
    const r = grooveAction(g, { type: 'bass.nextPattern' }, 0);
    expect(r.events).toEqual([{ kind: 'slotRelease', slot: 'bass', time: 0 }]);
    g = r.state;
    expect(g.bassPattern).toBe('pulse');
    expect(grooveHarmony(g, bassEv).event).toMatchObject({ play: false });
    g = grooveAction(g, { type: 'drums.toggle' }, 0).state;
    g = grooveAction(g, { type: 'drums.drop' }, 0.1).state; // next bar = 1
    const barSeconds = 4 * (60 / g.transport.bpm);
    const bassInDrop = grooveWindow(g, barSeconds, 2 * barSeconds).filter(
      (e) => e.kind === 'noteOn' && e.slot === 'bass',
    );
    expect(bassInDrop).toHaveLength(0);
  });

  it('strumming with the hand plays the current chord; keyboard strum plays every string', () => {
    let g = grooveAction(withChord(), { type: 'strum.toggle' }, 0).state;
    g = grooveParam(g, 'strum.position', 0.3, 1, 1000).state;
    const r = grooveParam(g, 'strum.position', 0.9, 1, 1033);
    expect(r.events.filter((e) => e.kind === 'noteOn')).toHaveLength(6);
    const k = grooveAction(withChord(), { type: 'strum.strum', direction: 'down' }, 2);
    expect(k.events[0]).toMatchObject({ kind: 'slotRelease' });
    expect(k.events.filter((e) => e.kind === 'noteOn')).toHaveLength(6);
  });

  it('tap tempo averages the last taps; genre change sets its tempo without jumping the beat', () => {
    let g = initialGroove();
    for (const t of [10, 10.5, 11, 11.5]) g = grooveAction(g, { type: 'tempo.tap' }, t).state;
    expect(g.transport.bpm).toBe(120);
    const before = beatAt(g.transport, 12);
    g = grooveAction(g, { type: 'drums.nextGenre' }, 12).state;
    expect(g.drums.genre).toBe('house');
    expect(g.transport.bpm).toBe(124);
    expect(beatAt(g.transport, 12)).toBeCloseTo(before);
  });

  it('fill is scheduled for the next bar', () => {
    let g = grooveAction(initialGroove(), { type: 'drums.toggle' }, 0).state;
    g = grooveAction(g, { type: 'drums.fill' }, 0.3).state;
    expect(g.drums.fillBar).toBe(1);
  });
});
