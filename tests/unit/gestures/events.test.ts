import { describe, expect, it } from 'vitest';
import { stepPinch, stepSnap, stepSwipe } from '../../../src/gestures/events';
import { createRecognizer, extensionsOf, recognize } from '../../../src/gestures/recognizer';
import { buildLocalHand, placeHand, shapeFor, type HandShape } from '../../../src/gestures/testing/synthetic';
import { DEFAULT_GESTURE_CONFIG as CFG, type GestureEvent, type PoseId } from '../../../src/gestures/types';
import { ASPECT, detection, frame, tracked } from '../support/frames';

const PLACE = {
  handedness: 'Right' as const,
  roll: 0.3,
  pitch: 0.2,
  yaw: -0.3,
  cx: 0.5,
  cy: 0.5,
  imageScale: 0.25,
  aspect: ASPECT,
};

const run = (poses: Array<Exclude<PoseId, 'none'>>, place: (i: number) => object = () => ({})) => {
  const st = createRecognizer();
  const events: GestureEvent[] = [];
  poses.forEach((p, i) =>
    events.push(...recognize(st, frame([tracked(detection(p, place(i)))], i * 33, i)).out.events),
  );
  return events;
};

describe('pinch', () => {
  it('has hysteresis between enter and exit', () => {
    const s = { pinching: false, since: 0 };
    expect(stepPinch(s, 0.25, 0, CFG)).toEqual([]);
    expect(stepPinch(s, 0.1, 10, CFG)).toEqual(['start']);
    expect(stepPinch(s, 0.25, 20, CFG)).toEqual([]); // between enter (0.18) and exit (0.3): still pinching
    expect(s.pinching).toBe(true);
    expect(stepPinch(s, 0.5, 30, CFG)).toEqual(['end', 'tap']);
  });

  it('a long hold is not a tap', () => {
    const s = { pinching: false, since: 0 };
    stepPinch(s, 0.05, 0, CFG);
    expect(stepPinch(s, 0.6, 800, CFG)).toEqual(['end']);
  });

  it('emits start / end / tap from landmarks', () => {
    const types = run(['open', 'open', 'pinch', 'pinch', 'open', 'open']).map((e) => e.type);
    expect(types).toContain('pinchStart');
    expect(types).toContain('pinchTap');
    expect(types.indexOf('pinchStart')).toBeLessThan(types.indexOf('pinchEnd'));
  });
});

describe('fist clench', () => {
  it('fires when an open hand closes quickly', () => {
    const ev = run(['open', 'open', 'open', 'fist', 'fist', 'fist']);
    expect(ev.find((e) => e.type === 'fistClench')).toBeTruthy();
  });

  it('does not fire when entering fist slowly from an almost-closed hand', () => {
    const ev = run(['one', 'one', 'one', 'one', 'fist', 'fist', 'fist']);
    expect(ev.find((e) => e.type === 'fistClench')).toBeFalsy();
  });
});

describe('swipe', () => {
  it('fires once, at the speed peak, with the right direction', () => {
    const s = { armed: false, peak: 0, peakVx: 0, peakVy: 0, cooldownUntil: 0 };
    const speeds = [0, 1, 3, 5, 4, 2, 0];
    const out = speeds.map((v, i) => stepSwipe(s, -v, 0.2, i * 33, CFG));
    const fired = out.filter(Boolean);
    expect(fired).toHaveLength(1);
    expect(fired[0]!.direction).toBe('left');
    expect(fired[0]!.speed).toBeCloseTo(5, 1);
  });

  it('detects swipes from moving landmarks', () => {
    const xs = [0.2, 0.2, 0.2, 0.3, 0.45, 0.6, 0.68, 0.7, 0.7];
    const ev = run(
      xs.map(() => 'open' as const),
      (i) => ({ cx: xs[i] }),
    ).filter((e) => e.type === 'swipe');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ direction: 'right' });
  });

  it('ignores slow drifts', () => {
    const ev = run(Array(20).fill('open'), (i) => ({ cx: 0.3 + i * 0.01 })).filter((e) => e.type === 'swipe');
    expect(ev).toHaveLength(0);
  });
});

describe('snap', () => {
  it('needs thumb–middle contact shortly before a fingertip velocity spike', () => {
    const s = { lastPrimedAt: -Infinity, cooldownUntil: 0 };
    expect(stepSnap(s, 0.8, 20, 0, CFG)).toBeNull(); // fast but never primed
    expect(stepSnap(s, 0.2, 0, 33, CFG)).toBeNull(); // primed
    expect(stepSnap(s, 0.9, 15, 66, CFG)).toBe(15); // whip away
    expect(stepSnap(s, 0.2, 0, 99, CFG)).toBeNull();
    expect(stepSnap(s, 0.9, 15, 130, CFG)).toBeNull(); // cooldown
  });
});

describe('hand lifecycle', () => {
  it('emits handFound and handLost', () => {
    const st = createRecognizer();
    const a = recognize(st, frame([tracked(detection('open'))], 0)).out.events.map((e) => e.type);
    const b = recognize(st, frame([], 33)).out.events.map((e) => e.type);
    expect(a).toContain('handFound');
    expect(b).toContain('handLost');
  });

  it('holds the last gesture while the tracker is coasting', () => {
    const st = createRecognizer();
    const det = tracked(detection('two'));
    for (let i = 0; i < 4; i++) recognize(st, frame([det], i * 33, i));
    const out = recognize(st, frame([{ ...det, lostFrames: 1, presence: 0.5 }], 5 * 33)).out.hands[0]!;
    expect(out.coasting).toBe(true);
    expect(out.pose.pose).toBe('two');
  });
});

describe('hysteresis', () => {
  it('a finger hovering between the exit and enter thresholds does not flicker', () => {
    // Find a pinky bend whose extension sits inside the hysteresis band.
    let hover: HandShape | null = null;
    for (let k = 0.2; k < 2.5 && !hover; k += 0.02) {
      const shape = { ...shapeFor('four'), pinky: [0.5 * k, 0.8 * k, 0.5 * k] as [number, number, number] };
      const e = extensionsOf(placeHand(buildLocalHand(shape), PLACE).world)[4]!;
      if (e > CFG.extendExit + 0.02 && e < CFG.extendEnter - 0.02) hover = shape;
    }
    expect(hover).not.toBeNull();
    const clean = placeHand(buildLocalHand(shapeFor('four')), PLACE);
    const sloppy = placeHand(buildLocalHand(hover!), PLACE);
    const st = createRecognizer();
    const states: boolean[] = [];
    for (let i = 0; i < 20; i++) {
      const lm = i < 3 || i % 2 ? clean : sloppy;
      const det = { ...lm, handedness: 'Right' as const, handednessScore: 0.95 };
      const h = recognize(st, frame([tracked(det)], i * 33, i)).out.hands[0]!;
      states.push(h.fingers.pinky.extended);
      if (i > 3) expect(h.pose.pose).toBe('four');
    }
    expect(states.slice(1).every(Boolean)).toBe(true);
  });
});
