import { pc, type PitchClass } from './notes';

export const MODES = ['ionian', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'aeolian', 'locrian'] as const;
export type Mode = (typeof MODES)[number];

export interface Key {
  tonic: PitchClass;
  mode: Mode;
}

export const MODE_INTERVALS: Record<Mode, readonly number[]> = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
};

export const MODE_LABEL: Record<Mode, string> = {
  ionian: 'Major (Ionian)',
  dorian: 'Dorian',
  phrygian: 'Phrygian',
  lydian: 'Lydian',
  mixolydian: 'Mixolydian',
  aeolian: 'Minor (Aeolian)',
  locrian: 'Locrian',
};

/** Where each mode starts within its parent major scale. */
const MODE_OFFSET: Record<Mode, number> = {
  ionian: 0,
  dorian: 2,
  phrygian: 4,
  lydian: 5,
  mixolydian: 7,
  aeolian: 9,
  locrian: 11,
};

/** Modes whose tonic triad is major (or at least has a major third). */
export const isMajorMode = (m: Mode): boolean => MODE_INTERVALS[m][2] === 4;

/** The parallel mode used for modal interchange: major-family modes borrow from Aeolian, minor-family from Ionian. */
export const parallelMode = (m: Mode): Mode => (isMajorMode(m) ? 'aeolian' : 'ionian');

export function scaleOf(key: Key): PitchClass[] {
  return MODE_INTERVALS[key.mode].map((i) => pc(key.tonic + i));
}

/** Prefer flats when the parent major key is written with flats (F, B♭, E♭, A♭, D♭, G♭). */
export function prefersFlats(key: Key): boolean {
  const parent = pc(key.tonic - MODE_OFFSET[key.mode]);
  return [5, 10, 3, 8, 1, 6].includes(parent);
}
