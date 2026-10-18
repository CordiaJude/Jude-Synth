import type { Patch } from './types';

/** Seven detuned saws, wide stereo, slow attack: lush and forgiving for chords. */
export const SUPERSAW_PAD: Patch = {
  id: 'supersawPad',
  name: 'Supersaw Pad',
  maxVoices: 12,
  oscs: [
    { type: 'sawtooth', detune: 0, spread: 0, gain: 0.22, pan: 0 },
    { type: 'sawtooth', detune: -7, spread: -6, gain: 0.18, pan: -0.45 },
    { type: 'sawtooth', detune: 7, spread: 6, gain: 0.18, pan: 0.45 },
    { type: 'sawtooth', detune: -15, spread: -12, gain: 0.15, pan: -0.85 },
    { type: 'sawtooth', detune: 15, spread: 12, gain: 0.15, pan: 0.85 },
    { type: 'sawtooth', detune: -24, spread: -18, gain: 0.1, pan: -0.6 },
    { type: 'sawtooth', detune: 24, spread: 18, gain: 0.1, pan: 0.6 },
    { type: 'sine', octave: -1, gain: 0.18, pan: 0 },
  ],
  filter: {
    type: 'lowpass',
    Q: 0.6,
    cutoff: [350, 9000],
    keyTrack: 0.3,
    env: { amount: 900, attack: 0.5, decay: 1.6, sustain: 250, release: 1.4 },
  },
  amp: { attack: 0.35, decay: 1.2, sustain: 0.85, release: 1.6 },
  velocitySens: 0.3,
  glide: 0.12,
  transition: 'crossfade',
  crossfade: 0.35,
  level: 0.16,
};

/** Two slightly detuned analog-style oscillators into a resonant lowpass with a snappy filter envelope. */
export const WARM_POLY: Patch = {
  id: 'warmPoly',
  name: 'Warm Analog Poly',
  maxVoices: 10,
  oscs: [
    { type: 'sawtooth', detune: -4, spread: -4, gain: 0.32, pan: -0.25 },
    { type: 'square', detune: 5, spread: 4, gain: 0.2, pan: 0.25 },
    { type: 'sine', octave: -1, gain: 0.22 },
  ],
  filter: {
    type: 'lowpass',
    Q: 2.2,
    cutoff: [260, 6500],
    keyTrack: 0.5,
    env: { amount: 3000, attack: 0.015, decay: 0.45, sustain: 700, release: 0.5 },
  },
  amp: { attack: 0.015, decay: 0.7, sustain: 0.62, release: 0.45 },
  velocitySens: 0.6,
  glide: 0.035,
  transition: 'legato',
  crossfade: 0.08,
  level: 0.17,
  drive: 0.2,
};

/** Clean sine sub with a touch of triangle and saturation so it's audible on laptop speakers. */
export const SUB_BASS: Patch = {
  id: 'subBass',
  name: 'Sub Bass',
  maxVoices: 2,
  mono: true,
  oscs: [
    { type: 'sine', gain: 0.7 },
    { type: 'triangle', octave: 1, gain: 0.12 },
  ],
  filter: {
    type: 'lowpass',
    Q: 0.7,
    cutoff: [500, 1400],
    keyTrack: 0,
    env: { amount: 600, attack: 0.005, decay: 0.15, sustain: 0, release: 0.2 },
  },
  amp: { attack: 0.012, decay: 0.3, sustain: 0.9, release: 0.25 },
  velocitySens: 0.3,
  glide: 0.06,
  transition: 'legato',
  crossfade: 0.06,
  level: 0.17,
  drive: 0.35,
};

/**
 * Pure sines with fast envelopes — used by the click test because a click in a sine is unambiguous. It
 * uses exactly the same Voice/VoiceManager code paths as the real instruments.
 */
export const TEST_SINE: Patch = {
  id: 'testSine',
  name: 'Test Sine',
  maxVoices: 4,
  oscs: [{ type: 'sine', gain: 0.5 }],
  filter: {
    type: 'lowpass',
    Q: 0.5,
    cutoff: [18000, 20000],
    keyTrack: 0,
    env: { amount: 0, attack: 0.01, decay: 0.1, sustain: 0, release: 0.1 },
  },
  amp: { attack: 0.006, decay: 0.08, sustain: 0.8, release: 0.04 },
  velocitySens: 0.5,
  glide: 0.03,
  transition: 'crossfade',
  crossfade: 0.03,
  level: 0.3,
};

export const PATCHES = {
  supersawPad: SUPERSAW_PAD,
  warmPoly: WARM_POLY,
  subBass: SUB_BASS,
  testSine: TEST_SINE,
};
export const CHORD_INSTRUMENTS = [SUPERSAW_PAD, WARM_POLY] as const;
