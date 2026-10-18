// Human-readable catalog of sources, targets, triggers and actions for the mapping editor.

import { PARAM_PATHS } from '../events/types';
import type { PoseId } from '../gestures/types';
import type { HandRole } from '../vision/types';
import {
  FINGER_NAMES,
  HAND_FEATURES,
  type Action,
  type FeatureSource,
  type HandFeatureName,
  type MappingTarget,
} from './types';

export const FEATURE_LABEL: Record<HandFeatureName, string> = {
  palmX: 'left ↔ right',
  palmY: 'height',
  depth: 'distance from camera',
  roll: 'wrist tilt',
  rollAbs: 'wrist tilt (either way)',
  pitch: 'fingers toward camera',
  yaw: 'palm turn',
  palmFacing: 'palm facing camera',
  pinch: 'pinch opening',
  openness: 'hand openness',
  speed: 'hand speed',
  velocityX: 'sideways speed',
  velocityY: 'vertical speed',
  tremor: 'tremor',
};

/** Sources measured in radians (shown in degrees in the editor). */
export const ANGLE_FEATURES = new Set<string>(['roll', 'rollAbs', 'pitch', 'yaw']);
export const isAngleSource = (s: FeatureSource) =>
  s === 'twoHand.angle' || ANGLE_FEATURES.has(s.split('.')[1] ?? '');

/** Typical full range of each source, used by learn-by-moving to compare how much each one moved. */
export function typicalRange(s: FeatureSource): number {
  if (s === 'twoHand.distance') return 1.2;
  if (s === 'twoHand.angle') return Math.PI;
  const f = s.split('.')[1] as HandFeatureName | 'finger';
  if (f === 'finger') return 1;
  if (ANGLE_FEATURES.has(f)) return Math.PI / 2;
  if (f === 'speed' || f === 'velocityX' || f === 'velocityY') return 3;
  if (f === 'palmFacing') return 2;
  return 1;
}

const ROLE_LABEL: Record<HandRole, string> = { primary: 'Primary hand', secondary: 'Secondary hand' };

export const SOURCES: Array<{ value: FeatureSource; label: string }> = [
  ...(['primary', 'secondary'] as const).flatMap((role) => [
    ...HAND_FEATURES.map((f) => ({
      value: `${role}.${f}` as FeatureSource,
      label: `${ROLE_LABEL[role]}: ${FEATURE_LABEL[f]}`,
    })),
    ...FINGER_NAMES.map((f) => ({
      value: `${role}.finger.${f}` as FeatureSource,
      label: `${ROLE_LABEL[role]}: ${f} finger`,
    })),
  ]),
  { value: 'twoHand.distance', label: 'Both hands: distance apart' },
  { value: 'twoHand.angle', label: 'Both hands: angle between' },
];

export const TARGET_LABEL: Record<MappingTarget, string> = {
  'master.volume': 'Master volume',
  'macro.brightness': 'Brightness (filter)',
  'macro.space': 'Space (reverb + delay)',
  'macro.motion': 'Motion (chorus + spread)',
  'macro.grit': 'Grit (tape saturation)',
  'fx.chorus.mix': 'Chorus amount',
  'fx.delay.mix': 'Delay amount',
  'fx.delay.feedback': 'Delay feedback',
  'fx.reverb.mix': 'Reverb amount',
  'fx.tape.drive': 'Tape drive',
  'fx.djFilter': 'DJ filter (low ← off → high)',
  'chords.level': 'Chord level',
  'bass.level': 'Bass level',
  'melody.level': 'Melody level',
  'melody.vibrato': 'Melody vibrato',
  'melody.pitch': 'Melody pitch',
  'fx.duck': 'Sidechain ducking (on kicks)',
  'drums.level': 'Drum level',
  'arp.rate': 'Arpeggio rate',
  'arp.gate': 'Arpeggio note length',
  'strum.position': 'Strum (hand sweeps across strings)',
};
export const TARGETS: MappingTarget[] = [
  ...PARAM_PATHS,
  'melody.pitch',
  'arp.rate',
  'arp.gate',
  'strum.position',
];

export const POSE_CHOICES: PoseId[] = [
  'fist',
  'one',
  'two',
  'three',
  'four',
  'open',
  'indexPinky',
  'thumbIndexPinky',
  'thumbOnly',
  'pinch',
];

export const ACTION_CHOICES: Array<{ label: string; action: Action }> = [
  ...([1, 2, 3, 4, 5, 6, 7] as const).map((d) => ({
    label: `Chord on degree ${['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][d - 1]}`,
    action: { type: 'chord.degree', degree: d } as Action,
  })),
  { label: 'Release chord', action: { type: 'chord.release' } },
  { label: 'Borrow from parallel mode: on', action: { type: 'chord.parallel', value: true } },
  { label: 'Borrow from parallel mode: off', action: { type: 'chord.parallel', value: false } },
  { label: 'Borrowed ♭VII', action: { type: 'chord.borrowed', chord: 'bVII' } },
  { label: 'Borrowed iv', action: { type: 'chord.borrowed', chord: 'iv' } },
  { label: 'Borrowed ♭VI', action: { type: 'chord.borrowed', chord: 'bVI' } },
  { label: 'Borrowed ♭III', action: { type: 'chord.borrowed', chord: 'bIII' } },
  { label: 'Secondary dominant V/V', action: { type: 'chord.borrowed', chord: 'V/V' } },
  { label: 'Shape: triad', action: { type: 'chord.shape', extension: 'triad', quality: 'diatonic' } },
  { label: 'Shape: 7th', action: { type: 'chord.shape', extension: 'seventh', quality: 'diatonic' } },
  { label: 'Shape: 9th', action: { type: 'chord.shape', extension: 'ninth', quality: 'diatonic' } },
  { label: 'Shape: sus4', action: { type: 'chord.shape', extension: 'triad', quality: 'sus4' } },
  { label: 'Shape: sus2', action: { type: 'chord.shape', extension: 'triad', quality: 'sus2' } },
  { label: 'Chord octave down', action: { type: 'chord.octave', value: -1 } },
  { label: 'Chord octave normal', action: { type: 'chord.octave', value: 0 } },
  { label: 'Chord octave up', action: { type: 'chord.octave', value: 1 } },
  { label: 'Inversion down', action: { type: 'chord.inversionBias', value: -1 } },
  { label: 'Inversion normal', action: { type: 'chord.inversionBias', value: 0 } },
  { label: 'Inversion up', action: { type: 'chord.inversionBias', value: 1 } },
  { label: 'Melody note on', action: { type: 'melody.gate', on: true } },
  { label: 'Melody note off', action: { type: 'melody.gate', on: false } },
  { label: 'Melody octave up', action: { type: 'melody.octave', delta: 1 } },
  { label: 'Melody octave down', action: { type: 'melody.octave', delta: -1 } },
  { label: 'Latch on/off', action: { type: 'latch.toggle' } },
  { label: 'Arpeggiator on/off', action: { type: 'arp.toggle' } },
  { label: 'Strum mode on/off', action: { type: 'strum.toggle' } },
  { label: 'Strum down', action: { type: 'strum.strum', direction: 'down' } },
  { label: 'Strum up', action: { type: 'strum.strum', direction: 'up' } },
  { label: 'Drums on/off', action: { type: 'drums.toggle' } },
  { label: 'Drum fill (next bar)', action: { type: 'drums.fill' } },
  { label: 'Drop (next bar)', action: { type: 'drums.drop' } },
  { label: 'Next drum style', action: { type: 'drums.nextGenre' } },
  { label: 'Next bass pattern', action: { type: 'bass.nextPattern' } },
  { label: 'Tap tempo', action: { type: 'tempo.tap' } },
  { label: 'Tempo +5', action: { type: 'tempo.nudge', delta: 5 } },
  { label: 'Tempo −5', action: { type: 'tempo.nudge', delta: -5 } },
];

export const actionLabel = (a: Action | undefined): string =>
  a ? (ACTION_CHOICES.find((c) => JSON.stringify(c.action) === JSON.stringify(a))?.label ?? a.type) : '—';
