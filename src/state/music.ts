// Music controller: gesture frames → Classic Two-Hand → event bus → audio engine. Lives outside React;
// the UI reads a small zustand store that only changes when something musical changes.

import * as Tone from 'tone';
import { create } from 'zustand';
import { AudioEngine, LIVE_LOOKAHEAD } from '../audio/engine';
import { CHORD_INSTRUMENTS } from '../audio/instruments/patches';
import type { InstrumentId } from '../audio/instruments/types';
import { EventBus } from '../events/bus';
import type { MusicEvent } from '../events/types';
import { classicStep, DEFAULT_CLASSIC, initialClassicState, type ClassicState } from '../performance/classic';
import type { Mode } from '../theory/modes';
import type { PitchClass } from '../theory/notes';
import { live, percentile } from './live';

export type AudioStatus = 'off' | 'starting' | 'on' | 'error';

interface MusicState {
  status: AudioStatus;
  error: string | null;
  muted: boolean;
  tonic: PitchClass;
  mode: Mode;
  instrument: InstrumentId;
  bass: boolean;
  chord: { name: string; roman: string; notes: number[] } | null;
  /** Camera capture → sound at the speaker, ms. */
  latencyP50: number;
  latencyP95: number;
  setKey: (tonic: PitchClass, mode: Mode) => void;
  setInstrument: (id: InstrumentId) => void;
  setBass: (on: boolean) => void;
  setMuted: (muted: boolean) => void;
}

export const bus = new EventBus();
let engine: AudioEngine | null = null;
let classic: ClassicState = initialClassicState();
let unsubscribeLive: (() => void) | null = null;
const latencies: number[] = [];

export const useMusic = create<MusicState>()((set, get) => ({
  status: 'off',
  error: null,
  muted: false,
  tonic: 0,
  mode: 'ionian',
  instrument: 'supersawPad',
  bass: true,
  chord: null,
  latencyP50: 0,
  latencyP95: 0,
  setKey: (tonic, mode) => {
    set({ tonic, mode });
    revoice();
  },
  setInstrument: (id) => {
    set({ instrument: id });
    if (engine) engine.setInstrument('chords', id, engine.now() + LIVE_LOOKAHEAD);
  },
  setBass: (on) => {
    set({ bass: on });
    if (engine) engine.setParam('bass.level', on ? 1 : 0, engine.now() + LIVE_LOOKAHEAD, 0.2);
  },
  setMuted: (muted) => {
    set({ muted });
    if (engine) engine.setParam('chords.level', muted ? 0 : 1, engine.now(), 0.15);
    if (engine) engine.setParam('bass.level', muted || !get().bass ? 0 : 1, engine.now(), 0.15);
  },
}));

/** Force the current chord to be recomputed in the new key on the next frame. */
function revoice() {
  classic = { ...classic, chord: null };
}

export function getEngine(): AudioEngine | null {
  return engine;
}

function settings() {
  const m = useMusic.getState();
  return { ...DEFAULT_CLASSIC, key: { tonic: m.tonic, mode: m.mode }, bass: m.bass };
}

function onMusicEvent(e: MusicEvent) {
  if (!engine) return;
  engine.schedule(e);
  if (e.kind === 'chord' && e.slot === 'chords') {
    useMusic.setState({
      chord: e.chord ? { name: e.chord.name, roman: e.chord.roman, notes: e.voicing } : null,
    });
    if (e.cause) {
      latencies.push(engine.heardAt(e.time) - e.cause.captureTime);
      if (latencies.length > 60) latencies.shift();
      useMusic.setState({ latencyP50: percentile(latencies, 0.5), latencyP95: percentile(latencies, 0.95) });
    }
  }
}

function attachPerformance() {
  if (unsubscribeLive) return;
  classic = initialClassicState();
  unsubscribeLive = live.subscribe((msg) => {
    if (!engine) return;
    const r = classicStep(classic, msg.frame, engine.now() + LIVE_LOOKAHEAD, settings());
    classic = r.state;
    bus.emitAll(r.events);
  });
}

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
    engine = await AudioEngine.create({ chords: m.instrument, bass: 'subBass', fx: true });
    if (!m.bass) engine.setParam('bass.level', 0, engine.now(), 0.01);
    bus.on(onMusicEvent);
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
  classic = initialClassicState();
  useMusic.setState({ chord: null });
}

export function stopAudio(): void {
  releaseAll();
  unsubscribeLive?.();
  unsubscribeLive = null;
}

export { CHORD_INSTRUMENTS };
