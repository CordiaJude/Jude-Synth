import { describe, expect, it } from 'vitest';
import { createRecognizer, recognize } from '../../../src/gestures/recognizer';
import {
  buildLocalHand,
  CURLED,
  placeHand,
  shapeFor,
  STRAIGHT,
  type FingerFlex,
} from '../../../src/gestures/testing/synthetic';
import type { GestureEvent } from '../../../src/gestures/types';
import { ASPECT, frame, tracked } from '../support/frames';

const lerpFlex = (a: FingerFlex, b: FingerFlex, u: number): FingerFlex =>
  [0, 1, 2].map((i) => a[i]! + (b[i]! - a[i]!) * u) as FingerFlex;

/** Middle finger moving from curled (pose "one") toward straight (pose "two"); u per frame. */
function run(us: number[], predictive: boolean) {
  const st = createRecognizer({ predictiveOnset: predictive });
  const events: Array<GestureEvent & { frame: number }> = [];
  us.forEach((u, i) => {
    const shape = { ...shapeFor('one'), middle: lerpFlex(CURLED, STRAIGHT, u) };
    const { image, world } = placeHand(buildLocalHand(shape), {
      handedness: 'Right',
      roll: 0.2,
      pitch: 0,
      yaw: 0,
      cx: 0.5,
      cy: 0.5,
      imageScale: 0.25,
      aspect: ASPECT,
    });
    const out = recognize(
      st,
      frame([tracked({ image, world, handedness: 'Right', handednessScore: 0.95 })], i * 33, i),
    ).out;
    for (const e of out.events) events.push({ ...e, frame: i });
  });
  return events.filter((e) => e.type === 'poseEnter') as Array<
    Extract<GestureEvent, { pose: unknown }> & { frame: number }
  >;
}

describe('predictive onset', () => {
  const extend = [0, 0, 0, 0, 0.15, 0.35, 0.55, 0.75, 1, 1, 1, 1];

  it('announces the next pose at least one frame before it is committed', () => {
    const withP = run(extend, true);
    const without = run(extend, false);
    const committed = without.find((e) => e.pose === 'two')!;
    const early = withP.find((e) => e.pose === 'two' && e.tentative)!;
    expect(committed).toBeTruthy();
    expect(early).toBeTruthy();
    expect(early.frame).toBeLessThanOrEqual(committed.frame - 1);
    // …and the committed event still arrives, with no revert.
    expect(withP.some((e) => e.pose === 'two' && !e.tentative)).toBe(true);
    expect(withP.some((e) => e.revert)).toBe(false);
  });

  it('reverts a prediction that does not come true', () => {
    // The middle finger starts to rise fast (prediction fires) but drops back before committing.
    const fakeOut = [0, 0, 0, 0, 0.2, 0.42, 0.3, 0.1, 0, 0, 0, 0];
    const ev = run(fakeOut, true);
    const tentative = ev.find((e) => e.tentative && !e.revert && e.pose === 'two');
    expect(tentative).toBeTruthy();
    const revert = ev.find((e) => e.revert);
    expect(revert).toBeTruthy();
    expect(revert!.pose).toBe('one');
    expect(revert!.frame).toBe(tentative!.frame + 1);
    expect(ev.some((e) => e.pose === 'two' && !e.tentative)).toBe(false);
  });

  it('is off by default', () => {
    expect(run(extend, false).some((e) => e.tentative)).toBe(false);
  });
});
