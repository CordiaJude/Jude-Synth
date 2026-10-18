import { describe, expect, it } from 'vitest';
import { buildCalibration } from '../../../src/gestures/calibration';
import { createRecognizer, extensionsOf, recognize } from '../../../src/gestures/recognizer';
import {
  buildLocalHand,
  mulberry32,
  placeHand,
  shapeFor,
  type HandShape,
} from '../../../src/gestures/testing/synthetic';
import { ASPECT, frame, tracked } from '../support/frames';

/** A user whose "open" hand is never fully straight and whose fist is loose. */
const stiffOpen = (): HandShape => {
  const s = shapeFor('open');
  const bent: [number, number, number] = [0.5, 0.75, 0.45];
  return { ...s, index: bent, middle: bent, ring: bent, pinky: bent };
};
const looseFist = (): HandShape => {
  const s = shapeFor('fist');
  const loose: [number, number, number] = [1.1, 1.2, 0.7];
  return { ...s, index: loose, middle: loose, ring: loose, pinky: loose };
};

const sample = (shape: HandShape, rng: () => number, scale = 0.25) => {
  const { image, world } = placeHand(
    buildLocalHand(shape),
    { handedness: 'Right', roll: 0, pitch: 0, yaw: 0, cx: 0.5, cy: 0.5, imageScale: scale, aspect: ASPECT },
    { image: 0.002, world: 0.003 },
    rng,
  );
  return { image, world, aspect: ASPECT };
};

describe('calibration', () => {
  it('stretches a stiff user’s range so their open hand reads fully open', () => {
    const rng = mulberry32(4);
    const open = Array.from({ length: 30 }, () => sample(stiffOpen(), rng));
    const fist = Array.from({ length: 30 }, () => sample(looseFist(), rng));
    const cal = buildCalibration({ open, fist }, 0);
    // Median over fresh noisy samples, per finger (index..pinky).
    const medianExt = (shape: () => HandShape, c: typeof cal | null) => {
      const runs = Array.from({ length: 15 }, () => extensionsOf(sample(shape(), rng).world, c));
      return [1, 2, 3, 4].map((f) => runs.map((r) => r[f]!).sort((a, b) => a - b)[7]!);
    };
    const before = medianExt(looseFist, null);
    const openAfter = medianExt(stiffOpen, cal);
    const fistAfter = medianExt(looseFist, cal);
    expect(Math.min(...openAfter)).toBeGreaterThan(0.9);
    expect(Math.max(...fistAfter)).toBeLessThan(0.1);
    // Without calibration this loose fist reads as partly open.
    expect(Math.max(...before)).toBeGreaterThan(0.2);
  });

  it('sets depth so the calibration distance is mid-range', () => {
    const rng = mulberry32(5);
    const open = Array.from({ length: 10 }, () => sample(shapeFor('open'), rng, 0.3));
    const fist = Array.from({ length: 10 }, () => sample(shapeFor('fist'), rng, 0.3));
    const cal = buildCalibration({ open, fist }, 0);
    const st = createRecognizer({}, cal);
    const s = sample(shapeFor('open'), rng, 0.3);
    const h = recognize(st, frame([tracked({ ...s, handedness: 'Right', handednessScore: 0.95 })], 0)).out
      .hands[0]!;
    expect(h.features.depth).toBeGreaterThan(0.35);
    expect(h.features.depth).toBeLessThan(0.65);
  });

  it('keeps defaults for fingers whose samples do not separate', () => {
    const rng = mulberry32(6);
    const open = Array.from({ length: 5 }, () => sample(shapeFor('fist'), rng));
    const fist = Array.from({ length: 5 }, () => sample(shapeFor('fist'), rng));
    const cal = buildCalibration({ open, fist }, 0);
    expect(cal.fingerExtension.index).toEqual(
      createRecognizer().calibration?.fingerExtension.index ?? cal.fingerExtension.index,
    );
    expect(cal.fingerExtension.index.open).toBeGreaterThan(cal.fingerExtension.index.curled + 0.25);
  });
});
