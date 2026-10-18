import type { LandmarkArray } from './landmarks';

export type HandId = number;
/** Musical role, assigned once when a hand appears and kept for the life of its track. */
export type HandRole = 'primary' | 'secondary';
export type Handedness = 'Left' | 'Right';

/** How roles are assigned when a new hand appears. */
export type RoleRule = 'screenSide' | 'handedness' | 'firstSeen';

/**
 * A single detection in display space: mirrored (selfie view, x grows to the viewer's right), with
 * handedness corrected to the user's anatomical hand.
 */
export interface Detection {
  image: LandmarkArray; // normalized image coords 0..1 (z ≈ relative depth, wrist-origin, x-scale)
  world: LandmarkArray; // metres, hand-centred
  handedness: Handedness;
  handednessScore: number;
}

export interface TrackedHand {
  id: HandId;
  role: HandRole;
  handedness: Handedness; // smoothed vote, not the per-frame label
  handednessConfidence: number;
  landmarks: LandmarkArray; // filtered, image space (display/mirrored)
  world: LandmarkArray; // filtered, world space
  raw: LandmarkArray; // unfiltered image space (tremor analysis, capture tool)
  rawWorld: LandmarkArray;
  presence: number; // 0..1, decays while coasting
  ageMs: number;
  lostFrames: number; // >0 while coasting on prediction (no detection this frame)
}

export type CaptureTimeSource = 'videoFrame' | 'rvfc' | 'estimated';

export interface VisionFrame {
  frameId: number;
  /** All times are wall-clock ms (performance.timeOrigin + performance.now()) so they compare across threads. */
  captureTime: number;
  captureTimeSource: CaptureTimeSource;
  detectStart: number;
  detectEnd: number;
  /** Width / height of the source frame. */
  aspect: number;
  /** Mean luma of the frame, 0..1 (for the low-light warning). */
  brightness?: number;
  hands: TrackedHand[];
}

/** Current wall-clock time in ms, comparable between the main thread and workers. */
export const wallNow = (): number => performance.timeOrigin + performance.now();
