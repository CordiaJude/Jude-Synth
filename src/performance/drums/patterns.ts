// Drum patterns, written as 16-step strings per bar: x = accent, o = normal, . = ghost, - = rest.
// Original patterns in common genre idioms (no transcriptions of existing songs).

import type { DrumVoice } from '../../events/types';

export const GENRES = ['lofi', 'house', 'trap', 'synthwave'] as const;
export type Genre = (typeof GENRES)[number];

export type Bar = Partial<Record<DrumVoice, string>>;

export interface DrumPattern {
  name: string;
  /** Suggested tempo. */
  bpm: number;
  /** 0.5 = straight; 0.66 ≈ triplet shuffle (applied to off 16ths). */
  swing: number;
  bars: Bar[];
  fill: Bar;
}

export const PATTERNS: Record<Genre, DrumPattern> = {
  lofi: {
    name: 'Lo-fi',
    bpm: 82,
    swing: 0.6,
    bars: [
      {
        kick: 'x-----o---x-----',
        snare: '----x-------x---',
        hat: 'o-.-o-.-o-.-o-.o',
        rim: '-------.--------',
      },
      { kick: 'x-----o-o---x---', snare: '----x-------x--.', hat: 'o-.-o-.-o-.-o-o-' },
    ],
    fill: {
      kick: 'x-----o---------',
      snare: '----x---.-.-x.xx',
      hat: 'o-.-o-.-o-------',
      tom: '--------o--o----',
    },
  },
  house: {
    name: 'House',
    bpm: 124,
    swing: 0.54,
    bars: [
      {
        kick: 'x---x---x---x---',
        clap: '----x-------x---',
        hat: '--o---o---o---o-',
        openHat: '--------------o-',
      },
      {
        kick: 'x---x---x---x---',
        clap: '----x-------x---',
        hat: '--o---o---o-.-o-',
        rim: '-----o-----o----',
      },
    ],
    fill: { kick: 'x---x---x---xxxx', clap: '----x---x-x-xxxx', hat: '--o---o---o---o-' },
  },
  trap: {
    name: 'Trap',
    bpm: 140,
    swing: 0.5,
    bars: [
      {
        kick: 'x------o--x-----',
        snare: '--------x-------',
        hat: 'o-o-o-o-oooo-o-o',
        openHat: '--------------o-',
      },
      { kick: 'x--o------x--o--', snare: '--------x-------', hat: 'o-o-o-oooo-o-ooo' },
    ],
    fill: {
      kick: 'x-------x-x-----',
      snare: '--------x--o-oxx',
      hat: 'oooooooooooooooo',
      tom: '------------o-o-',
    },
  },
  synthwave: {
    name: 'Synthwave',
    bpm: 110,
    swing: 0.5,
    bars: [
      { kick: 'x-------x-------', snare: '----x-------x---', hat: 'o-o-o-o-o-o-o-o-' },
      {
        kick: 'x-------x-x-----',
        snare: '----x-------x---',
        hat: 'o-o-o-o-o-o-o-oo',
        openHat: '------o---------',
      },
    ],
    fill: {
      kick: 'x-------x-------',
      snare: '----x---x-x-xxxx',
      tom: '--------o-o-o-o-',
      hat: 'o-o-o-o---------',
    },
  },
};

export const STEP_VELOCITY: Record<string, number> = { x: 1, o: 0.72, '.': 0.42 };
