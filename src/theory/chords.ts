// Diatonic chord generation for all seven modes, extended qualities, and modal interchange.

import { MODE_INTERVALS, parallelMode, prefersFlats, type Key } from './modes';
import { pc, pitchName, type PitchClass } from './notes';

export const CHORD_QUALITIES = [
  'maj', 'min', 'dim', 'aug', 'sus2', 'sus4',
  '7', 'maj7', 'm7', 'm7b5', 'dim7',
  'add9', 'madd9', '9', 'maj9', 'm9',
] as const; // prettier-ignore
export type ChordQuality = (typeof CHORD_QUALITIES)[number];

/** Semitones above the root. Ninths are written as 14 so voicing code knows they sit above the octave. */
export const QUALITY_INTERVALS: Record<ChordQuality, readonly number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  '7': [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  m7b5: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9],
  add9: [0, 4, 7, 14],
  madd9: [0, 3, 7, 14],
  '9': [0, 4, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14],
  m9: [0, 3, 7, 10, 14],
};

const QUALITY_SUFFIX: Record<ChordQuality, string> = {
  maj: '',
  min: 'm',
  dim: 'dim',
  aug: 'aug',
  sus2: 'sus2',
  sus4: 'sus4',
  '7': '7',
  maj7: 'maj7',
  m7: 'm7',
  m7b5: 'm7♭5',
  dim7: 'dim7',
  add9: 'add9',
  madd9: 'm(add9)',
  '9': '9',
  maj9: 'maj9',
  m9: 'm9',
};

export type Degree = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type Extension = 'triad' | 'seventh' | 'ninth';

/** Fixed borrowed / chromatic chords, named relative to the key. */
export const BORROWED_CHORDS = ['bVII', 'iv', 'bVI', 'bIII', 'ii°', 'V/V'] as const;
export type BorrowedChord = (typeof BORROWED_CHORDS)[number];

export interface ChordRequest {
  degree: Degree;
  /** Overrides `degree` with a fixed chromatic chord. */
  borrowed?: BorrowedChord;
  /** Take the chord on `degree` from the parallel mode (modal interchange): IV → iv, VI → ♭VI … */
  parallel?: boolean;
  /** Explicit quality on the (diatonic or borrowed) root; 'diatonic' (default) stacks scale thirds. */
  quality?: ChordQuality | 'diatonic';
  extension?: Extension;
}

export interface Chord {
  root: PitchClass;
  quality: ChordQuality;
  /** Root first, then the remaining tones in stacking order. */
  pitchClasses: PitchClass[];
  /** Semitones above the root (from QUALITY_INTERVALS). */
  intervals: readonly number[];
  /** Scale-degree number used for the Roman numeral (1–7). */
  degree: Degree;
  name: string;
  roman: string;
  /** All tones belong to the key's scale. */
  diatonic: boolean;
}

/** Identify the quality of a stack of intervals (0-based, may include 14 for a ninth). */
function qualityOf(intervals: number[]): ChordQuality | null {
  const key = intervals.join(',');
  for (const q of CHORD_QUALITIES) if (QUALITY_INTERVALS[q].join(',') === key) return q;
  return null;
}

/** Stack thirds from the scale starting on `degree` (1-based) → intervals above the root. */
function stackThirds(scaleIntervals: readonly number[], degree: Degree, count: number): number[] {
  const out: number[] = [];
  const rootOff = scaleIntervals[degree - 1]!;
  for (let k = 0; k < count; k++) {
    const idx = degree - 1 + k * 2;
    const octave = Math.floor(idx / 7) * 12;
    out.push(scaleIntervals[idx % 7]! + octave - rootOff);
  }
  return out;
}

function diatonicQuality(scaleIntervals: readonly number[], degree: Degree, ext: Extension): ChordQuality {
  const tri = stackThirds(scaleIntervals, degree, 3);
  const triad = qualityOf(tri) ?? 'maj';
  if (ext === 'triad') return triad;
  const sev = stackThirds(scaleIntervals, degree, 4);
  const seventh = qualityOf(sev) ?? triad;
  if (ext === 'seventh') return seventh;
  const nin = stackThirds(scaleIntervals, degree, 5);
  // A diatonic ♭9 (iii in major, vii, phrygian i…) sounds harsh: fall back to the seventh chord.
  if (nin[4] !== 14) return seventh;
  return qualityOf(nin) ?? seventh;
}

const MAJOR = MODE_INTERVALS.ionian;
const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'] as const;

const MINOR_FAMILY = new Set<ChordQuality>(['min', 'dim', 'm7', 'm7b5', 'dim7', 'madd9', 'm9']);
const ROMAN_SUFFIX: Record<ChordQuality, string> = {
  maj: '',
  min: '',
  dim: '°',
  aug: '+',
  sus2: 'sus2',
  sus4: 'sus4',
  '7': '7',
  maj7: 'maj7',
  m7: '7',
  m7b5: 'ø7',
  dim7: '°7',
  add9: 'add9',
  madd9: 'add9',
  '9': '9',
  maj9: 'maj9',
  m9: '9',
};

/**
 * Roman numeral relative to the MAJOR scale of the tonic, so borrowed chords read the way pop/jazz players
 * say them (♭VII, iv, ♭VI) in every mode. Lower case for minor/diminished qualities.
 */
export function romanNumeral(
  tonic: PitchClass,
  root: PitchClass,
  degree: Degree,
  quality: ChordQuality,
): string {
  const interval = pc(root - tonic);
  let diff = interval - MAJOR[degree - 1]!;
  if (diff > 6) diff -= 12;
  if (diff < -6) diff += 12;
  const acc = diff < 0 ? '♭'.repeat(-diff) : '♯'.repeat(diff);
  const base = NUMERALS[degree - 1]!;
  return `${acc}${MINOR_FAMILY.has(quality) ? base.toLowerCase() : base}${ROMAN_SUFFIX[quality]}`;
}

export function chordName(root: PitchClass, quality: ChordQuality, preferFlats: boolean): string {
  return `${pitchName(root, preferFlats)}${QUALITY_SUFFIX[quality]}`;
}

function build(key: Key, root: PitchClass, degree: Degree, quality: ChordQuality, flatHint: boolean): Chord {
  const intervals = QUALITY_INTERVALS[quality];
  const pitchClasses = intervals.map((i) => pc(root + i));
  const scale = new Set(MODE_INTERVALS[key.mode].map((i) => pc(key.tonic + i)));
  const roman = romanNumeral(key.tonic, root, degree, quality);
  const flats = prefersFlats(key) || roman.startsWith('♭') || flatHint;
  return {
    root,
    quality,
    pitchClasses,
    intervals,
    degree,
    name: chordName(root, quality, flats),
    roman,
    diatonic: pitchClasses.every((p) => scale.has(p)),
  };
}

const BORROWED: Record<
  BorrowedChord,
  { semis: number; degree: Degree; triad: ChordQuality; seventh: ChordQuality }
> = {
  bVII: { semis: 10, degree: 7, triad: 'maj', seventh: '7' },
  iv: { semis: 5, degree: 4, triad: 'min', seventh: 'm7' },
  bVI: { semis: 8, degree: 6, triad: 'maj', seventh: 'maj7' },
  bIII: { semis: 3, degree: 3, triad: 'maj', seventh: 'maj7' },
  'ii°': { semis: 2, degree: 2, triad: 'dim', seventh: 'm7b5' },
  'V/V': { semis: 2, degree: 2, triad: 'maj', seventh: '7' },
};

/** The chord for a request in a key: diatonic stacking, explicit quality, modal interchange or borrowed. */
export function diatonicChord(key: Key, req: ChordRequest): Chord {
  const ext = req.extension ?? 'triad';
  if (req.borrowed) {
    const b = BORROWED[req.borrowed];
    const root = pc(key.tonic + b.semis);
    const quality =
      req.quality && req.quality !== 'diatonic' ? req.quality : ext === 'triad' ? b.triad : b.seventh;
    const chord = build(key, root, b.degree, quality, false);
    return req.borrowed === 'V/V' ? { ...chord, roman: `V${quality === '7' ? '7' : ''}/V` } : chord;
  }
  const mode = req.parallel ? parallelMode(key.mode) : key.mode;
  const scaleIntervals = MODE_INTERVALS[mode];
  const root = pc(key.tonic + scaleIntervals[req.degree - 1]!);
  const quality =
    req.quality && req.quality !== 'diatonic'
      ? req.quality
      : diatonicQuality(scaleIntervals, req.degree, ext);
  return build(
    key,
    root,
    req.degree,
    quality,
    !!req.parallel && !MODE_INTERVALS.ionian.includes(scaleIntervals[req.degree - 1]!),
  );
}

/** All seven diatonic chords of a key (handy for UIs and tests). */
export function diatonicChords(key: Key, extension: Extension = 'triad'): Chord[] {
  return ([1, 2, 3, 4, 5, 6, 7] as const).map((degree) => diatonicChord(key, { degree, extension }));
}
