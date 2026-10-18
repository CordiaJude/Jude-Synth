// Rotation-invariant finger extension. Everything here works on WORLD landmarks (metric, 3D), using only
// joint angles and distances normalized by palm size — so rotating, tilting or moving the hand toward the
// camera doesn't change the result. Never compares raw y coordinates.

import { FINGER_CHAIN, FINGERS, LM, PALM_POINTS, type Finger, type LandmarkArray } from '../vision/landmarks';
import type { Calibration } from './types';
import { angleBetween, at, dist, sub, unlerp, vec, type Vec3 } from './vec';

const tmp = Array.from({ length: 8 }, () => vec());

export function palmCenter(lm: LandmarkArray, out: Vec3 = vec()): Vec3 {
  out.x = out.y = out.z = 0;
  for (const i of PALM_POINTS) {
    out.x += lm[i * 3]!;
    out.y += lm[i * 3 + 1]!;
    out.z += lm[i * 3 + 2]!;
  }
  out.x /= PALM_POINTS.length;
  out.y /= PALM_POINTS.length;
  out.z /= PALM_POINTS.length;
  return out;
}

/** Wrist → middle-MCP length: the hand's own ruler. */
export function palmSize(lm: LandmarkArray): number {
  return dist(at(lm, LM.WRIST, tmp[0]), at(lm, LM.MIDDLE_MCP, tmp[1])) || 1e-6;
}

/** Tip-to-palm-centre distance (in palm sizes) mapped to 0..1 per finger: [curled, straight]. */
const TIP_DIST_RANGE: Record<Exclude<Finger, 'thumb'>, readonly [number, number]> = {
  index: [0.5, 1.1],
  middle: [0.5, 1.15],
  ring: [0.5, 1.05],
  pinky: [0.45, 0.9],
};

/**
 * Raw extension score for one finger, roughly 0 (curled) … 1 (straight). Uncalibrated.
 * Long fingers: weighted bend at MCP/PIP/DIP, fused with tip-to-palm-centre distance.
 * Thumb: bend at MCP/IP, fused with how far the tip sits from the palm centre and the pinky knuckle
 * (a tucked thumb folds toward both; an extended one points away from both).
 */
export function rawFingerExtension(world: LandmarkArray, finger: Finger, center: Vec3, size: number): number {
  const [a, b, c, d] = FINGER_CHAIN[finger];
  const pa = at(world, a, tmp[2]);
  const pb = at(world, b, tmp[3]);
  const pc = at(world, c, tmp[4]);
  const pd = at(world, d, tmp[5]);
  const ab = sub(pb, pa, vec());
  const bc = sub(pc, pb, vec());
  const cd = sub(pd, pc, vec());

  if (finger === 'thumb') {
    const bend = angleBetween(ab, bc) + angleBetween(bc, cd);
    const angleScore = 1 - unlerp(bend, 0.25, 1.7);
    const toCenter = dist(pd, center) / size;
    const toPinky = dist(pd, at(world, LM.PINKY_MCP, tmp[7])) / size;
    const distScore = 0.5 * unlerp(toCenter, 0.6, 1.0) + 0.5 * unlerp(toPinky, 0.85, 1.3);
    return 0.25 * angleScore + 0.75 * distScore;
  }

  const wrist = at(world, LM.WRIST, tmp[6]);
  const palmDir = sub(pa, wrist, vec());
  const bend = 0.6 * angleBetween(palmDir, ab) + angleBetween(ab, bc) + 0.5 * angleBetween(bc, cd);
  const angleScore = 1 - unlerp(bend, 0.3, 2.9);
  const [lo, hi] = TIP_DIST_RANGE[finger];
  const distScore = unlerp(dist(pd, center) / size, lo, hi);
  return 0.45 * angleScore + 0.55 * distScore;
}

/** Default raw ranges (measured on the synthetic hand model; overridden by user calibration). */
export const DEFAULT_FINGER_RANGES: Calibration['fingerExtension'] = {
  thumb: { curled: 0.1, open: 0.8 },
  index: { curled: 0.05, open: 0.78 },
  middle: { curled: 0.05, open: 0.8 },
  ring: { curled: 0.05, open: 0.78 },
  pinky: { curled: 0.05, open: 0.72 },
};

/** Calibrated extension for all five fingers, written into `out` (thumb..pinky). */
export function fingerExtensions(
  world: LandmarkArray,
  ranges: Calibration['fingerExtension'] = DEFAULT_FINGER_RANGES,
  out: Float64Array = new Float64Array(5),
): Float64Array {
  const center = palmCenter(world, vec());
  const size = palmSize(world);
  FINGERS.forEach((f, i) => {
    const r = ranges[f];
    out[i] = unlerp(rawFingerExtension(world, f, center, size), r.curled, r.open);
  });
  return out;
}

/** Thumb-tip to index-tip distance in palm sizes (uncalibrated pinch). */
export function rawPinch(world: LandmarkArray): number {
  return dist(at(world, LM.THUMB_TIP, tmp[0]), at(world, LM.INDEX_TIP, tmp[1])) / palmSize(world);
}
