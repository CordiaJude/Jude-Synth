// Offline WAV render of a loop project through the real engine (Tone.Offline): sample-accurate, faster
// than real time, no dropouts. The mix and each stem are separate renders, so every stem has its own
// reverb/delay tails and the limiter only shapes the mix.

import * as Tone from 'tone';
import { AudioEngine } from '../audio/engine';
import type { ParamPath } from '../events/types';
import { audibleTracks, BEATS_PER_BAR, type LoopProject, type LoopTrack } from '../looper/model';
import { loopEvents, type LoopClock } from '../looper/player';
import { timeAtBeat } from '../performance/transport';

/** Lead-in before the first beat (s): lets the engine settle before anything sounds. */
export const RENDER_START = 0.05;

export interface RenderOptions {
  /** Render each audible track on its own as well. */
  stems?: boolean;
  /** Times through the loop (default 1). */
  cycles?: number;
  /** Seconds of release / reverb tail after the last bar (default 3). */
  tailSec?: number;
  sampleRate?: number;
  /** Engine settings to match the live mix (e.g. sidechain depth). */
  params?: Array<[ParamPath, number]>;
  /** false = dry (no chorus / delay / reverb / tape): for tests. */
  fx?: boolean;
  onProgress?: (done: number, total: number) => void;
}

export interface RenderedAudio {
  sampleRate: number;
  channels: Float32Array[];
}

export interface RenderResult {
  mix: RenderedAudio;
  stems: Array<{ track: LoopTrack; audio: RenderedAudio }>;
  seconds: number;
}

export function renderLength(p: LoopProject, cycles: number, tailSec: number): number {
  const end = timeAtBeat({ bpm: p.bpm, origin: RENDER_START }, cycles * p.bars * BEATS_PER_BAR);
  return end + tailSec;
}

/** Render the given tracks of `p` (one offline pass). */
export async function renderTracks(
  p: LoopProject,
  ids: ReadonlySet<string>,
  opts: Omit<RenderOptions, 'stems' | 'onProgress'> = {},
): Promise<RenderedAudio> {
  const cycles = opts.cycles ?? 1;
  const sampleRate = opts.sampleRate ?? 48000;
  const seconds = renderLength(p, cycles, opts.tailSec ?? 3);
  const clock: LoopClock = { transport: { bpm: p.bpm, origin: RENDER_START }, startBeat: 0 };
  const buf = await Tone.Offline(
    async () => {
      const engine = await AudioEngine.create({
        chords: 'warmPoly',
        bass: null,
        melody: null,
        fx: opts.fx !== false,
        bpm: p.bpm,
      });
      for (const [path, v] of opts.params ?? []) engine.setParam(path, v, 0, 0.001);
      for (const t of p.tracks) {
        if (!ids.has(t.id)) continue;
        engine.addTrack(t.id, t.part, t.instrument, { gainDb: t.gainDb, brightness: t.brightness }, 0);
      }
      for (const e of loopEvents(p, clock, 0, seconds, { audible: ids, cycles })) engine.schedule(e);
    },
    seconds,
    2,
    sampleRate,
  );
  return { sampleRate, channels: [buf.getChannelData(0).slice(), buf.getChannelData(1).slice()] };
}

export async function renderProject(p: LoopProject, opts: RenderOptions = {}): Promise<RenderResult> {
  const audible = audibleTracks(p);
  const stemTracks = opts.stems ? p.tracks.filter((t) => audible.has(t.id)) : [];
  const total = 1 + stemTracks.length;
  opts.onProgress?.(0, total);
  const mix = await renderTracks(p, audible, opts);
  opts.onProgress?.(1, total);
  const stems: RenderResult['stems'] = [];
  for (const [i, track] of stemTracks.entries()) {
    stems.push({ track, audio: await renderTracks(p, new Set([track.id]), opts) });
    opts.onProgress?.(i + 2, total);
  }
  return { mix, stems, seconds: renderLength(p, opts.cycles ?? 1, opts.tailSec ?? 3) };
}
