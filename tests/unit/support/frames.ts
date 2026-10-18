import type { Detection, TrackedHand, VisionFrame } from '../../../src/vision/types';
import { syntheticHand, type Placement, type NoiseSpec } from '../../../src/gestures/testing/synthetic';
import type { PoseId } from '../../../src/gestures/types';

export const ASPECT = 16 / 9;

export function detection(
  pose: Exclude<PoseId, 'none'>,
  pl: Partial<Placement> = {},
  noise?: NoiseSpec,
  rng?: () => number,
  score = 0.95,
  variation = 0,
): Detection {
  const handedness = pl.handedness ?? 'Right';
  const { image, world } = syntheticHand(pose, { aspect: ASPECT, ...pl, handedness }, noise, rng, variation);
  return { image, world, handedness, handednessScore: score };
}

export function tracked(det: Detection, id = 1, role: TrackedHand['role'] = 'primary'): TrackedHand {
  return {
    id,
    role,
    handedness: det.handedness,
    handednessConfidence: 1,
    landmarks: det.image,
    world: det.world,
    raw: det.image,
    rawWorld: det.world,
    presence: det.handednessScore,
    ageMs: 0,
    lostFrames: 0,
  };
}

export function frame(hands: TrackedHand[], t: number, frameId = 0): VisionFrame {
  return {
    frameId,
    captureTime: t,
    captureTimeSource: 'estimated',
    detectStart: t,
    detectEnd: t,
    aspect: ASPECT,
    hands,
  };
}
