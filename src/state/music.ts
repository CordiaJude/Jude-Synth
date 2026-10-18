// Music controller: gesture frames → mapping preset → conductor + groove → event bus → audio engine.
// Keyboard and touch input enter with the same Actions. Time-based parts (arp, drums, patterned bass) come
// from a lookahead scheduler on the audio clock. Lives outside React; the UI reads small zustand stores that
// only change when something musical changes.

import * as Tone from 'tone';
import { create } from 'zustand';
import { AudioEngine, LIVE_LOOKAHEAD } from '../audio/engine';
import { CHORD_INSTRUMENTS, MELODY_INSTRUMENTS } from '../audio/instruments/patches';
import type { InstrumentId } from '../audio/instruments/types';
import { EventBus } from '../events/bus';
import type { EventCause, MusicEvent } from '../events/types';
import { createMappingState, evaluateMapping, type MappingState } from '../mapping/evaluate';
import {
  LOOPER_ACTION_TYPES,
  type Action,
  type LooperAction,
  type MappingPreset,
  type ParamUpdate,
  type PerformanceMode,
} from '../mapping/types';
import type { ArpSettings } from '../performance/arp';
import type { BassPattern } from '../performance/bass';
import {
  conduct,
  DEFAULT_CONDUCTOR,
  initialConductorState,
  type ConductorSettings,
  type ConductorState,
} from '../performance/conductor';
import type { Genre } from '../performance/drums/patterns';
import {
  grooveAction,
  grooveHarmony,
  grooveParam,
  grooveWindow,
  GROOVE_ACTION_TYPES,
  GROOVE_TARGETS,
  initialGroove,
  padPlays,
  setBassPattern,
  setGenre,
  type GrooveAction,
  type GrooveState,
  type GrooveTarget,
} from '../performance/groove';
import { LATENCY_STAGES, latencyStages, type LatencyStage } from '../performance/latency';
import { quantizeTime, setTempo, type QuantizeSettings, type Transport } from '../performance/transport';
import type { Mode } from '../theory/modes';
import { noteName, type PitchClass } from '../theory/notes';
import { wallNow } from '../vision/types';
import { live, percentile } from './live';
import { activePreset, usePresets } from './presets';

export type AudioStatus = 'off' | 'starting' | 'on' | 'error';

export interface StageStat {
  stage: LatencyStage;
  p50: number;
  p95: number;
}

interface MusicState {
  status: AudioStatus;
  error: string | null;
  muted: boolean;
  tonic: PitchClass;
  mode: Mode;
  chordInstrument: InstrumentId;
  melodyInstrument: InstrumentId;
  bass: boolean;
  performanceMode: PerformanceMode;
  latched: boolean;
  chord: { name: string; roman: string; notes: number[] } | null;
  melodyNote: string | null;
  /** Camera capture → sound at the speaker, ms. */
  latencyP50: number;
  latencyP95: number;
  latencyStages: StageStat[];
  /** Predictive onset: announced early / taken back. */
  predictions: { announced: number; reverted: number };
  setKey: (tonic: PitchClass, mode: Mode) => void;
  setChordInstrument: (id: InstrumentId) => void;
  setMelodyInstrument: (id: InstrumentId) => void;
  setBass: (on: boolean) => void;
  setMuted: (muted: boolean) => void;
}

/** Groove settings mirrored for the UI. */
interface GrooveUi {
  bpm: number;
  arp: ArpSettings;
  strum: boolean;
  drums: boolean;
  genre: Genre;
  duck: number;
  bassPattern: BassPattern;
  quantize: QuantizeSettings;
  /** Current bar.beat, refreshed by the scheduler while anything rhythmic plays. */
  position: string;
}

export const bus = new EventBus();
let engine: AudioEngine | null = null;
let conductor: ConductorState = initialConductorState();
let mapping: MappingState = createMappingState();
let preset: MappingPreset = activePreset();
let groove: GrooveState = initialGroove();
let unsubscribeLive: (() => void) | null = null;
let scheduler: ReturnType<typeof setInterval> | null = null;
let scheduledUntil = 0;
const latencies: number[] = [];
const stageSamples: Record<LatencyStage, number[]> = Object.fromEntries(
  LATENCY_STAGES.map((s) => [s, []]),
) as never;

/** Scheduler cadence and horizon: short enough that live changes are heard quickly. */
const TICK_MS = 15;
const HORIZON = 0.08;

export const useMusic = create<MusicState>()((set, get) => ({
  status: 'off',
  error: null,
  muted: false,
  tonic: 0,
  mode: 'ionian',
  chordInstrument: preset.instruments.chords,
  melodyInstrument: preset.instruments.melody,
  bass: preset.instruments.bass,
  performanceMode: preset.defaultMode,
  latched: false,
  chord: null,
  melodyNote: null,
  latencyP50: 0,
  latencyP95: 0,
  latencyStages: [],
  predictions: { announced: 0, reverted: 0 },
  setKey: (tonic, mode) => {
    set({ tonic, mode });
    // Re-voice the held chord in the new key right away.
    if (conductor.degree !== null) perform([{ type: 'chord.degree', degree: conductor.degree }], []);
  },
  setChordInstrument: (id) => {
    set({ chordInstrument: id });
    engine?.setInstrument('chords', id, engine.now() + LIVE_LOOKAHEAD);
  },
  setMelodyInstrument: (id) => {
    set({ melodyInstrument: id });
    engine?.setInstrument('melody', id, engine.now() + LIVE_LOOKAHEAD);
  },
  setBass: (on) => {
    set({ bass: on });
    engine?.setParam('bass.level', on && !get().muted ? 1 : 0, engine.now() + LIVE_LOOKAHEAD, 0.2);
  },
  setMuted: (muted) => {
    set({ muted });
    if (!engine) return;
    const t = engine.now();
    engine.setParam('chords.level', muted ? 0 : 1, t, 0.15);
    engine.setParam('melody.level', muted ? 0 : 1, t, 0.15);
    engine.setParam('drums.level', muted ? 0 : 1, t, 0.15);
    engine.setParam('loops.level', muted ? 0 : 1, t, 0.15);
    engine.setParam('bass.level', muted || !get().bass ? 0 : 1, t, 0.15);
  },
}));

const grooveUi = (): GrooveUi => ({
  bpm: groove.transport.bpm,
  arp: groove.arp,
  strum: groove.strum.enabled,
  drums: groove.drums.enabled,
  genre: groove.drums.genre,
  duck: useGroove.getState().duck,
  bassPattern: groove.bassPattern,
  quantize: groove.quantize,
  position: useGroove.getState().position,
});

export const useGroove = create<GrooveUi>()(() => ({
  bpm: groove.transport.bpm,
  arp: groove.arp,
  strum: false,
  drums: false,
  genre: groove.drums.genre,
  duck: 0.35,
  bassPattern: groove.bassPattern,
  quantize: groove.quantize,
  position: '1.1',
}));

function syncGrooveUi() {
  useGroove.setState(grooveUi());
}

export function getEngine(): AudioEngine | null {
  return engine;
}

export function getPreset(): MappingPreset {
  return preset;
}

function settings(): ConductorSettings {
  const m = useMusic.getState();
  return { ...DEFAULT_CONDUCTOR, key: { tonic: m.tonic, mode: m.mode }, bass: m.bass, melody: preset.melody };
}

function onMusicEvent(e: MusicEvent) {
  if (!engine) return;
  engine.schedule(e);
  if (e.kind === 'chord' && e.slot === 'chords') {
    useMusic.setState({
      chord: e.chord ? { name: e.chord.name, roman: e.chord.roman, notes: e.voicing } : null,
    });
  } else if (e.kind === 'noteOn' && e.slot === 'melody') {
    useMusic.setState({ melodyNote: noteName(Math.round(e.note), false) });
  } else if (e.kind === 'pitch' && e.slot === 'melody') {
    useMusic.setState({ melodyNote: noteName(Math.round(e.note), false) });
  } else if (e.kind === 'noteOff' && e.slot === 'melody') {
    useMusic.setState({ melodyNote: null });
  }
}

function recordLatency(cause: EventCause, scheduledAt: number, eventTime: number, unquantized: number) {
  if (!engine) return;
  const { stages, total } = latencyStages({
    cause,
    scheduledAt,
    lookaheadMs: LIVE_LOOKAHEAD * 1000,
    quantizeMs: (eventTime - unquantized) * 1000,
    heardAt: engine.heardAt(eventTime),
  });
  latencies.push(total);
  if (latencies.length > 60) latencies.shift();
  for (const s of LATENCY_STAGES) {
    stageSamples[s].push(stages[s]);
    if (stageSamples[s].length > 60) stageSamples[s].shift();
  }
  useMusic.setState({
    latencyP50: percentile(latencies, 0.5),
    latencyP95: percentile(latencies, 0.95),
    latencyStages: LATENCY_STAGES.map((stage) => ({
      stage,
      p50: percentile(stageSamples[stage], 0.5),
      p95: percentile(stageSamples[stage], 0.95),
    })),
  });
}

function syncConductorUi() {
  const m = useMusic.getState();
  if (m.latched !== conductor.latched || m.performanceMode !== conductor.mode) {
    useMusic.setState({ latched: conductor.latched, performanceMode: conductor.mode });
  }
}

const QUANTIZED_KINDS = new Set(['chord', 'noteOn', 'noteOff']);

// ---- hooks for the looper (it lives in its own module and plugs in here) --------------------------------

type TickHook = (now: number, from: number, to: number) => void;
const tickHooks = new Set<TickHook>();
let looperActions: ((a: LooperAction) => void) | null = null;
const stopHooks = new Set<() => void>();

/** Run on every scheduler tick with the window being scheduled ([from, to) may be empty). */
export function onSchedulerTick(fn: TickHook): () => void {
  tickHooks.add(fn);
  return () => tickHooks.delete(fn);
}
export function setLooperActionHandler(fn: (a: LooperAction) => void): void {
  looperActions = fn;
}
/** Run when the session stops (everything goes quiet). */
export function onSessionStop(fn: () => void): () => void {
  stopHooks.add(fn);
  return () => stopHooks.delete(fn);
}

/** The shared transport (tempo + where beat 0 is) and whether anything rhythmic is running on it. */
export const transport = {
  get: (): Transport => groove.transport,
  /** Move beat 0 to `origin` (only when nothing rhythmic is playing — see busy()). */
  reanchor: (origin: number): void => {
    groove = { ...groove, transport: { ...groove.transport, origin } };
  },
  busy: (): boolean => groove.drums.enabled || groove.arp.enabled || groove.bassPattern !== 'sustain',
  liveDrums: (): boolean => groove.drums.enabled,
};

/**
 * Feed actions/params in (keyboard, touch, and gestures all come through here). Harmony/melody go to the
 * conductor, rhythm controls to the groove; discrete musical events are quantized if the user asked for it.
 */
export function perform(
  actions: readonly Action[],
  params: readonly ParamUpdate[],
  cause?: EventCause,
): void {
  if (!engine) return;
  const scheduledAt = wallNow();
  const t0 = engine.now() + LIVE_LOOKAHEAD;
  for (const a of actions) if (LOOPER_ACTION_TYPES.has(a.type)) looperActions?.(a as LooperAction);
  const grooveActions = actions.filter((a) => GROOVE_ACTION_TYPES.has(a.type)) as GrooveAction[];
  const conductorActions = actions.filter(
    (a) => !GROOVE_ACTION_TYPES.has(a.type) && !LOOPER_ACTION_TYPES.has(a.type),
  );
  const qt = conductorActions.length ? quantizeTime(t0, groove.transport, groove.quantize, t0) : t0;

  const r = conduct(conductor, { actions: conductorActions, params, cause }, t0, settings());
  conductor = r.state;
  const out: MusicEvent[] = [];
  let measured = false;
  for (const raw of r.events) {
    const e = QUANTIZED_KINDS.has(raw.kind) ? ({ ...raw, time: qt } as MusicEvent) : raw;
    const h = grooveHarmony(groove, e);
    groove = h.state;
    out.push(h.event);
    if (cause && !measured && (e.kind === 'chord' || e.kind === 'noteOn') && 'cause' in e && e.cause) {
      recordLatency(cause, scheduledAt, qt, t0);
      measured = true;
    }
  }
  for (const a of grooveActions) {
    const g = grooveAction(groove, a, t0);
    groove = g.state;
    out.push(...g.events);
  }
  for (const p of params) {
    if (!GROOVE_TARGETS.has(p.target)) continue;
    const g = grooveParam(groove, p.target as GrooveTarget, p.value, t0, cause?.captureTime ?? wallNow());
    groove = g.state;
    out.push(...g.events);
  }
  bus.emitAll(out);
  syncConductorUi();
  if (grooveActions.length) syncGrooveUi();
}

/** Current harmonic context for the keyboard / touch inputs. */
export function conductorSnapshot(): Pick<ConductorState, 'octave' | 'inversionBias' | 'degree' | 'latched'> {
  return conductor;
}

// ---- groove settings from the UI --------------------------------------------------------------------------

function updateGroove(fn: (g: GrooveState, time: number) => { state: GrooveState; events?: MusicEvent[] }) {
  const t = (engine?.now() ?? 0) + LIVE_LOOKAHEAD;
  const r = fn(groove, t);
  groove = r.state;
  if (r.events?.length) bus.emitAll(r.events);
  syncGrooveUi();
}

export const grooveControls = {
  setBpm: (bpm: number) =>
    updateGroove((g, t) => ({ state: { ...g, transport: setTempo(g.transport, bpm, t) } })),
  setArp: (patch: Partial<ArpSettings>) =>
    updateGroove((g, t) => {
      if (patch.enabled !== undefined && patch.enabled !== g.arp.enabled) {
        const r = grooveAction(g, { type: 'arp.toggle' }, t);
        return { state: { ...r.state, arp: { ...r.state.arp, ...patch } }, events: r.events };
      }
      return { state: { ...g, arp: { ...g.arp, ...patch } } };
    }),
  setStrum: (on: boolean) =>
    updateGroove((g, t) =>
      on !== g.strum.enabled ? grooveAction(g, { type: 'strum.toggle' }, t) : { state: g },
    ),
  setDrums: (on: boolean) =>
    updateGroove((g, t) =>
      on !== g.drums.enabled ? grooveAction(g, { type: 'drums.toggle' }, t) : { state: g },
    ),
  setGenre: (genre: Genre) => updateGroove((g, t) => setGenre(g, genre, t)),
  setBassPattern: (pattern: BassPattern) => updateGroove((g, t) => setBassPattern(g, pattern, t)),
  setQuantize: (patch: Partial<QuantizeSettings>) =>
    updateGroove((g) => ({ state: { ...g, quantize: { ...g.quantize, ...patch } } })),
  setDuck: (amount: number) => {
    useGroove.setState({ duck: amount });
    engine?.setParam('fx.duck', amount, engine.now(), 0.05);
  },
  fill: () => perform([{ type: 'drums.fill' }], []),
  drop: () => perform([{ type: 'drums.drop' }], []),
  tap: () => perform([{ type: 'tempo.tap' }], []),
};

// ---- scheduler ----------------------------------------------------------------------------------------------

function tick() {
  if (!engine) return;
  const now = engine.now();
  const from = Math.max(scheduledUntil, now);
  const to = Math.max(from, now + HORIZON);
  for (const hook of tickHooks) hook(now, from, to);
  if (to <= from) return;
  const events = grooveWindow(groove, from, to);
  scheduledUntil = to;
  if (events.length) bus.emitAll(events);
  if (groove.drums.enabled || groove.arp.enabled || groove.bassPattern !== 'sustain') {
    const beat = Math.max(0, (now - groove.transport.origin) / (60 / groove.transport.bpm));
    const position = `${Math.floor(beat / 4) + 1}.${(Math.floor(beat) % 4) + 1}`;
    if (useGroove.getState().position !== position) useGroove.setState({ position });
  }
}

function startScheduler() {
  if (scheduler || !engine) return;
  scheduledUntil = engine.now();
  scheduler = setInterval(tick, TICK_MS);
}

function stopScheduler() {
  if (scheduler) clearInterval(scheduler);
  scheduler = null;
}

// ---- gestures -----------------------------------------------------------------------------------------------

function attachPerformance() {
  if (unsubscribeLive) return;
  mapping = createMappingState();
  unsubscribeLive = live.subscribe((msg) => {
    if (!engine) return;
    let { announced, reverted } = useMusic.getState().predictions;
    const before = announced + reverted;
    for (const e of msg.frame.events) {
      if (e.type !== 'poseEnter' || !e.tentative) continue;
      if (e.revert) reverted++;
      else announced++;
    }
    if (announced + reverted !== before) useMusic.setState({ predictions: { announced, reverted } });

    const m = evaluateMapping(preset, msg.frame, mapping, conductor.mode);
    mapping = m.state;
    if (m.out.actions.length || m.out.params.length) {
      const t = msg.frame.timing;
      perform(m.out.actions, m.out.params, {
        captureTime: t.captureTime,
        detectStart: t.detectStart,
        detectEnd: t.detectEnd,
        recognizeEnd: t.recognizeEnd,
        receivedAt: msg.receivedAt,
      });
    }
  });
  startScheduler();
}

/** Switch presets: release what's sounding, then load the preset's instruments, mode and groove. */
export function applyPreset(next: MappingPreset): void {
  preset = next;
  mapping = createMappingState();
  const t = (engine?.now() ?? 0) + LIVE_LOOKAHEAD;
  if (engine) {
    engine.releaseAll(t);
    engine.setInstrument('chords', next.instruments.chords, t);
    engine.setInstrument('melody', next.instruments.melody, t);
    // Reset everything a previous preset may have moved.
    for (const [p, v] of [
      ['fx.djFilter', 0.5],
      ['melody.level', 1],
      ['chords.level', 1],
      ['melody.vibrato', 0],
      ['macro.grit', 0],
      ['fx.delay.feedback', 0.38],
    ] as const) {
      engine.setParam(p, v, t, 0.3);
    }
  }
  conductor = initialConductorState(next.defaultMode);
  const gs = next.groove ?? {};
  groove = {
    ...groove,
    harmony: { chord: null, voicing: [], bassNote: null },
    arp: { ...groove.arp, enabled: gs.arp ?? false },
    strum: { ...groove.strum, enabled: gs.strum ?? false },
    drums: { ...groove.drums, enabled: gs.drums ?? false, fillBar: null, dropBar: null },
    bassPattern: gs.bassPattern ?? 'sustain',
  };
  if (gs.genre && gs.genre !== groove.drums.genre) groove = setGenre(groove, gs.genre, t).state;
  useMusic.setState({
    chordInstrument: next.instruments.chords,
    melodyInstrument: next.instruments.melody,
    bass: next.instruments.bass,
    performanceMode: next.defaultMode,
    latched: false,
    chord: null,
    melodyNote: null,
  });
  useMusic.getState().setBass(next.instruments.bass);
  syncGrooveUi();
}

usePresets.subscribe((s, prev) => {
  if (s.activeId !== prev.activeId || s.userPresets !== prev.userPresets) {
    const next = activePreset();
    if (next.id !== preset.id) applyPreset(next);
    else preset = next; // edited in place: keep playing with the new mappings
  }
});

/**
 * Start audio. Must be called from a user gesture (click/tap/key): Tone.start() resumes the AudioContext,
 * which browsers only allow in response to one.
 */
export async function ensureAudio(): Promise<void> {
  const status = useMusic.getState().status;
  if (status === 'starting') return;
  if (engine) {
    await Tone.start();
    attachPerformance();
    return;
  }
  useMusic.setState({ status: 'starting', error: null });
  try {
    // Small lookahead + interactive latency hint: every millisecond here is felt by the player.
    Tone.setContext(new Tone.Context({ latencyHint: 'interactive', lookAhead: 0.01 }));
    await Tone.start();
    const m = useMusic.getState();
    engine = await AudioEngine.create({
      chords: m.chordInstrument,
      melody: m.melodyInstrument,
      bass: 'subBass',
      fx: true,
    });
    if (!m.bass) engine.setParam('bass.level', 0, engine.now(), 0.01);
    engine.setParam('fx.duck', useGroove.getState().duck, engine.now(), 0.01);
    bus.on(onMusicEvent);
    conductor = initialConductorState(preset.defaultMode);
    groove = { ...groove, transport: { ...groove.transport, origin: engine.now() + 0.05 } };
    applyPreset(preset);
    attachPerformance();
    useMusic.setState({ status: 'on' });
  } catch (err) {
    console.error('[audio] failed to start', err);
    engine = null;
    useMusic.setState({ status: 'error', error: err instanceof Error ? err.message : String(err) });
  }
}

/** Silence everything (session stop). The engine stays alive for the next session. */
export function releaseAll(): void {
  if (!engine) return;
  engine.releaseAll(engine.now() + LIVE_LOOKAHEAD);
  conductor = initialConductorState(preset.defaultMode);
  // Back to the preset's own groove defaults, so nothing leaks into the next session.
  const gs = preset.groove ?? {};
  groove = {
    ...groove,
    harmony: { chord: null, voicing: [], bassNote: null },
    arp: { ...groove.arp, enabled: gs.arp ?? false },
    strum: { ...groove.strum, enabled: gs.strum ?? false },
    drums: { ...groove.drums, enabled: gs.drums ?? false, fillBar: null, dropBar: null },
    bassPattern: gs.bassPattern ?? 'sustain',
  };
  useMusic.setState({ chord: null, melodyNote: null, latched: false });
  syncGrooveUi();
}

export function stopAudio(): void {
  releaseAll();
  for (const fn of stopHooks) fn();
  stopScheduler();
  unsubscribeLive?.();
  unsubscribeLive = null;
}

/** For tests/debug: is the pad currently the one sounding chords? */
export const padIsPlaying = (): boolean => padPlays(groove);

export { CHORD_INSTRUMENTS, MELODY_INSTRUMENTS };
