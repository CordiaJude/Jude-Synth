import type { ChordTransition } from '../../events/types';

export type InstrumentId = 'supersawPad' | 'warmPoly' | 'subBass' | 'testSine';
export type MacroId = 'brightness' | 'space' | 'motion' | 'grit';

export interface Adsr {
  attack: number;
  decay: number;
  /** 0..1 of the peak level. */
  sustain: number;
  release: number;
}

export interface OscSpec {
  type: OscillatorType;
  /** Octave offset from the played note. */
  octave?: number;
  /** Static detune in cents. */
  detune?: number;
  /** How much the `motion` macro widens this oscillator's detune (cents per unit of spread). */
  spread?: number;
  gain: number;
  pan?: number;
}

export interface FilterSpec {
  type: BiquadFilterType;
  Q: number;
  /** Cutoff range swept by the `brightness` macro (Hz, exponential). */
  cutoff: [number, number];
  /** 0 = fixed cutoff, 1 = cutoff follows pitch fully. */
  keyTrack: number;
  /** Filter envelope, in cents added to the cutoff. */
  env: { amount: number; attack: number; decay: number; sustain: number; release: number };
}

/** A patch fully describes an instrument; every instrument shares the same click-free Voice. */
export interface Patch {
  id: InstrumentId;
  name: string;
  maxVoices: number;
  mono?: boolean;
  oscs: OscSpec[];
  filter: FilterSpec;
  amp: Adsr;
  /** 0 = ignore velocity, 1 = full range. */
  velocitySens: number;
  /** Legato glide time (s). */
  glide: number;
  /** How chord changes move between voicings by default. */
  transition: ChordTransition;
  /** Crossfade time for 'crossfade' transitions (s). */
  crossfade: number;
  /** Output trim (linear gain). */
  level: number;
  /** Optional soft saturation on the voice output (0..1). */
  drive?: number;
}
