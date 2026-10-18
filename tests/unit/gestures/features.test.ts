import { describe, expect, it } from 'vitest';
import { depthFromScale, imageScale, palmOrientation, pinchAmount } from '../../../src/gestures/features';
import { createRecognizer, recognize } from '../../../src/gestures/recognizer';
import { syntheticHand } from '../../../src/gestures/testing/synthetic';
import { ASPECT, detection, frame, tracked } from '../support/frames';

const deg = (d: number) => (d * Math.PI) / 180;

describe('palm orientation', () => {
  for (const handedness of ['Left', 'Right'] as const) {
    it(`recovers roll, pitch and yaw independently (${handedness})`, () => {
      for (const r of [-60, -20, 0, 30, 70]) {
        const { world } = syntheticHand('open', { handedness, roll: deg(r) });
        expect(palmOrientation(world, handedness).roll).toBeCloseTo(deg(r), 1);
      }
      for (const p of [-40, 0, 35]) {
        const { world } = syntheticHand('open', { handedness, pitch: deg(p) });
        expect(palmOrientation(world, handedness).pitch).toBeCloseTo(deg(p), 1);
      }
      for (const y of [-50, 0, 45]) {
        const { world } = syntheticHand('open', { handedness, yaw: deg(y) });
        expect(palmOrientation(world, handedness).yaw).toBeCloseTo(deg(y), 1);
      }
    });
  }

  it('knows whether the palm or the back of the hand faces the camera', () => {
    const front = syntheticHand('open', { handedness: 'Right' });
    const back = syntheticHand('open', { handedness: 'Right', yaw: Math.PI });
    expect(palmOrientation(front.world, 'Right').palmFacing).toBeGreaterThan(0.9);
    expect(palmOrientation(back.world, 'Right').palmFacing).toBeLessThan(-0.9);
  });
});

describe('depth and scale', () => {
  it('image scale is robust to tilt (max over segments)', () => {
    const flat = syntheticHand('open', { imageScale: 0.25, aspect: ASPECT });
    const tilted = syntheticHand('open', { imageScale: 0.25, aspect: ASPECT, pitch: deg(50) });
    const a = imageScale(flat.image, flat.world, ASPECT);
    const b = imageScale(tilted.image, tilted.world, ASPECT);
    expect(Math.abs(a - b) / a).toBeLessThan(0.12);
  });

  it('depth decreases as the hand gets bigger in frame', () => {
    const depths = [0.1, 0.2, 0.35, 0.5].map((s) => {
      const h = syntheticHand('open', { imageScale: s, aspect: ASPECT });
      return depthFromScale(imageScale(h.image, h.world, ASPECT));
    });
    for (let i = 1; i < depths.length; i++) expect(depths[i]!).toBeLessThan(depths[i - 1]!);
    expect(depths[0]!).toBeGreaterThan(0.6);
    expect(depths[3]!).toBeLessThan(0.3);
  });
});

describe('pinch and continuous features', () => {
  it('pinch is ~0 for touching tips and ~1 for an open hand', () => {
    expect(pinchAmount(syntheticHand('pinch').world)).toBeLessThan(0.05);
    expect(pinchAmount(syntheticHand('open').world)).toBeGreaterThan(0.8);
  });

  it('palm height is 1 at the top of the frame and openness tracks the pose', () => {
    const st = createRecognizer();
    const top = recognize(st, frame([tracked(detection('open', { cy: 0.15 }))], 0)).out.hands[0]!;
    expect(top.features.palmY).toBeGreaterThan(0.8);
    expect(top.features.openness).toBeGreaterThan(0.85);
    const st2 = createRecognizer();
    const low = recognize(st2, frame([tracked(detection('fist', { cy: 0.85 }))], 0)).out.hands[0]!;
    expect(low.features.palmY).toBeLessThan(0.2);
    expect(low.features.openness).toBeLessThan(0.15);
  });

  it('measures palm velocity in frame-heights per second with y up', () => {
    const st = createRecognizer();
    let v = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < 12; i++) {
      // Moving right at 1 frame-width/s (= ASPECT frame-heights/s) and up at 0.5 frame-heights/s.
      const det = detection('open', { cx: 0.3 + i * 0.033, cy: 0.7 - i * 0.0165 });
      v = recognize(st, frame([tracked(det)], i * 33, i)).out.hands[0]!.features.velocity;
    }
    expect(v.x).toBeCloseTo(ASPECT, 0);
    expect(v.y).toBeCloseTo(0.5, 1);
  });

  it('two-hand distance and angle', () => {
    const st = createRecognizer();
    const a = tracked(detection('open', { cx: 0.25, cy: 0.5, handedness: 'Left' }), 1, 'primary');
    const b = tracked(detection('open', { cx: 0.75, cy: 0.5 }), 2, 'secondary');
    const out = recognize(st, frame([a, b], 0)).out;
    expect(out.twoHand!.distance).toBeCloseTo(0.5 * ASPECT, 1);
    expect(out.twoHand!.angle).toBeCloseTo(0, 1);
  });
});
