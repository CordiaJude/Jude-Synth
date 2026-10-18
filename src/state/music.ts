// Music controller: gesture frames → mapping preset → conductor → event bus → audio engine. Keyboard and
// touch input enter at the conductor with the same Actions. Lives outside React; the UI reads a small
// zustand store that only changes when something musical changes.

import * as Tone from 'tone';
import { create } from 'zustand';
import { AudioEngine, LIVE_LOOKAHEAD } from '../audio/engine';
import { CHORD_INSTRUMENTS, MELODY_INSTRUMENTS } from '../audio/instruments/patches';
import type { InstrumentId } from '../audio/instruments/types';
import { EventBus } from '../events/bus';
import type { EventCause, MusicEvent } from '../events/types';
import { createMappingState, evaluateMapping, type MappingState } from '../mapping/evaluate';
import type { Action, MappingPreset, ParamUpdate, PerformanceMode } from '../mapping/types';
import {
  conduct,
  DEFAULT_CONDUCTOR,
  initialConductorState,
  type ConductorSettings,
  type ConductorState,
} from '../performance/conductor';
import type { Mode } from '../theory/modes';
import { noteName, type PitchClass } from '../theory/notes';
import { live, percentile } from './live';
import { activePreset, usePresets } from './presets';

export type AudioStatus = 'off' | 'starting' | 'on' | 'error';

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
  setKey: (tonic: PitchClass, mode: Mode) => void;
  setChordInstrument: (id: InstrumentId) => void;
  setMelodyInstrument: (id: InstrumentId) => void;
  setBass: (on: boolean) => void;
  setMuted: (muted: boolean) => void;
}

export const bus = new EventBus();
let engine: AudioEngine | null = null;
let conductor: ConductorState = initialConductorState();
let mapping: MappingState = createMappingState();
let preset: MappingPreset = activePreset();
let unsubscribeLive: (() => void) | null = null;
const latencies: number[] = [];

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
    engine.setParam('bass.level', muted || !get().bass ? 0 : 1, t, 0.15);
  },
}));

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
    if (e.cause) recordLatency(e.time, e.cause);
  } else if (e.kind === 'noteOn' && e.slot === 'melody') {
    useMusic.setState({ melodyNote: noteName(Math.round(e.note), false) });
    if (e.cause) recordLatency(e.time, e.cause);
  } else if (e.kind === 'pitch' && e.slot === 'melody') {
    useMusic.setState({ melodyNote: noteName(Math.round(e.note), false) });
  } else if (e.kind === 'noteOff' && e.slot === 'melody') {
    useMusic.setState({ melodyNote: null });
  }
}

function recordLatency(time: number, cause: EventCause) {
  if (!engine) return;
  latencies.push(engine.heardAt(time) - cause.captureTime);
  if (latencies.length > 60) latencies.shift();
  useMusic.setState({ latencyP50: percentile(latencies, 0.5), latencyP95: percentile(latencies, 0.95) });
}

function syncConductorUi() {
  const m = useMusic.getState();
  if (m.latched !== conductor.latched || m.performanceMode !== conductor.mode) {
    useMusic.setState({ latched: conductor.latched, performanceMode: conductor.mode });
  }
}

/** Feed actions/params into the conductor (keyboard, touch, and gestures all come through here). */
export function perform(
  actions: readonly Action[],
  params: readonly ParamUpdate[],
  cause?: EventCause,
): void {
  if (!engine) return;
  const r = conduct(conductor, { actions, params, cause }, engine.now() + LIVE_LOOKAHEAD, settings());
  conductor = r.state;
  bus.emitAll(r.events);
  syncConductorUi();
}

/** Current harmonic context for the keyboard / touch inputs. */
export function conductorSnapshot(): Pick<ConductorState, 'octave' | 'inversionBias' | 'degree' | 'latched'> {
  return conductor;
}

function attachPerformance() {
  if (unsubscribeLive) return;
  mapping = createMappingState();
  unsubscribeLive = live.subscribe((msg) => {
    if (!engine) return;
    const m = evaluateMapping(preset, msg.frame, mapping, conductor.mode);
    mapping = m.state;
    if (m.out.actions.length || m.out.params.length) {
      perform(m.out.actions, m.out.params, { captureTime: msg.frame.timing.captureTime });
    }
  });
}

/** Switch presets: release what's sounding, then load the preset's instruments and mode. */
export function applyPreset(next: MappingPreset): void {
  preset = next;
  mapping = createMappingState();
  if (engine) {
    const t = engine.now() + LIVE_LOOKAHEAD;
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
    bus.on(onMusicEvent);
    conductor = initialConductorState(preset.defaultMode);
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
  useMusic.setState({ chord: null, melodyNote: null, latched: false });
}

export function stopAudio(): void {
  releaseAll();
  unsubscribeLive?.();
  unsubscribeLive = null;
}

export { CHORD_INSTRUMENTS, MELODY_INSTRUMENTS };
