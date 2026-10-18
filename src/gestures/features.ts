// Per-frame (stateless) continuous features of one hand. Kinematic features (velocity, acceleration,
// tremor) need history and live in the recognizer.

import { LM, PALM_POINTS, type LandmarkArray } from '../vision/landmarks';
import type { Handedness } from '../vision/types';
import { rawPinch } from './fingers';
import type { Calibration } from './types';
import { at, clamp, cross, dist, normalize, sub, unlerp, vec, type Vec3 } from './vec';

export const DEFAULT_PALM_SCALE: Calibration['palmSize'] = { near: 6, far: 1.2 };
export const DEFAULT_PINCH: Calibration['pinch'] = { closed: 0.15, open: 1.0 };

export interface Orientation {
  roll: number;
  pitch: number;
  yaw: number;
  palmFacing: number;
  /** Unit vectors: up = wrist → middle MCP, across = pinky → index MCP, normal = out of the palm. */
  up: Vec3;
  across: Vec3;
  normal: Vec3;
}

const t0 = vec();
const t1 = vec();
const t2 = vec();
const t3 = vec();

/** Palm orientation from world landmarks (display coords: x right, y down, z away from the camera). */
export function palmOrientation(world: LandmarkArray, handedness: Handedness): Orientation {
  const up = normalize(sub(at(world, LM.MIDDLE_MCP, t0), at(world, LM.WRIST, t1), vec()));
  const across = normalize(sub(at(world, LM.INDEX_MCP, t0), at(world, LM.PINKY_MCP, t1), vec()));
  // Handedness fixes the chirality so the normal always points out of the palm.
  const normal = normalize(handedness === 'Right' ? cross(up, across, vec()) : cross(across, up, vec()));
  return {
    roll: Math.atan2(up.x, -up.y),
    pitch: Math.asin(clamp(-up.z, -1, 1)),
    yaw: Math.atan2(-normal.x, -normal.z),
    palmFacing: -normal.z,
    up,
    across,
    normal,
  };
}

/** Palm centre in image coords (0..1). */
export function imagePalmCenter(image: LandmarkArray, out: Vec3 = vec()): Vec3 {
  out.x = out.y = out.z = 0;
  for (const i of PALM_POINTS) {
    out.x += image[i * 3]!;
    out.y += image[i * 3 + 1]!;
  }
  out.x /= PALM_POINTS.length;
  out.y /= PALM_POINTS.length;
  return out;
}

const SCALE_SEGMENTS: ReadonlyArray<readonly [number, number]> = [
  [LM.WRIST, LM.INDEX_MCP],
  [LM.WRIST, LM.MIDDLE_MCP],
  [LM.WRIST, LM.PINKY_MCP],
  [LM.INDEX_MCP, LM.PINKY_MCP],
  [LM.WRIST, LM.THUMB_CMC],
];

/**
 * Image scale in frame-heights per metre. Each palm segment's 2D length / 3D length is foreshortened by
 * tilt, so the maximum over several differently-oriented segments is a tilt-robust estimate.
 */
export function imageScale(image: LandmarkArray, world: LandmarkArray, aspect: number): number {
  let best = 0;
  for (const [a, b] of SCALE_SEGMENTS) {
    const dx = (image[b * 3]! - image[a * 3]!) * aspect;
    const dy = image[b * 3 + 1]! - image[a * 3 + 1]!;
    const d3 = dist(at(world, a, t2), at(world, b, t3));
    if (d3 > 1e-4) best = Math.max(best, Math.hypot(dx, dy) / d3);
  }
  return best;
}

/** 0 = near, 1 = far, log-mapped between the calibrated near/far scales. */
export function depthFromScale(s: number, cal: Calibration['palmSize'] = DEFAULT_PALM_SCALE): number {
  if (s <= 0) return 1;
  return 1 - unlerp(Math.log(s), Math.log(cal.far), Math.log(cal.near));
}

export function pinchAmount(world: LandmarkArray, cal: Calibration['pinch'] = DEFAULT_PINCH): number {
  return unlerp(rawPinch(world), cal.closed, cal.open);
}
