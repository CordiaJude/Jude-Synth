// Build GestureFrames for mapping/conductor tests, with pose/hand events derived from consecutive frames.

import type { GestureEvent, GestureFrame, HandGesture, PoseId } from '../../../src/gestures/types';
import type { HandRole } from '../../../src/vision/types';

export type HandSpec = { pose: PoseId } & Partial<HandGesture['features']>;
export type Step = Partial<Record<HandRole, HandSpec>> & { events?: GestureEvent[] };

export function hand(role: HandRole, spec: HandSpec): HandGesture {
  const finger = { extension: 0.5, extended: false, velocity: 0 };
  const { pose, ...features } = spec;
  return {
    id: role === 'primary' ? 1 : 2,
    role,
    handedness: role === 'primary' ? 'Left' : 'Right',
    presence: 1,
    coasting: false,
    fingers: { thumb: finger, index: finger, middle: finger, ring: finger, pinky: finger },
    count: 0,
    pinching: false,
    pose: { pose, confidence: 1, ranked: [], heldMs: 100, tentative: false },
    features: {
      palmX: 0.5,
      palmY: 0.5,
      depth: 0.5,
      roll: 0,
      pitch: 0,
      yaw: 0,
      palmFacing: 1,
      pinch: 1,
      openness: 0.5,
      velocity: { x: 0, y: 0, z: 0 },
      acceleration: { x: 0, y: 0, z: 0 },
      speed: 0,
      tremor: 0,
      ...features,
    },
  };
}

/** Frames with poseEnter/poseExit/handFound/handLost events computed from the step-to-step changes. */
export function framesFrom(steps: Step[]): GestureFrame[] {
  const prev: Partial<Record<HandRole, PoseId>> = {};
  return steps.map((step, i) => {
    const t = 1000 + i * 33;
    const events: GestureEvent[] = [...(step.events ?? [])];
    const hands: HandGesture[] = [];
    for (const role of ['primary', 'secondary'] as const) {
      const spec = step[role];
      const id = role === 'primary' ? 1 : 2;
      const before = prev[role];
      if (spec) {
        hands.push(hand(role, spec));
        if (before === undefined) events.push({ type: 'handFound', hand: id, role, time: t });
        if (before !== spec.pose) {
          if (before && before !== 'none')
            events.push({ type: 'poseExit', hand: id, role, pose: before, time: t });
          if (spec.pose !== 'none')
            events.push({ type: 'poseEnter', hand: id, role, pose: spec.pose, time: t });
        }
        prev[role] = spec.pose;
      } else if (before !== undefined) {
        if (before !== 'none') events.push({ type: 'poseExit', hand: id, role, pose: before, time: t });
        events.push({ type: 'handLost', hand: id, role, time: t });
        delete prev[role];
      }
    }
    return {
      frameId: i,
      time: t,
      hands,
      twoHand: null,
      events,
      quality: { meanPresence: 1, lowLight: false },
      timing: { captureTime: t, detectStart: t, detectEnd: t + 10, recognizeEnd: t + 11 },
    };
  });
}
