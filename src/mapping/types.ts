// Declarative gesture → music mappings. A preset is plain JSON: users can edit, save, export and import it.

import type { InstrumentId } from '../audio/instruments/types';
import type { GestureEventType, PoseId, SwipeDirection } from '../gestures/types';
import type { ParamPath } from '../events/types';
import type { BorrowedChord, ChordQuality, Degree, Extension } from '../theory/chords';
import type { BassPattern } from '../performance/bass';
import type { Genre } from '../performance/drums/patterns';
import type { GrooveAction, GrooveTarget } from '../performance/groove';
import type { HandRole } from '../vision/types';

export type Curve =
  | { kind: 'linear' }
  /** Exponential-feeling: slow start, fast end. k > 0 bends harder. */
  | { kind: 'exp'; k: number }
  /** Logarithmic-feeling: fast start, slow end. */
  | { kind: 'log'; k: number }
  | { kind: 'pow'; gamma: number }
  | { kind: 'smoothstep' }
  /** Quantize the output into n equal steps. */
  | { kind: 'steps'; n: number };

export const HAND_FEATURES = [
  'palmX',
  'palmY',
  'depth',
  'roll',
  'rollAbs',
  'pitch',
  'yaw',
  'palmFacing',
  'pinch',
  'openness',
  'speed',
  'velocityX',
  'velocityY',
  'tremor',
] as const;
export type HandFeatureName = (typeof HAND_FEATURES)[number];
export const FINGER_NAMES = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;

/** e.g. "primary.palmY", "secondary.finger.index", "twoHand.distance". */
export type FeatureSource =
  | `${HandRole}.${HandFeatureName}`
  | `${HandRole}.finger.${(typeof FINGER_NAMES)[number]}`
  | 'twoHand.distance'
  | 'twoHand.angle';

/** Continuous destinations: engine params plus performance-level controls. */
export type MappingTarget = ParamPath | 'melody.pitch' | GrooveTarget;

export type PerformanceMode = 'chords' | 'melody' | 'theremin';

export type Condition =
  | { pose: { role: HandRole; is: PoseId[] } }
  | { present: HandRole }
  | { mode: PerformanceMode }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

export interface ContinuousMapping {
  id: string;
  label?: string;
  source: FeatureSource;
  target: MappingTarget;
  /** Input range of the source (in its natural units: radians for angles, 0..1 otherwise). */
  inRange: [number, number];
  outRange: [number, number];
  curve: Curve;
  invert: boolean;
  /** Fraction of the input range around its centre treated as the centre (0..0.5). */
  deadzone?: number;
  /** Engine-side ramp time for this target (ms). */
  smoothingMs?: number;
  enabledWhen?: Condition;
}

export type Trigger =
  | { kind: 'pose'; role: HandRole; pose: PoseId }
  | { kind: 'event'; role: HandRole; event: GestureEventType; direction?: SwipeDirection }
  /** Enters when source crosses `above` (or falls under `below`); exits after crossing back by `hysteresis`. */
  | { kind: 'threshold'; source: FeatureSource; above?: number; below?: number; hysteresis: number };

export type Action =
  | { type: 'chord.degree'; degree: Degree }
  | { type: 'chord.borrowed'; chord: BorrowedChord }
  | { type: 'chord.parallel'; value: boolean }
  | { type: 'chord.quality'; quality: ChordQuality | 'diatonic' }
  | { type: 'chord.extension'; extension: Extension }
  /** Shape = extension + quality in one action (e.g. sus4 triad). */
  | { type: 'chord.shape'; extension: Extension; quality: ChordQuality | 'diatonic' }
  | { type: 'chord.octave'; value: -1 | 0 | 1 }
  | { type: 'chord.inversionBias'; value: -1 | 0 | 1 }
  | { type: 'chord.release' }
  | { type: 'melody.gate'; on: boolean }
  | { type: 'melody.octave'; delta: -1 | 1 }
  | { type: 'mode.set'; mode: PerformanceMode }
  | { type: 'latch.toggle' }
  | GrooveAction;

export interface DiscreteMapping {
  id: string;
  label?: string;
  trigger: Trigger;
  action: Action;
  /** For pose / threshold triggers: what happens when the trigger ends. */
  onExit?: Action;
  when?: Condition;
}

export interface MappingPreset {
  id: string;
  name: string;
  description: string;
  version: 1;
  builtIn: boolean;
  roles: { primary: string; secondary: string };
  defaultMode: PerformanceMode;
  instruments: { chords: InstrumentId; melody: InstrumentId; bass: boolean };
  /** Melody/theremin pitch range (MIDI) and how hard pitch snaps to the scale (0 = free, 1 = hard). */
  melody: { low: number; high: number; snap: number };
  /** Groove features the preset switches on when selected (omitted = leave as they are). */
  groove?: { arp?: boolean; strum?: boolean; drums?: boolean; genre?: Genre; bassPattern?: BassPattern };
  continuous: ContinuousMapping[];
  discrete: DiscreteMapping[];
}

export interface ParamUpdate {
  target: MappingTarget;
  value: number;
  rampMs: number;
  mappingId: string;
}

export interface MappingOutput {
  params: ParamUpdate[];
  actions: Action[];
  /** Normalized live input per continuous mapping (for the editor's meters). */
  inputs: Record<string, { input: number; output: number; active: boolean }>;
}
