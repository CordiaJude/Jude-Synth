// Pitch basics: pitch classes, MIDI notes, frequencies and key-aware spelling.

export type PitchClass = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;
/** MIDI note number; may be fractional for free (unquantized) pitch. */
export type Midi = number;

export const SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'] as const;
export const FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'] as const;

export const pc = (n: number): PitchClass => (((Math.round(n) % 12) + 12) % 12) as PitchClass;

export const midiToFreq = (m: Midi): number => 440 * Math.pow(2, (m - 69) / 12);
export const freqToMidi = (f: number): Midi => 69 + 12 * Math.log2(f / 440);

export function pitchName(p: number, preferFlats: boolean): string {
  return (preferFlats ? FLAT_NAMES : SHARP_NAMES)[pc(p)]!;
}

/** "C4", "F♯2" (middle C = C4 = MIDI 60). */
export function noteName(m: Midi, preferFlats = false): string {
  const r = Math.round(m);
  return `${pitchName(r, preferFlats)}${Math.floor(r / 12) - 1}`;
}

/** The MIDI note with pitch class `p` closest to `near` (ties go down). */
export function nearestWithPc(p: PitchClass, near: Midi): Midi {
  const base = Math.round(near) - pc(Math.round(near)) + p;
  const candidates = [base - 12, base, base + 12];
  return candidates.reduce((best, c) => (Math.abs(c - near) < Math.abs(best - near) ? c : best));
}

/** All MIDI notes with pitch class `p` inside [lo, hi]. */
export function notesInRange(p: PitchClass, lo: Midi, hi: Midi): Midi[] {
  const out: Midi[] = [];
  let m = Math.ceil(lo) + ((p - pc(Math.ceil(lo)) + 12) % 12);
  for (; m <= hi; m += 12) out.push(m);
  return out;
}
