// A scripted "live" performance built from the real generators (pad chords with voice leading, drums,
// patterned bass, a melody with a pitch glide). Shared by the looper unit tests and the offline-render
// equivalence test, so both check the same music. Pure.

import type { MusicEvent } from '../../events/types';
import { grooveHarmony, grooveWindow, initialGroove, type GrooveState } from '../../performance/groove';
import type { BassPattern } from '../../performance/bass';
import type { Genre } from '../../performance/drums/patterns';
import { timeAtBeat, type Transport } from '../../performance/transport';
import { diatonicChord, voiceLead, type Degree, type Key } from '../../theory';

export interface ScriptedPerformance {
  events: MusicEvent[];
  transport: Transport;
  /** Audio time of bar 1 (the take start) and of the end of the last bar. */
  start: number;
  end: number;
  bars: number;
  key: Key;
}

export interface PerformanceOptions {
  bars?: number;
  bpm?: number;
  origin?: number;
  drums?: Genre | null;
  bass?: BassPattern;
  melody?: boolean;
  /** Theremin-style glides inside a melody note. */
  glide?: boolean;
}

export function scriptedPerformance(o: PerformanceOptions = {}): ScriptedPerformance {
  const bars = o.bars ?? 4;
  const bpm = o.bpm ?? 100;
  const origin = o.origin ?? 0.05;
  const key: Key = { tonic: 9, mode: 'aeolian' };
  const transport: Transport = { bpm, origin };
  const at = (beat: number) => timeAtBeat(transport, beat);
  let g: GrooveState = {
    ...initialGroove(origin),
    transport,
    drums: { ...initialGroove().drums, enabled: o.drums !== null, genre: o.drums ?? 'synthwave' },
    bassPattern: o.bass ?? 'octaves',
  };
  const events: MusicEvent[] = [];
  const degrees: Degree[] = [1, 6, 3, 7, 4, 5, 1, 2];
  let prev: number[] | null = null;
  for (let bar = 0; bar < bars; bar++) {
    const t = at(bar * 4);
    const chord = diatonicChord(key, {
      degree: degrees[bar % degrees.length]!,
      extension: bar % 2 ? 'seventh' : 'triad',
    });
    const voicing = voiceLead(prev, chord);
    prev = voicing;
    for (const e of [
      { kind: 'chord', slot: 'chords', chord, voicing, velocity: 0.8, time: t },
      { kind: 'chord', slot: 'bass', chord, voicing: [36 + (chord.root % 12)], velocity: 0.8, time: t },
    ] as MusicEvent[]) {
      const h = grooveHarmony(g, e);
      g = h.state;
      events.push(h.event);
    }
    events.push(...grooveWindow(g, t, at(bar * 4 + 4)));
  }
  // The pad lets go at the end of the last bar.
  for (const slot of ['chords', 'bass'] as const) {
    const h = grooveHarmony(g, {
      kind: 'chord',
      slot,
      chord: null,
      voicing: [],
      velocity: 0,
      time: at(bars * 4),
    });
    g = h.state;
    events.push(h.event);
  }

  if (o.melody !== false) {
    // Eighth-note melody over bars 2–3, scale tones of A minor.
    const tones = [69, 72, 74, 76, 74, 72, 71, 69];
    for (let i = 0; i < 12; i++) {
      const beat = 4 + i * 0.5;
      const id = `m${i}`;
      events.push({
        kind: 'noteOn',
        id,
        slot: 'melody',
        note: tones[i % tones.length]!,
        velocity: 0.7,
        time: at(beat),
      });
      events.push({ kind: 'noteOff', id, slot: 'melody', time: at(beat + 0.375) });
    }
    if (o.glide) {
      events.push({ kind: 'noteOn', id: 'g1', slot: 'melody', note: 64, velocity: 0.8, time: at(12) });
      for (let k = 1; k <= 6; k++)
        events.push({
          kind: 'pitch',
          id: 'g1',
          slot: 'melody',
          note: 64 + k * 0.5,
          glide: 0.06,
          time: at(12 + k * 0.25),
        });
      events.push({ kind: 'noteOff', id: 'g1', slot: 'melody', time: at(15) });
    }
  }
  return { events, transport, start: at(0), end: at(bars * 4), bars, key };
}
