// Soft pose templates over five finger-extension values. Each finger contributes a probability of matching
// its target; a pose's score is the geometric mean, so one badly mismatched finger sinks the pose.

import type { PoseId } from './types';

/** Target per finger [thumb, index, middle, ring, pinky]: 1 extended, 0 curled. */
export const POSE_TEMPLATES: ReadonlyArray<{ pose: PoseId; target: readonly [0 | 1, 0 | 1, 0 | 1, 0 | 1, 0 | 1] }> = [
  { pose: 'fist', target: [0, 0, 0, 0, 0] },
  { pose: 'one', target: [0, 1, 0, 0, 0] },
  { pose: 'two', target: [0, 1, 1, 0, 0] },
  { pose: 'three', target: [0, 1, 1, 1, 0] },
  { pose: 'four', target: [0, 1, 1, 1, 1] },
  { pose: 'open', target: [1, 1, 1, 1, 1] },
  { pose: 'indexPinky', target: [0, 1, 0, 0, 1] },
  { pose: 'thumbIndexPinky', target: [1, 1, 0, 0, 1] },
  { pose: 'thumbOnly', target: [1, 0, 0, 0, 0] },
];

const logistic = (x: number): number => 1 / (1 + Math.exp(-x));
/** Softness of each finger's decision boundary, in extension units. */
const SOFTNESS = 0.07;

/**
 * Probability that each finger is extended. The boundary sits at the hysteresis threshold appropriate to
 * the finger's current discrete state, so soft scores agree with the discrete flags.
 */
export function extendedProbabilities(
  ext: ArrayLike<number>,
  extended: ArrayLike<boolean>,
  enter: number,
  exit: number,
  out: Float64Array = new Float64Array(5),
): Float64Array {
  for (let i = 0; i < 5; i++) {
    const mid = extended[i] ? exit : enter;
    out[i] = logistic(((ext[i] ?? 0) - mid) / SOFTNESS);
  }
  return out;
}

/**
 * Score every pose, best first. `pinchCloseness` (0..1, 1 = tips touching) both scores the 'pinch' (OK-sign)
 * pose and discounts templates that need thumb and index both extended — touching tips can't be "open".
 */
export function scorePoses(pExt: ArrayLike<number>, pinchCloseness: number): Array<{ pose: PoseId; score: number }> {
  const out: Array<{ pose: PoseId; score: number }> = [];
  for (const { pose, target } of POSE_TEMPLATES) {
    let logSum = 0;
    for (let i = 0; i < 5; i++) {
      const p = pExt[i] ?? 0;
      logSum += Math.log(Math.max(1e-6, target[i] ? p : 1 - p));
    }
    let score = Math.exp(logSum / 5);
    if (target[0] && target[1]) score *= 1 - 0.85 * pinchCloseness;
    out.push({ pose, score });
  }
  // OK sign: thumb–index touching while middle, ring and pinky stay up.
  const rest = Math.cbrt((pExt[2] ?? 0) * (pExt[3] ?? 0) * (pExt[4] ?? 0));
  out.push({ pose: 'pinch', score: pinchCloseness * rest });
  out.sort((a, b) => b.score - a.score);
  return out;
}
