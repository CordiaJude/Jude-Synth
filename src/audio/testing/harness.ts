// Offline-render test harness (built only when HANDWAVE_HARNESS=1). Renders scripted performances through
// the real engine with Tone.Offline and runs the click detectors. Driven by tests/e2e/audio.spec.ts.

import * as Tone from 'tone';
import { diatonicChord, voiceLead, type Degree, type Key } from '../../theory';
import { midiToFreq } from '../../theory/notes';
import { mulberry32 } from '../../gestures/testing/synthetic';
import type { MusicEvent, ParamPath } from '../../events/types';
import { AudioEngine, type EngineOptions } from '../engine';
import { voiceDebug } from '../voice';
import type { InstrumentId, Patch } from '../instruments/types';
import { detectSineClicks, detectTransientClicks, type ClickReport } from './clickDetect';

const SR = 48000;

export interface ScenarioResult {
  name: string;
  /** Click threshold used (transient detector: max(4, 1.25 × the instrument's own onset transient)). */
  threshold?: number;
  detector: 'sine' | 'transient';
  clicks: number;
  firstClicks: Array<{ time: number; ratio: number }>;
  worstRatio: number;
  peakDb: number;
  nonFinite: number;
  renderMs: number;
}

async function render(
  seconds: number,
  opts: EngineOptions,
  script: (e: AudioEngine) => void,
): Promise<Float32Array[]> {
  const buf = await Tone.Offline(
    async () => {
      const engine = await AudioEngine.create(opts);
      script(engine);
    },
    seconds,
    2,
    SR,
  );
  return [buf.getChannelData(0), buf.getChannelData(1)];
}

const toDb = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity);

function summarize(
  name: string,
  detector: ScenarioResult['detector'],
  reports: ClickReport[],
  ms: number,
): ScenarioResult {
  const clicks = reports.flatMap((r) => r.clicks);
  return {
    name,
    detector,
    clicks: clicks.length,
    firstClicks: clicks.slice(0, 5).map((c) => ({ time: +c.time.toFixed(4), ratio: +c.ratio.toFixed(2) })),
    worstRatio: Math.max(...reports.map((r) => r.worstRatio)),
    peakDb: toDb(Math.max(...reports.map((r) => r.peak))),
    nonFinite: reports.reduce((a, r) => a + r.nonFinite, 0),
    renderMs: ms,
  };
}

/** Worst case for the voice manager: fast changes, wide leaps, both transitions, releases, stealing. */
function torture(
  e: AudioEngine,
  seconds: number,
  opts: { voices: number; interval: number; lo: number; hi: number; seed: number },
) {
  const rng = mulberry32(opts.seed);
  let t = 0.05;
  let i = 0;
  while (t < seconds - 0.4) {
    const n = 1 + Math.floor(rng() * opts.voices);
    const voicing = Array.from({ length: n }, () => Math.round(opts.lo + rng() * (opts.hi - opts.lo)));
    const release = i % 9 === 8;
    e.schedule({
      kind: 'chord',
      slot: 'chords',
      chord: release ? null : diatonicChord({ tonic: 0, mode: 'ionian' }, { degree: 1 }),
      voicing: release ? [] : [...new Set(voicing)],
      velocity: 0.4 + rng() * 0.6,
      transition: i % 2 ? 'legato' : 'crossfade',
      time: t,
    });
    if (i % 5 === 0)
      e.schedule({ kind: 'param', target: 'macro.brightness', value: rng(), rampMs: 5, time: t + 0.01 });
    if (i % 7 === 0)
      e.schedule({
        kind: 'param',
        target: 'master.volume',
        value: 0.5 + rng() * 0.3,
        rampMs: 5,
        time: t + 0.02,
      });
    t += opts.interval * (0.5 + rng());
    i++;
  }
  e.schedule({ kind: 'chord', slot: 'chords', chord: null, voicing: [], velocity: 0, time: seconds - 0.4 });
}

/**
 * Swap every oscillator for a sine and bypass the voice's static saturation curve; envelopes, filter and
 * its envelope, glide, voice count and crossfades stay identical. (A memoryless smooth curve can't create a
 * discontinuity — it only adds harmonics, which would force a looser bound.)
 */
function sineify(p: Patch): Patch {
  return { ...p, drive: 0, oscs: p.oscs.map((o) => ({ ...o, type: 'sine' as const })) };
}

/** A musical progression with the gesture-driven parameter sweeps a real performance produces. */
function progression(e: AudioEngine, seconds: number, interval: number, slots: 'both' | 'bass' = 'both') {
  const key: Key = { tonic: 9, mode: 'aeolian' };
  const degrees: Degree[] = [1, 6, 3, 7, 4, 5, 1, 2, 5, 1];
  let prev: number[] | null = null;
  let t = 0.05;
  let i = 0;
  // A live session sets every continuous parameter before the first note sounds.
  e.setParam('macro.brightness', 0.3, 0, 0.001);
  e.setParam('macro.space', 0.5, 0, 0.001);
  while (t < seconds - 1.2) {
    const chord = diatonicChord(key, {
      degree: degrees[i % degrees.length]!,
      extension: i % 3 ? 'seventh' : 'triad',
      parallel: i % 4 === 3,
    });
    const voicing = voiceLead(prev, chord);
    prev = voicing;
    if (slots === 'both')
      e.schedule({ kind: 'chord', slot: 'chords', chord, voicing, velocity: 0.8, time: t });
    e.schedule({
      kind: 'chord',
      slot: 'bass',
      chord,
      voicing: [36 + ((chord.root - 0 + 12) % 12)],
      velocity: 0.8,
      time: t,
    });
    if (slots === 'bass' && i % 5 === 4)
      e.schedule({
        kind: 'chord',
        slot: 'bass',
        chord: null,
        voicing: [],
        velocity: 0,
        time: t + interval * 0.5,
      });
    e.schedule({
      kind: 'param',
      target: 'macro.brightness',
      value: 0.3 + 0.6 * Math.abs(Math.sin(i)),
      rampMs: 50,
      time: t,
    });
    e.schedule({ kind: 'param', target: 'macro.space', value: 0.5, rampMs: 50, time: t });
    if (i % 6 === 5) {
      e.schedule({
        kind: 'chord',
        slot: 'chords',
        chord: null,
        voicing: [],
        velocity: 0,
        time: t + interval * 0.6,
      });
      prev = null;
    }
    t += interval;
    i++;
  }
  e.schedule({ kind: 'chord', slot: 'chords', chord: null, voicing: [], velocity: 0, time: seconds - 1.2 });
  e.schedule({ kind: 'chord', slot: 'bass', chord: null, voicing: [], velocity: 0, time: seconds - 1.2 });
}

interface Scenario {
  name: string;
  /** Transient detector: the instrument whose natural onset calibrates the threshold. */
  instrument?: InstrumentId;
  seconds: number;
  opts: EngineOptions;
  detector: ScenarioResult['detector'];
  maxFreq?: number;
  script: (e: AudioEngine, seconds: number) => void;
}

const MAX_SINE_FREQ = midiToFreq(84) * 1.08;

function scenarios(): Scenario[] {
  const list: Scenario[] = [];
  // 1. Strict: sine voices, dry. Every voice-manager path (glide, crossfade, steal, release, re-attack).
  for (const seed of [1, 2, 3]) {
    list.push({
      name: `sine voices, dry, torture #${seed}`,
      seconds: 6,
      opts: { chords: 'testSine', bass: null, fx: false },
      detector: 'sine',
      script: (e, s) => torture(e, s, { voices: 4, interval: 0.06, lo: 48, hi: 84, seed }),
    });
  }
  // 2. Strict through chorus + ping-pong delay + limiter (reverb is noise-based, so it is off here).
  list.push({
    name: 'sine voices through chorus/delay/limiter',
    seconds: 6,
    opts: { chords: 'testSine', bass: null, fx: true },
    detector: 'sine',
    maxFreq: MAX_SINE_FREQ * 1.05,
    script: (e, s) => {
      e.setParam('fx.reverb.mix', 0, 0, 0.001);
      e.setParam('fx.delay.mix', 0.3, 0, 0.001);
      torture(e, s, { voices: 4, interval: 0.08, lo: 52, hi: 84, seed: 9 });
    },
  });
  // 3. Every real instrument's actual patch (envelopes, resonant filter envelopes, glide, voice count,
  //    crossfades) with the oscillator WAVEFORMS swapped for sines, through chorus + tape + limiter. Clicks
  //    can only come from this control path — the browser's band-limited oscillator tables are smooth by
  //    construction — and with sines the strict detector applies. Reverb/delay are linear time-invariant
  //    (the IR fades in), so they can't create a click; they're off to keep the test sharp, as is tape drive
  //    (a smooth memoryless curve, unit-tested separately).
  for (const id of ['supersawPad', 'warmPoly', 'subBass'] as InstrumentId[]) {
    for (const interval of [0.5, 0.15]) {
      list.push({
        name: `${id} (sine-ified) + chorus/tape/limiter, change every ${interval * 1000} ms`,
        seconds: 8,
        opts: {
          chords: id === 'subBass' ? 'warmPoly' : id,
          bass: 'subBass',
          fx: true,
          patchTransform: sineify,
        },
        detector: 'sine',
        maxFreq: MAX_SINE_FREQ,
        script: (e, s) => {
          progression(e, s, interval, id === 'subBass' ? 'bass' : 'both');
          e.setParam('fx.reverb.mix', 0, 0.001, 0.001);
          e.setParam('fx.delay.mix', 0, 0.001, 0.001);
        },
      });
    }
  }
  // 3b. Real waveforms, full FX: gross-artifact check (NaNs, level, limiter) on what users actually hear.
  for (const id of ['supersawPad', 'warmPoly'] as InstrumentId[]) {
    list.push({
      name: `${id} + subBass, full FX (real waveforms)`,
      instrument: id,
      seconds: 8,
      opts: { chords: id, bass: 'subBass', fx: true },
      detector: 'transient',
      script: (e, s) => progression(e, s, 0.3),
    });
  }
  // 4. Loud: max volume, boosted levels, many voices — the limiter must hold the ceiling.
  list.push({
    name: 'loud: limiter ceiling',
    instrument: 'supersawPad',
    seconds: 4,
    opts: { chords: 'supersawPad', bass: 'subBass', fx: true },
    detector: 'transient',
    script: (e) => {
      e.setParam('master.volume', 1, 0, 0.001);
      e.setParam('macro.brightness', 1, 0, 0.001);
      e.setParam('chords.level', 4, 0, 0.001);
      e.setParam('bass.level', 3, 0, 0.001);
      const chord = diatonicChord({ tonic: 0, mode: 'ionian' }, { degree: 1 });
      e.schedule({ kind: 'chord', slot: 'bass', chord, voicing: [36], velocity: 1, time: 0.05 });
      for (let k = 0; k < 6; k++)
        e.schedule({
          kind: 'chord',
          slot: 'chords',
          chord,
          voicing: [48 + k * 5, 55 + k * 5, 60 + k * 5, 64 + k * 5, 67 + k * 5],
          velocity: 1,
          time: 0.05 + k * 0.4,
        });
    },
  });
  return list;
}

async function renderScenario(sc: Scenario): Promise<Float32Array[]> {
  return render(sc.seconds, sc.opts, (e) => sc.script(e, sc.seconds));
}

/**
 * The instrument's own deliberate onset transient: one bright chord attacked from silence, held, released.
 * Nothing in a performance may be sharper than this (that's what "no clicks" means for a plucky patch).
 */
const onsetCache = new Map<InstrumentId, number>();
async function onsetTransient(id: InstrumentId): Promise<number> {
  const cached = onsetCache.get(id);
  if (cached !== undefined) return cached;
  const chord = diatonicChord({ tonic: 0, mode: 'ionian' }, { degree: 1 });
  const ch = await render(2.5, { chords: id, bass: null, fx: true }, (e) => {
    e.setParam('macro.brightness', 1, 0, 0.001);
    e.schedule({ kind: 'chord', slot: 'chords', chord, voicing: [55, 60, 64, 67], velocity: 1, time: 0.1 });
    e.schedule({ kind: 'chord', slot: 'chords', chord: null, voicing: [], velocity: 0, time: 1.3 });
  });
  const r0 = Math.max(...ch.map((c) => detectTransientClicks(c, SR, { ratio: Infinity }).worstRatio));
  onsetCache.set(id, r0);
  return r0;
}

async function evaluate(sc: Scenario): Promise<ScenarioResult> {
  const t0 = performance.now();
  const ch = await renderScenario(sc);
  if (sc.detector === 'sine') {
    return summarize(
      sc.name,
      'sine',
      ch.map((c) => detectSineClicks(c, SR, sc.maxFreq ?? MAX_SINE_FREQ)),
      performance.now() - t0,
    );
  }
  const threshold = Math.max(4, 1.25 * (sc.instrument ? await onsetTransient(sc.instrument) : 0));
  const res = summarize(
    sc.name,
    'transient',
    ch.map((c) => detectTransientClicks(c, SR, { ratio: threshold })),
    performance.now() - t0,
  );
  return { ...res, threshold };
}

export async function runClickSuite(): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  for (const sc of scenarios()) results.push(await evaluate(sc));
  return results;
}

/** Positive control on a REAL instrument: the same progression with naive hard-cut releases must fail. */
export async function runBrokenVoiceControl(): Promise<ScenarioResult> {
  voiceDebug.hardCuts = true;
  try {
    const sc = scenarios().find(
      (s) => s.name.startsWith('warmPoly (sine-ified)') && s.name.endsWith('500 ms'),
    )!;
    return await evaluate({ ...sc, name: 'warmPoly (sine-ified) with naive hard-cut releases (must fail)' });
  } finally {
    voiceDebug.hardCuts = false;
  }
}

/** Debug: render one scenario and return its samples (for offline analysis). */
export async function renderByName(name: string, brokenVoices = false): Promise<number[][]> {
  const sc = scenarios().find((s) => s.name === name);
  if (!sc) throw new Error(`no scenario ${name}`);
  voiceDebug.hardCuts = brokenVoices;
  try {
    return (await renderScenario(sc)).map((c) => Array.from(c));
  } finally {
    voiceDebug.hardCuts = false;
  }
}

/** Debug: render an explicit event list (for bisecting problems offline). */
export async function renderEvents(
  seconds: number,
  opts: EngineOptions,
  events: MusicEvent[],
  params: Array<[ParamPath, number]> = [],
): Promise<number[][]> {
  const ch = await render(seconds, opts, (e) => {
    for (const [p, v] of params) e.setParam(p, v, 0, 0.001);
    for (const ev of events) e.schedule(ev);
  });
  return ch.map((c) => Array.from(c));
}

/** Debug: the event list a scenario schedules (so it can be edited and replayed with renderEvents). */
export function scenarioEvents(name: string): MusicEvent[] {
  const sc = scenarios().find((s) => s.name === name)!;
  const events: MusicEvent[] = [];
  const fake = {
    schedule: (e: MusicEvent) => events.push(e),
    setParam: () => undefined,
  } as unknown as AudioEngine;
  sc.script(fake, sc.seconds);
  return events;
}

export function scenarioNames(): string[] {
  return scenarios().map((s) => s.name);
}

/** Positive control: naive synthesis (hard gain steps, oscillator restarts) MUST be flagged. */
export async function runPositiveControl(): Promise<{ sine: number; transient: number }> {
  const buf = await Tone.Offline(
    (ctx) => {
      const raw = ctx.rawContext as unknown as BaseAudioContext;
      const g = ctx.createGain();
      Tone.connect(g, ctx.destination);
      let t = 0.05;
      for (let k = 0; k < 10; k++) {
        const o = ctx.createOscillator();
        o.frequency.value = midiToFreq(60 + k * 2);
        o.connect(g);
        o.start(t);
        o.stop(t + 0.18);
        g.gain.setValueAtTime(0.2 + (k % 3) * 0.15, t); // hard step
        t += 0.2;
      }
      void raw;
    },
    2.5,
    1,
    SR,
  );
  const x = buf.getChannelData(0);
  return {
    sine: detectSineClicks(x, SR, midiToFreq(80)).clicks.length,
    transient: detectTransientClicks(x, SR).clicks.length,
  };
}

declare global {
  interface Window {
    handwaveHarness: {
      runClickSuite: typeof runClickSuite;
      runPositiveControl: typeof runPositiveControl;
      runBrokenVoiceControl: typeof runBrokenVoiceControl;
      renderByName: typeof renderByName;
      renderEvents: typeof renderEvents;
      scenarioEvents: typeof scenarioEvents;
      scenarioNames: typeof scenarioNames;
    };
  }
}
window.handwaveHarness = {
  runClickSuite,
  runPositiveControl,
  runBrokenVoiceControl,
  renderByName,
  renderEvents,
  scenarioEvents,
  scenarioNames,
};
document.body.dataset.ready = 'true';
