// Looper controller: records the live performance off the event bus, plays loops back through their own
// track instruments, and keeps the engine, the UI store and local storage in step with the loop project.
// The musical logic (recording, playback, edits, history) is pure and lives in src/looper/; this module
// only owns time: the record / count-in state machine, driven by the music scheduler's ticks.

import { create } from 'zustand';
import { LIVE_LOOKAHEAD } from '../audio/engine';
import type { InstrumentId } from '../audio/instruments/types';
import { loopSlot, type MusicEvent } from '../events/types';
import { downloadBytes, fileStamp, safeName } from '../export/download';
import { toMidiFile } from '../export/midiFile';
import { renderProject } from '../export/offlineRender';
import { encodeWav, type BitDepth } from '../export/wav';
import { makeZip } from '../export/zip';
import * as edit from '../looper/edit';
import {
  canRedo,
  canUndo,
  commit,
  createHistory,
  redo,
  replace,
  undo,
  type History,
} from '../looper/history';
import {
  audibleTracks,
  BEATS_PER_BAR,
  emptyProject,
  loopTicks,
  PPQ,
  wrapTick,
  type LoopProject,
  type Part,
  type TrackInstrument,
} from '../looper/model';
import { compareEvents, loopEvents, resumeEvents, type LoopClock } from '../looper/player';
import { buildTake, isLiveEvent, LiveTracker, placeTake } from '../looper/recorder';
import { parseProject } from '../looper/schema';
import type { LooperAction } from '../mapping/types';
import type { Grid } from '../performance/transport';
import { beatAt, timeAtBeat } from '../performance/transport';
import {
  bus,
  getEngine,
  grooveControls,
  onSchedulerTick,
  onSessionStop,
  setLooperActionHandler,
  transport,
  useGroove,
  useMusic,
} from './music';

export type LengthMode = 'auto' | 1 | 2 | 4 | 8;
export type OverdubMode = 'new' | 'merge';
export type RecPhase = 'off' | 'countIn' | 'recording';

interface LooperUi {
  project: LoopProject;
  canUndo: boolean;
  canRedo: boolean;
  playing: boolean;
  rec: RecPhase;
  /** Bars of count-in before the first take (0–2). */
  countIn: 0 | 1 | 2;
  /** 'auto' = the first take sets the loop length when you stop it. */
  length: LengthMode;
  overdub: OverdubMode;
  /** Click while recording. */
  metronome: boolean;
  /** Loop position "bar.beat" while playing or recording. */
  position: string;
  /** 0..1 through the loop (piano roll playhead). */
  phase: number;
  selected: string | null;
  /** Piano roll drawer open. */
  rollOpen: boolean;
  message: string | null;
  exporting: string | null;
}

const STORAGE_KEY = 'handwave.loop.v1';
const SETTINGS_KEY = 'handwave.looper.settings.v1';

function load<T>(key: string, parse: (x: unknown) => T | null): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? parse(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

const savedSettings = load(
  SETTINGS_KEY,
  (x) => x as Partial<Pick<LooperUi, 'countIn' | 'length' | 'overdub' | 'metronome'>>,
);

let history: History<LoopProject> = createHistory(load(STORAGE_KEY, parseProject) ?? emptyProject());

export const useLooper = create<LooperUi>()(() => ({
  project: history.present,
  canUndo: false,
  canRedo: false,
  playing: false,
  rec: 'off',
  countIn: savedSettings?.countIn ?? 1,
  length: savedSettings?.length ?? 'auto',
  overdub: savedSettings?.overdub ?? 'new',
  metronome: savedSettings?.metronome ?? true,
  position: '',
  phase: 0,
  selected: history.present.tracks[0]?.id ?? null,
  rollOpen: false,
  message: null,
  exporting: null,
}));

useLooper.subscribe((s, prev) => {
  if (
    s.countIn !== prev.countIn ||
    s.length !== prev.length ||
    s.overdub !== prev.overdub ||
    s.metronome !== prev.metronome
  ) {
    try {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ countIn: s.countIn, length: s.length, overdub: s.overdub, metronome: s.metronome }),
      );
    } catch {
      /* storage full or blocked: settings just won't persist */
    }
  }
});

// ---- runtime state ----------------------------------------------------------------------------------------

interface Recording {
  phase: 'countIn' | 'recording';
  /** Transport beat and audio time where the take starts. */
  startBeat: number;
  start: number;
  /** Where it ends (null = the first take with an open length: set when you press stop). */
  end: number | null;
  first: boolean;
  /** Ticks into the loop where an overdub starts. */
  offset: number;
  /** First beat to click on (count-in starts here). */
  clickFromBeat: number;
}

let playing = false;
/** Transport beat of loop tick 0. */
let loopStartBeat = 0;
/** Playback emits nothing before this time (a first take's loop begins when the take ends). */
let playFrom = 0;
let rec: Recording | null = null;
/** Live events since `baseline` (folded into it once they can no longer matter). */
const baseline = new LiveTracker();
let buffer: MusicEvent[] = [];
/** What the engine currently has, to apply only the differences. */
let engineTracks = new Map<string, { instrument: TrackInstrument; gainDb: number; notes: unknown }>();
let audible = new Set<string>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

const project = () => history.present;
const clock = (): LoopClock => ({ transport: transport.get(), startBeat: loopStartBeat });
const now = () => (getEngine()?.now() ?? 0) + LIVE_LOOKAHEAD;

function liveInstruments(): Record<Part, TrackInstrument> {
  const m = useMusic.getState();
  return { chords: m.chordInstrument, melody: m.melodyInstrument, bass: 'subBass', drums: 'drums' };
}

function syncUi(patch: Partial<LooperUi> = {}) {
  const p = project();
  const selected = useLooper.getState().selected;
  useLooper.setState({
    project: p,
    canUndo: canUndo(history),
    canRedo: canRedo(history),
    playing,
    rec: rec?.phase ?? 'off',
    selected: selected && p.tracks.some((t) => t.id === selected) ? selected : (p.tracks[0]?.id ?? null),
    ...patch,
  });
}

function saveSoon() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(project()));
    } catch {
      useLooper.setState({
        message: 'This loop is too big to keep in browser storage; export it to keep it.',
      });
    }
  }, 400);
}

/** Bring the engine's looper tracks in line with the project, releasing / resuming what changed. */
function syncEngine() {
  const engine = getEngine();
  const p = project();
  if (!p.tracks.length) playing = false;
  if (!engine) return;
  const t = now();
  const events: MusicEvent[] = [];
  const ids = new Set(p.tracks.map((x) => x.id));
  for (const id of engineTracks.keys()) {
    if (ids.has(id)) continue;
    engine.removeTrack(id, t);
    engineTracks.delete(id);
  }
  const resume: string[] = [];
  const nextAudible = playing ? audibleTracks(p) : new Set<string>();
  for (const track of p.tracks) {
    const had = engineTracks.get(track.id);
    if (!had) {
      engine.addTrack(
        track.id,
        track.part,
        track.instrument,
        { gainDb: track.gainDb, brightness: track.brightness },
        t,
      );
    } else {
      if (had.instrument !== track.instrument && track.instrument !== 'drums')
        engine.setTrackInstrument(track.id, track.instrument as InstrumentId, t);
      if (had.gainDb !== track.gainDb) engine.setTrackGain(track.id, track.gainDb, t);
      // Notes edited while playing: whatever is sounding may no longer exist, so let go and pick up again.
      if (had.notes !== track.notes && playing && audible.has(track.id)) {
        events.push({ kind: 'slotRelease', slot: loopSlot(track.id), time: t });
        resume.push(track.id);
      }
    }
    engineTracks.set(track.id, { instrument: track.instrument, gainDb: track.gainDb, notes: track.notes });
  }
  for (const id of audible) {
    if (!nextAudible.has(id) && ids.has(id))
      events.push({ kind: 'slotRelease', slot: loopSlot(id), time: t });
  }
  for (const id of nextAudible) if (!audible.has(id)) resume.push(id);
  audible = nextAudible;
  if (playing && resume.length) events.push(...resumeEvents(p, resume, clock(), t));
  if (events.length) bus.emitAll(events);
}

function setProject(next: LoopProject, undoable = true) {
  history = undoable ? commit(history, next) : replace(history, next);
  syncEngine();
  syncUi();
  saveSoon();
}

/** One undo step for a whole gesture (a piano-roll drag): `base` is the state before it began. */
function commitFrom(base: LoopProject, next: LoopProject) {
  history = { past: [...history.past, base].slice(-100), present: next, future: [] };
  syncEngine();
  syncUi();
  saveSoon();
}

// ---- recording --------------------------------------------------------------------------------------------

bus.on((e) => {
  if (isLiveEvent(e) && e.kind !== 'transport') buffer.push(e);
});

/** Fold events that can no longer change into the baseline (keeps the buffer small). */
function foldBuffer(t: number) {
  // Events are always scheduled ahead, so nothing older than a second can still arrive out of order.
  const limit = Math.min(t - 1, rec ? rec.start : Infinity);
  if (!buffer.some((e) => e.time < limit)) return;
  const old = buffer.filter((e) => e.time < limit).sort((a, b) => a.time - b.time);
  buffer = buffer.filter((e) => e.time >= limit);
  for (const e of old) baseline.apply(e);
}

const nextBarBeat = (beat: number) => Math.ceil(beat / BEATS_PER_BAR - 1e-6) * BEATS_PER_BAR;

function startRecording() {
  const engine = getEngine();
  if (!engine) return;
  const s = useLooper.getState();
  const t = now();
  const p = project();
  const hasLoop = p.bars > 0 && p.tracks.length > 0;
  const busy = transport.busy() || playing;
  // With nothing rhythmic running, the count-in starts right now; otherwise the take starts on a bar line.
  let startBeat: number;
  let clickFromBeat: number;
  if (!busy) {
    transport.reanchor(t + 0.03);
    startBeat = s.countIn * BEATS_PER_BAR;
    clickFromBeat = 0;
  } else {
    const beatNow = beatAt(transport.get(), t);
    startBeat = nextBarBeat(beatNow) + Math.max(0, s.countIn - 1) * BEATS_PER_BAR;
    clickFromBeat = Math.ceil(beatNow);
  }
  const tr = transport.get();
  if (!hasLoop) {
    const fixed = s.length === 'auto' ? null : s.length;
    rec = {
      phase: 'countIn',
      startBeat,
      start: timeAtBeat(tr, startBeat),
      end: fixed ? timeAtBeat(tr, startBeat + fixed * BEATS_PER_BAR) : null,
      first: true,
      offset: 0,
      clickFromBeat,
    };
  } else {
    // Overdub: one full pass round the loop. A stopped loop starts with the take (after any count-in).
    const wasPlaying = playing;
    if (!playing) {
      playing = true;
      loopStartBeat = startBeat;
      playFrom = timeAtBeat(tr, startBeat);
      syncEngine();
    } else {
      startBeat = nextBarBeat(beatAt(tr, t));
    }
    const offset = wrapTick(Math.round((startBeat - loopStartBeat) * PPQ), loopTicks(p));
    rec = {
      phase: 'countIn',
      startBeat,
      start: timeAtBeat(tr, startBeat),
      end: timeAtBeat(tr, startBeat + p.bars * BEATS_PER_BAR),
      first: false,
      offset,
      clickFromBeat: wasPlaying ? startBeat : clickFromBeat,
    };
  }
  syncUi({ message: null });
}

/** Pressing record again: close the take on a bar line. */
function closeRecording() {
  if (!rec) return;
  if (rec.phase === 'countIn') {
    rec = null;
    syncUi({ message: 'Recording cancelled.' });
    return;
  }
  const tr = transport.get();
  const beat = beatAt(tr, now());
  if (rec.first && rec.end === null) {
    const bars = Math.max(1, Math.round((beat - rec.startBeat) / BEATS_PER_BAR));
    rec.end = timeAtBeat(tr, rec.startBeat + bars * BEATS_PER_BAR);
  } else if (rec.end !== null) {
    const bar = Math.max(nextBarBeat(beat), rec.startBeat + BEATS_PER_BAR);
    rec.end = Math.min(rec.end, timeAtBeat(tr, bar));
  }
}

function commitTake(from: number) {
  const r = rec;
  if (!r || r.end === null) return;
  rec = null;
  const engine = getEngine();
  const tr = transport.get();
  const take = buildTake(baseline, buffer, r.start, r.end, (time) =>
    Math.round((beatAt(tr, time) - r.startBeat) * PPQ),
  );
  let p = project();
  if (r.first) {
    const m = useMusic.getState();
    const bars = Math.max(1, Math.round((beatAt(tr, r.end) - r.startBeat) / BEATS_PER_BAR));
    p = { ...p, bars, bpm: tr.bpm, key: { tonic: m.tonic, mode: m.mode } };
  }
  const before = project();
  const placed = placeTake(p, take, {
    loopLength: loopTicks(p),
    offset: r.offset,
    mode: useLooper.getState().overdub,
    instruments: liveInstruments(),
  });
  if (!placed.added.length && !placed.merged.length) {
    syncUi({ message: r.first ? 'Nothing was played, so nothing was recorded.' : 'Nothing new this pass.' });
    return;
  }
  if (r.first) {
    playing = true;
    loopStartBeat = r.startBeat;
    playFrom = r.end;
  }
  history = commit(history, placed.project);
  syncEngine();
  // The loop now plays the drums it recorded: hand them over instead of doubling them. Live drums are
  // already scheduled up to `from`, so the loop's drums take over from there.
  const handOff = !!take.parts.drums?.notes.length && transport.liveDrums();
  if (handOff) grooveControls.setDrums(false);
  // The scheduler already covered [r.end, from) before these tracks existed: send their share now.
  if (engine && from > r.end) {
    const drumTracks = new Set(placed.project.tracks.filter((t) => t.part === 'drums').map((t) => t.id));
    const changed = new Set(
      [...placed.added, ...placed.merged].filter((id) => audible.has(id) && !(handOff && drumTracks.has(id))),
    );
    const catchFrom = Math.max(r.end, engine.now() + 0.002);
    const fresh = loopEvents(placed.project, clock(), catchFrom, from, { audible: changed });
    const old = new Set(
      loopEvents(before, clock(), catchFrom, from, { audible: changed }).map((e) => JSON.stringify(e)),
    );
    const missing = fresh.filter((e) => !old.has(JSON.stringify(e)));
    if (missing.length) bus.emitAll(missing.sort(compareEvents));
  }
  let message: string | null = handOff
    ? 'The loop has the drums now (live drums off — press D to bring them back).'
    : null;
  if (placed.dropped.length)
    message = `Track limit reached: the ${placed.dropped.join(' and ')} part wasn't kept.`;
  syncUi({ message, selected: placed.added[0] ?? useLooper.getState().selected });
  saveSoon();
}

// ---- the clock -------------------------------------------------------------------------------------------

function clicks(from: number, to: number) {
  const engine = getEngine();
  if (!engine || !rec) return;
  const tr = transport.get();
  const metronome = useLooper.getState().metronome;
  const last = rec.end ? beatAt(tr, rec.end) : Infinity;
  for (let b = Math.max(rec.clickFromBeat, Math.ceil(beatAt(tr, from) - 1e-9)); ; b++) {
    const t = timeAtBeat(tr, b);
    if (t >= to || b >= last) break;
    if (t < from) continue;
    const counting = b < rec.startBeat;
    if (counting || metronome) engine.click(t, b % BEATS_PER_BAR === 0);
  }
}

onSchedulerTick((tNow, from, to) => {
  foldBuffer(tNow);
  if (rec?.phase === 'countIn' && tNow + LIVE_LOOKAHEAD >= rec.start) {
    rec.phase = 'recording';
    syncUi();
  }
  if (rec && to > from) clicks(from, to);
  if (rec?.end != null && tNow + LIVE_LOOKAHEAD >= rec.end) commitTake(from);
  const p = project();
  if (playing && to > from) {
    const start = Math.max(from, playFrom);
    if (to > start) {
      const events = loopEvents(p, clock(), start, to, { audible });
      if (events.length) bus.emitAll(events);
    }
  }
  // Keep the project's tempo in step with the transport (exports use it).
  const bpm = transport.get().bpm;
  if (p.tracks.length && Math.abs(p.bpm - bpm) > 1e-6) history = replace(history, { ...p, bpm });
  updatePosition(tNow);
});

function updatePosition(tNow: number) {
  const p = project();
  const tr = transport.get();
  let position = '';
  let phase = 0;
  if (rec && (rec.first || !playing)) {
    const beat = beatAt(tr, tNow) - rec.startBeat;
    position =
      beat < 0
        ? `count-in ${Math.ceil(-beat)}`
        : `${Math.floor(beat / BEATS_PER_BAR) + 1}.${(Math.floor(beat) % BEATS_PER_BAR) + 1}`;
  } else if (playing && p.bars > 0) {
    const beat = beatAt(tr, tNow) - loopStartBeat;
    if (beat < 0) position = `count-in ${Math.ceil(-beat)}`;
    else {
      const inLoop = beat % (p.bars * BEATS_PER_BAR);
      position = `${Math.floor(inLoop / BEATS_PER_BAR) + 1}.${(Math.floor(inLoop) % BEATS_PER_BAR) + 1}`;
      phase = inLoop / (p.bars * BEATS_PER_BAR);
    }
  }
  const s = useLooper.getState();
  if (s.position !== position || Math.abs(s.phase - phase) > 0.004) useLooper.setState({ position, phase });
}

// ---- transport controls ---------------------------------------------------------------------------------

function startPlayback() {
  const p = project();
  if (!p.tracks.length || !getEngine()) return;
  const t = now();
  if (!transport.busy()) {
    transport.reanchor(t + 0.02);
    loopStartBeat = 0;
  } else {
    loopStartBeat = nextBarBeat(beatAt(transport.get(), t));
  }
  playFrom = timeAtBeat(transport.get(), loopStartBeat);
  playing = true;
  syncEngine();
  syncUi();
}

function stopPlayback() {
  if (rec && !rec.first && rec.phase === 'recording') {
    rec.end = now();
    commitTake(rec.end);
  }
  rec = null;
  playing = false;
  syncEngine();
  getEngine()?.releaseTracks(now());
  syncUi();
}

export const looper = {
  recordToggle: () => {
    if (!getEngine()) return;
    if (rec) closeRecording();
    else startRecording();
    syncUi();
  },
  playToggle: () => {
    if (rec?.first) return looper.recordToggle(); // closing the first take starts the loop
    if (playing) stopPlayback();
    else startPlayback();
  },
  undo: () => {
    history = undo(history);
    syncEngine();
    syncUi();
    saveSoon();
  },
  redo: () => {
    history = redo(history);
    syncEngine();
    syncUi();
    saveSoon();
  },
  clear: () => {
    rec = null;
    setProject(edit.clearProject(project()));
  },
  select: (id: string | null) => useLooper.setState({ selected: id }),
  openRoll: (id: string | null, open = true) =>
    useLooper.setState((s) => ({ selected: id ?? s.selected, rollOpen: open })),
  setSettings: (patch: Partial<Pick<LooperUi, 'countIn' | 'length' | 'overdub' | 'metronome'>>) =>
    useLooper.setState(patch),
  // Performance controls: not undo steps.
  setMute: (id: string, v: boolean) => setProject(edit.setMute(project(), id, v), false),
  setSolo: (id: string, v: boolean) => setProject(edit.setSolo(project(), id, v), false),
  setGain: (id: string, db: number) => setProject(edit.setGain(project(), id, db), false),
  // Edits: undoable.
  setInstrument: (id: string, instrument: TrackInstrument) =>
    setProject(edit.setInstrument(project(), id, instrument)),
  rename: (id: string, name: string) => setProject(edit.renameTrack(project(), id, name)),
  remove: (id: string) => setProject(edit.removeTrack(project(), id)),
  quantize: (id: string, grid: Exclude<Grid, 'off'>, strength: number) =>
    setProject(edit.quantizeTrack(project(), id, grid, strength)),
  /** Piano roll: apply an edit now; with `base`, record it as one undo step from that state. */
  edit: (fn: (p: LoopProject) => LoopProject, base?: LoopProject) => {
    const next = fn(project());
    if (base) commitFrom(base, next);
    else setProject(next);
  },
  /** Live preview during a drag (no undo step until the drag ends with edit(fn, base)). */
  preview: (next: LoopProject) => setProject(next, false),
  snapshot: () => project(),
};

setLooperActionHandler((a: LooperAction) => {
  if (a.type === 'looper.recordToggle') looper.recordToggle();
  else if (a.type === 'looper.playToggle') looper.playToggle();
  else if (a.type === 'looper.undo') looper.undo();
  else looper.redo();
});

onSessionStop(() => {
  rec = null;
  playing = false;
  syncEngine();
  getEngine()?.releaseTracks(now());
  syncUi();
});

// When audio starts, put the (restored) project's tracks into the new engine.
useMusic.subscribe((s, prev) => {
  if (s.status === 'on' && prev.status !== 'on') {
    engineTracks = new Map();
    audible = new Set();
    syncEngine();
  }
});

// ---- export ---------------------------------------------------------------------------------------------

const exportName = () => fileStamp('handwave-loop');

export async function exportMidi(): Promise<void> {
  const p = project();
  if (!p.tracks.length) return;
  downloadBytes(toMidiFile(p), `${exportName()}.mid`, 'audio/midi');
}

export async function exportAudio(opts: {
  stems: boolean;
  bitDepth: BitDepth;
  cycles: number;
}): Promise<void> {
  const p = project();
  if (!p.tracks.length || useLooper.getState().exporting) return;
  const name = exportName();
  try {
    const r = await renderProject(p, {
      stems: opts.stems,
      cycles: opts.cycles,
      tailSec: 3,
      params: [['fx.duck', useGroove.getState().duck]],
      onProgress: (done, total) =>
        useLooper.setState({ exporting: total > 1 ? `Rendering ${done} / ${total}…` : 'Rendering…' }),
    });
    const wav = (a: { channels: Float32Array[]; sampleRate: number }) =>
      encodeWav(a.channels, a.sampleRate, opts.bitDepth);
    if (!opts.stems) {
      downloadBytes(wav(r.mix), `${name}.wav`, 'audio/wav');
    } else {
      const used = new Map<string, number>();
      const entries = [{ name: `${name}/mix.wav`, data: wav(r.mix) }];
      for (const s of r.stems) {
        const base = safeName(s.track.name);
        const n = (used.get(base) ?? 0) + 1;
        used.set(base, n);
        entries.push({ name: `${name}/${n > 1 ? `${base}-${n}` : base}.wav`, data: wav(s.audio) });
      }
      downloadBytes(makeZip(entries), `${name}-stems.zip`, 'application/zip');
    }
    useLooper.setState({ exporting: null, message: null });
  } catch (err) {
    console.error('[export] render failed', err);
    useLooper.setState({
      exporting: null,
      message: `Export failed: ${err instanceof Error ? err.message : err}`,
    });
  }
}
