// Musical time on the audio clock. A transport is just an origin (audio time of beat 0) and a tempo, so
// positions and grids are pure arithmetic — no timers involved.

export interface Transport {
  bpm: number;
  /** Audio-clock time (s) of beat 0. */
  origin: number;
}

export const secondsPerBeat = (bpm: number): number => 60 / bpm;

export const beatAt = (t: Transport, time: number): number => (time - t.origin) / secondsPerBeat(t.bpm);

export const timeAtBeat = (t: Transport, beat: number): number => t.origin + beat * secondsPerBeat(t.bpm);

/** Change tempo at `time` without jumping: the beat position at `time` is preserved. */
export function setTempo(t: Transport, bpm: number, time: number): Transport {
  const beat = beatAt(t, time);
  const clamped = Math.max(40, Math.min(220, bpm));
  return { bpm: clamped, origin: time - beat * secondsPerBeat(clamped) };
}

export type Grid = 'off' | '1/4' | '1/8' | '1/16' | '1/16T' | '1/32';

/** Grid size in beats (a beat = a quarter note). */
export const GRID_BEATS: Record<Exclude<Grid, 'off'>, number> = {
  '1/4': 1,
  '1/8': 0.5,
  '1/16': 0.25,
  '1/16T': 1 / 6,
  '1/32': 0.125,
};

export interface QuantizeSettings {
  grid: Grid;
  /** 0 = untouched, 1 = exactly on the grid. */
  strength: number;
  /** Random timing offset added after quantizing, ± ms. */
  humanizeMs: number;
  /** A grid line this recently passed still counts: play now instead of waiting for the next one. */
  lateToleranceMs: number;
}

export const DEFAULT_QUANTIZE: QuantizeSettings = {
  grid: 'off',
  strength: 1,
  humanizeMs: 0,
  lateToleranceMs: 30,
};

/**
 * Quantize a live event that would otherwise sound at `time` (already includes the scheduling lookahead).
 * Live input can't move backwards in time, so it is pulled forward toward the NEXT grid line — unless the
 * previous line passed within the late tolerance, in which case it plays right away (it was "on time").
 * Never returns a time earlier than `earliest`.
 */
export function quantizeTime(
  time: number,
  transport: Transport,
  q: QuantizeSettings,
  earliest: number,
  rng: () => number = Math.random,
): number {
  let out = time;
  if (q.grid !== 'off' && q.strength > 0) {
    const grid = GRID_BEATS[q.grid];
    const beat = beatAt(transport, time);
    const prevLine = Math.floor(beat / grid + 1e-9) * grid;
    const sinceLine = (beat - prevLine) * secondsPerBeat(transport.bpm);
    const target = sinceLine * 1000 <= q.lateToleranceMs ? time : timeAtBeat(transport, prevLine + grid);
    out = time + (target - time) * Math.min(1, q.strength);
  }
  if (q.humanizeMs > 0) {
    // Triangular distribution: most offsets small, never beyond ±humanizeMs.
    const r = (rng() + rng() - 1) * (q.humanizeMs / 1000);
    out += r;
  }
  return Math.max(earliest, out);
}
