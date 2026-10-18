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

/** Two-operator FM electric piano: a soft 1:1 body plus a short, bright 14:1 "tine" on the attack. */
export const FM_KEYS: Patch = {
  id: 'fmKeys',
  name: 'FM Keys',
  maxVoices: 10,
  oscs: [{ type: 'sine', gain: 0.55 }],
  fm: [
    { ratio: 1, index: 1.5, decay: 1.4, sustain: 0.22 },
    { ratio: 14, index: 0.28, decay: 0.09, sustain: 0 },
  ],
  filter: {
    type: 'lowpass',
    Q: 0.5,
    cutoff: [1800, 14000],
    keyTrack: 0.2,
    env: { amount: 0, attack: 0.01, decay: 0.1, sustain: 0, release: 0.1 },
  },
  amp: { attack: 0.004, decay: 1.8, sustain: 0.3, release: 0.4 },
  velocitySens: 0.7,
  glide: 0.03,
  transition: 'crossfade',
  crossfade: 0.05,
  level: 0.28,
};

/** Bright plucked string: fast filter snap, no sustain — great for strums and arpeggios. */
export const PLUCK: Patch = {
  id: 'pluck',
  name: 'Pluck',
  maxVoices: 12,
  oscs: [
    { type: 'sawtooth', detune: -3, gain: 0.3, pan: -0.2 },
    { type: 'square', detune: 4, gain: 0.14, pan: 0.2 },
  ],
  filter: {
    type: 'lowpass',
    Q: 1.1,
    cutoff: [380, 7000],
    keyTrack: 0.6,
    env: { amount: 3200, attack: 0.004, decay: 0.2, sustain: 0, release: 0.2 },
  },
  amp: { attack: 0.003, decay: 0.9, sustain: 0, release: 0.25 },
  velocitySens: 0.7,
  glide: 0.02,
  transition: 'crossfade',
  crossfade: 0.03,
  level: 0.22,
};

/** Inharmonic FM bell: glassy, long ringing decay. */
export const GLASS_BELL: Patch = {
  id: 'glassBell',
  name: 'Glass Bell',
  maxVoices: 12,
  oscs: [{ type: 'sine', gain: 0.5 }],
  fm: [
    { ratio: 3.5, index: 2, decay: 1.6, sustain: 0.08 },
    { ratio: 7.07, index: 0.5, decay: 0.3, sustain: 0 },
  ],
  filter: {
    type: 'lowpass',
    Q: 0.5,
    cutoff: [2500, 16000],
    keyTrack: 0,
    env: { amount: 0, attack: 0.01, decay: 0.1, sustain: 0, release: 0.1 },
  },
  amp: { attack: 0.003, decay: 3.2, sustain: 0, release: 1.4 },
  velocitySens: 0.6,
  glide: 0.02,
  transition: 'crossfade',
  crossfade: 0.05,
  level: 0.2,
};

/** Monophonic singing lead with portamento and a tremor-driven vibrato. */
export const THEREMIN_LEAD: Patch = {
  id: 'thereminLead',
  name: 'Theremin Lead',
  maxVoices: 2,
  mono: true,
  oscs: [
    { type: 'sine', gain: 0.6 },
    { type: 'triangle', gain: 0.16 },
    { type: 'sine', octave: 1, gain: 0.05 },
  ],
  filter: {
    type: 'lowpass',
    Q: 0.9,
    cutoff: [700, 7000],
    keyTrack: 0.6,
    env: { amount: 0, attack: 0.01, decay: 0.1, sustain: 0, release: 0.1 },
  },
  amp: { attack: 0.045, decay: 0.3, sustain: 1, release: 0.35 },
  velocitySens: 0.2,
  glide: 0.07,
  transition: 'legato',
  crossfade: 0.05,
  level: 0.3,
  drive: 0.15,
  vibrato: { rate: 5.6, maxCents: 70 },
};

export const PATCHES = {
  supersawPad: SUPERSAW_PAD,
  warmPoly: WARM_POLY,
  subBass: SUB_BASS,
  fmKeys: FM_KEYS,
  pluck: PLUCK,
  glassBell: GLASS_BELL,
  thereminLead: THEREMIN_LEAD,
  testSine: TEST_SINE,
};
export const CHORD_INSTRUMENTS = [SUPERSAW_PAD, WARM_POLY, FM_KEYS, PLUCK, GLASS_BELL] as const;
export const MELODY_INSTRUMENTS = [THEREMIN_LEAD, FM_KEYS, PLUCK, GLASS_BELL] as const;
