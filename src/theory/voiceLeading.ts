// Automatic voice leading: choose the voicing of the next chord that moves the voices the least.

import type { Chord } from './chords';
import { notesInRange, type Midi, type PitchClass } from './notes';

export interface VoicingOptions {
  /** Inclusive MIDI range the voices must sit in, e.g. [52, 76]. */
  register: [Midi, Midi];
  /** Number of voices (3–6). Tones are doubled (root, then fifth) or omitted (fifth first) to fit. */
  voices: number;
  /** Penalize any single voice moving further than this (semitones). */
  maxLeap?: number;
  /** Nudge the register centre down (-1) or up (+1) by a fourth. */
  inversionBias?: -1 | 0 | 1;
  /** Require the root as the lowest voice (when no separate bass instrument plays it). */
  rootInBass?: boolean;
  /** Maximum span of the voicing in semitones. */
  maxSpan?: number;
}

export const DEFAULT_VOICING: VoicingOptions = { register: [52, 76], voices: 4, maxLeap: 7, maxSpan: 19 };

/** Pitch classes to voice: the chord's tones fitted to `voices` by doubling or omitting. */
export function tonesToVoice(chord: Chord, voices: number): PitchClass[] {
  const tones = [...chord.pitchClasses];
  const root = tones[0]!;
  const fifthIdx = chord.intervals.findIndex((i) => i === 7 || i === 6 || i === 8);
  while (tones.length > voices) {
    // Drop the fifth first (it adds the least colour), then the root (the bass plays it).
    const drop =
      fifthIdx >= 0 && tones.includes(chord.pitchClasses[fifthIdx]!) && tones.length > 3
        ? tones.indexOf(chord.pitchClasses[fifthIdx]!)
        : tones.indexOf(root) >= 0 && tones.length > 3
          ? tones.indexOf(root)
          : tones.length - 1;
    tones.splice(drop, 1);
  }
  const doubles = [root, fifthIdx >= 0 ? chord.pitchClasses[fifthIdx]! : root, chord.pitchClasses[1] ?? root];
  for (let k = 0; tones.length < voices; k++) tones.push(doubles[k % doubles.length]!);
  return tones;
}

/**
 * Alternative tone sets for the voice count, each with a small musical penalty: doubling the root is
 * best, then the fifth, then the third; omitting the fifth is free, the root costs a little. Letting the
 * voice leader pick among them is what keeps every voice moving by step.
 */
export function toneOptions(chord: Chord, voices: number): Array<{ tones: PitchClass[]; penalty: number }> {
  const base = tonesToVoice(chord, Math.min(voices, chord.pitchClasses.length));
  if (voices <= chord.pitchClasses.length) {
    const opts = [{ tones: base, penalty: 0 }];
    if (chord.pitchClasses.length > voices && voices >= 3) {
      // Alternative: keep the fifth, drop the root.
      const alt = chord.pitchClasses.filter((p) => p !== chord.root).slice(0, voices);
      if (alt.length === voices) opts.push({ tones: alt, penalty: 0.5 });
    }
    return opts;
  }
  const root = chord.root;
  const fifthIdx = chord.intervals.findIndex((i) => i === 7 || i === 6 || i === 8);
  const fifth = fifthIdx >= 0 ? chord.pitchClasses[fifthIdx]! : null;
  const third = chord.pitchClasses[1]!;
  const doubles: Array<[PitchClass, number]> = [[root, 0]];
  if (fifth !== null) doubles.push([fifth, 0.5]);
  doubles.push([third, 1.5]);
  const extra = voices - base.length;
  const out: Array<{ tones: PitchClass[]; penalty: number }> = [];
  for (const [p, pen] of doubles) {
    out.push({
      tones: [...base, ...Array.from({ length: extra }, (_, k) => (k === 0 ? p : root))],
      penalty: pen,
    });
  }
  return out;
}

export interface VoicePair {
  from: Midi | null;
  to: Midi | null;
}

/** Cost of adding or removing a voice in a matching, in semitones of movement. */
const GAP_COST = 6;

/**
 * Optimal pairing of old voices to new notes (min total movement; unmatched voices start or stop).
 * On a line, an optimal matching never crosses, so a sequence-alignment DP over sorted notes is exact.
 */
export function assignVoices(prev: readonly Midi[], next: readonly Midi[]): VoicePair[] {
  const a = [...prev].sort((x, y) => x - y);
  const b = [...next].sort((x, y) => x - y);
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 1; i <= n; i++) dp[i]![0] = i * GAP_COST;
  for (let j = 1; j <= m; j++) dp[0]![j] = j * GAP_COST;
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      dp[i]![j] = Math.min(
        dp[i - 1]![j - 1]! + Math.abs(a[i - 1]! - b[j - 1]!),
        dp[i - 1]![j]! + GAP_COST,
        dp[i]![j - 1]! + GAP_COST,
      );
  const pairs: VoicePair[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && dp[i]![j] === dp[i - 1]![j - 1]! + Math.abs(a[i - 1]! - b[j - 1]!)) {
      pairs.push({ from: a[i - 1]!, to: b[j - 1]! });
      i--;
      j--;
    } else if (i > 0 && dp[i]![j] === dp[i - 1]![j]! + GAP_COST) {
      pairs.push({ from: a[i - 1]!, to: null });
      i--;
    } else {
      pairs.push({ from: null, to: b[j - 1]! });
      j--;
    }
  }
  return pairs.reverse();
}

/** Total movement of a matching. */
export function movementCost(prev: readonly Midi[], next: readonly Midi[]): number {
  return assignVoices(prev, next).reduce(
    (acc, p) => acc + (p.from !== null && p.to !== null ? Math.abs(p.from - p.to) : GAP_COST),
    0,
  );
}

/** Every voicing of `tones` (one MIDI note per tone) inside the register, de-duplicated and sorted. */
function candidates(tones: PitchClass[], lo: Midi, hi: Midi, maxSpan: number): Midi[][] {
  const options = tones.map((p) => notesInRange(p, lo, hi));
  const out: Midi[][] = [];
  const seen = new Set<string>();
  const cur: Midi[] = [];
  const rec = (k: number) => {
    if (k === tones.length) {
      const v = [...cur].sort((x, y) => x - y);
      if (new Set(v).size !== v.length) return; // two voices on one note
      if (v[v.length - 1]! - v[0]! > maxSpan) return;
      const id = v.join(',');
      if (!seen.has(id)) {
        seen.add(id);
        out.push(v);
      }
      return;
    }
    for (const m of options[k]!) {
      cur.push(m);
      rec(k + 1);
      cur.pop();
    }
  };
  rec(0);
  return out;
}

/** Penalty for voicings that sound muddy (close intervals low down) or thin (huge gaps). */
function colourPenalty(v: Midi[]): number {
  let p = 0;
  for (let i = 1; i < v.length; i++) {
    const gap = v[i]! - v[i - 1]!;
    const low = v[i - 1]!;
    if (low < 48 && gap < 7) p += (7 - gap) * 0.8;
    else if (low < 55 && gap < 3) p += (3 - gap) * 0.6;
    if (gap > 12) p += (gap - 12) * 0.5;
  }
  return p;
}

/**
 * Voice `chord` so that it moves least from `prev` (sum of semitone motion under the optimal pairing),
 * with gentle pulls toward the register centre (no drift over long progressions) and away from muddy
 * spacings. Deterministic: ties prefer more common tones, then the lower voicing.
 */
export function voiceLead(
  prev: readonly Midi[] | null,
  chord: Chord,
  opts: VoicingOptions = DEFAULT_VOICING,
): Midi[] {
  const shift = (opts.inversionBias ?? 0) * 5;
  const lo = opts.register[0] + shift;
  const hi = opts.register[1] + shift;
  const voices = Math.max(1, Math.min(6, opts.voices));
  let pool: Array<{ v: Midi[]; penalty: number }> = [];
  for (const { tones, penalty } of toneOptions(chord, voices)) {
    for (const v of candidates(tones, lo, hi, opts.maxSpan ?? 19)) pool.push({ v, penalty });
  }
  if (opts.rootInBass) {
    const rooted = pool.filter(({ v }) => ((v[0]! % 12) + 12) % 12 === chord.root);
    if (rooted.length) pool = rooted;
  }
  if (!pool.length)
    pool = candidates(tonesToVoice(chord, voices), lo - 12, hi + 12, 24).map((v) => ({ v, penalty: 0 }));
  if (!pool.length) return [];

  const center = (lo + hi) / 2;
  const mean = (v: Midi[]) => v.reduce((a, b) => a + b, 0) / v.length;

  let best: Midi[] = pool[0]!.v;
  let bestCost = Infinity;
  let bestCommon = -1;
  for (const { v, penalty } of pool) {
    let cost = penalty + colourPenalty(v) + 0.25 * Math.abs(mean(v) - center);
    let common = 0;
    if (prev && prev.length) {
      cost += movementCost(prev, v);
      for (const pair of assignVoices(prev, v)) {
        if (pair.from !== null && pair.to !== null) {
          if (pair.from === pair.to) common++;
          if (opts.maxLeap !== undefined && Math.abs(pair.from - pair.to) > opts.maxLeap)
            cost += (Math.abs(pair.from - pair.to) - opts.maxLeap) * 2;
        }
      }
    } else {
      // First chord: compact, centred, root at the bottom if possible.
      cost += (v[v.length - 1]! - v[0]!) * 0.3 + (((v[0]! % 12) + 12) % 12 === chord.root ? 0 : 2);
    }
    const better =
      cost < bestCost - 1e-9 ||
      (Math.abs(cost - bestCost) <= 1e-9 &&
        (common > bestCommon || (common === bestCommon && v[0]! < best[0]!)));
    if (better) {
      best = v;
      bestCost = cost;
      bestCommon = common;
    }
  }
  return best;
}
