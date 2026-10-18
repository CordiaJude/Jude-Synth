import type { Finger } from '../vision/landmarks';
import type { HandId, HandRole, Handedness } from '../vision/types';
import type { Vec3 } from './vec';

export type { Finger, HandId, HandRole, Handedness, Vec3 };

export interface FingerState {
  /** 0 = fully curled, 1 = fully straight (after calibration). */
  extension: number;
  /** Discrete state after per-finger hysteresis. */
  extended: boolean;
  /** d(extension)/dt per second — drives predictive onset. */
  velocity: number;
}

export const POSE_IDS = [
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
  'none',
] as const;
export type PoseId = (typeof POSE_IDS)[number];

export interface PoseResult {
  pose: PoseId;
  confidence: number;
  ranked: Array<{ pose: PoseId; score: number }>;
  heldMs: number;
  /** True when emitted early by predictive onset and not yet confirmed. */
  tentative: boolean;
}

export interface HandFeatures {
  /** Palm centre in the mirrored view, 0..1. palmY = 1 at the top of the frame. */
  palmX: number;
  palmY: number;
  /** 0 = near the camera, 1 = far (from palm size in the image; calibrated). */
  depth: number;
  /** Radians. roll: in-image tilt (fingers right = +). pitch: fingers toward camera = +. yaw: palm turned. */
  roll: number;
  pitch: number;
  yaw: number;
  /** 1 = palm faces the camera, -1 = back of hand faces it. */
  palmFacing: number;
  /** 0 = thumb and index touching, 1 = wide apart. */
  pinch: number;
  /** Mean finger extension, 0..1. */
  openness: number;
  /** Palm velocity / acceleration in frame-heights per second (z from depth units). */
  velocity: Vec3;
  acceleration: Vec3;
  speed: number;
  /** Physiological-tremor energy (4–12 Hz band), roughly 0..1. */
  tremor: number;
}

export interface HandGesture {
  id: HandId;
  role: HandRole;
  handedness: Handedness;
  presence: number;
  coasting: boolean;
  fingers: Record<Finger, FingerState>;
  /** Number of extended fingers (thumb included). */
  count: number;
  pinching: boolean;
  pose: PoseResult;
  features: HandFeatures;
}

export type SwipeDirection = 'left' | 'right' | 'up' | 'down';

export type GestureEvent =
  | {
      type: 'poseEnter' | 'poseExit';
      hand: HandId;
      role: HandRole;
      pose: PoseId;
      time: number;
      /**
       * Predictive onset: emitted before the pose is committed (or, with `revert`, to re-assert the committed
       * pose when a prediction didn't come true).
       */
      tentative?: boolean;
      revert?: boolean;
    }
  | { type: 'pinchStart' | 'pinchEnd' | 'pinchTap'; hand: HandId; role: HandRole; time: number }
  | { type: 'fistClench'; hand: HandId; role: HandRole; time: number; strength: number }
  | { type: 'swipe'; hand: HandId; role: HandRole; time: number; direction: SwipeDirection; speed: number }
  | { type: 'snap'; hand: HandId; role: HandRole; time: number; peakSpeed: number }
  | { type: 'handFound' | 'handLost'; hand: HandId; role: HandRole; time: number };

export type GestureEventType = GestureEvent['type'];

export interface GestureFrame {
  frameId: number;
  time: number;
  hands: HandGesture[];
  twoHand: { distance: number; angle: number } | null;
  events: GestureEvent[];
  quality: { meanPresence: number; lowLight: boolean };
  timing: { captureTime: number; detectStart: number; detectEnd: number; recognizeEnd: number };
}

export interface GestureConfig {
  /** Finger extension hysteresis: becomes extended above enter, curled below exit. */
  extendEnter: number;
  extendExit: number;
  /** A new pose must lead for this long before it is committed. */
  poseDebounceMs: number;
  /** Below this, the pose reads as 'none'. */
  minPoseConfidence: number;
  /** Required score lead of the winning pose over the runner-up. */
  poseMargin: number;
  pinchEnter: number;
  pinchExit: number;
  pinchTapMaxMs: number;
  swipeMinSpeed: number;
  swipeCooldownMs: number;
  snapMinPeak: number;
  predictiveOnset: boolean;
  /** Mean presence below which the low-light warning shows. */
  lowLightPresence: number;
}

export const DEFAULT_GESTURE_CONFIG: GestureConfig = {
  extendEnter: 0.6,
  extendExit: 0.45,
  poseDebounceMs: 45,
  minPoseConfidence: 0.45,
  poseMargin: 0.08,
  pinchEnter: 0.18,
  pinchExit: 0.3,
  pinchTapMaxMs: 300,
  swipeMinSpeed: 2.2,
  swipeCooldownMs: 350,
  snapMinPeak: 6,
  predictiveOnset: false,
  lowLightPresence: 0.55,
};

/** Per-user ranges captured during calibration. Raw values are in the recognizer's internal units. */
export interface Calibration {
  version: 1;
  fingerExtension: Record<Finger, { curled: number; open: number }>;
  palmSize: { near: number; far: number };
  pinch: { closed: number; open: number };
  createdAt: number;
}
