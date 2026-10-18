import { describe, expect, it } from 'vitest';
import { createRecognizer, recognize } from '../../../src/gestures/recognizer';
import {
  buildLocalHand,
  mulberry32,
  placeHand,
  shapeFor,
  varyShape,
  type Placement,
} from '../../../src/gestures/testing/synthetic';
import { POSE_IDS, type PoseId } from '../../../src/gestures/types';
import { ASPECT, detection, frame, tracked } from '../support/frames';

/** Per-joint anatomical jitter (radians). */
const VARIATION = 0.25;

const POSES = POSE_IDS.filter((p): p is Exclude<PoseId, 'none'> => p !== 'none');
const deg = (d: number) => (d * Math.PI) / 180;
const range = (lo: number, hi: number, step: number) => {
  const out: number[] = [];
  for (let v = lo; v <= hi + 1e-9; v += step) out.push(v);
  return out;
};

/**
 * Feed one synthetic hand for 6 frames (200 ms at 30 fps, enough to pass debounce) and return the committed pose. Each sample
 * gets its own anatomical variation (sloppy fingers); every frame gets fresh sensor noise.
 */
function classify(pose: Exclude<PoseId, 'none'>, pl: Omit<Placement, 'aspect'>, rng: () => number) {
  const st = createRecognizer();
  const local = buildLocalHand(varyShape(shapeFor(pose), rng, VARIATION));
  let result: PoseId = 'none';
  for (let f = 0; f < 6; f++) {
    const { image, world } = placeHand(local, { ...pl, aspect: ASPECT }, { image: 0.002, world: 0.004 }, rng);
    const det = { image, world, handedness: pl.handedness, handednessScore: 0.95 };
    result = recognize(st, frame([tracked(det)], f * 33, f)).out.hands[0]!.pose.pose;
  }
  return result;
}

describe('pose recognition is rotation invariant (synthetic grid)', () => {
  const rolls = range(-75, 75, 25);
  const pitches = range(-45, 45, 15);
  const yaws = range(-60, 60, 20);

  for (const handedness of ['Left', 'Right'] as const) {
    it(`≥99% accuracy for every pose, ${handedness} hand, ${rolls.length * pitches.length * yaws.length} orientations each`, () => {
      const rng = mulberry32(handedness === 'Left' ? 11 : 12);
      const confusion: Record<string, Record<string, number>> = {};
      let correct = 0;
      let total = 0;
      for (const pose of POSES) {
        for (const roll of rolls)
          for (const pitch of pitches)
            for (const yaw of yaws) {
              const got = classify(
                pose,
                { handedness, roll: deg(roll), pitch: deg(pitch), yaw: deg(yaw), cx: 0.3 + rng() * 0.4, cy: 0.3 + rng() * 0.4, imageScale: 0.15 + rng() * 0.2 },
                rng,
              );
              total++;
              if (got === pose) correct++;
              else {
                confusion[pose] ??= {};
                confusion[pose][got] = (confusion[pose][got] ?? 0) + 1;
              }
            }
      }
      const accuracy = correct / total;
      expect(accuracy, `confusions: ${JSON.stringify(confusion)}`).toBeGreaterThanOrEqual(0.99);
      for (const pose of POSES) {
        const misses = Object.values(confusion[pose] ?? {}).reduce((a, b) => a + b, 0);
        expect(misses / (total / POSES.length), `${pose}: ${JSON.stringify(confusion[pose])}`).toBeLessThan(0.03);
      }
    });
  }
});

describe('pose stability', () => {
  it('debounces: a single-frame glitch does not change the committed pose', () => {
    const st = createRecognizer({ poseDebounceMs: 45 });
    const seq: Array<Exclude<PoseId, 'none'>> = ['two', 'two', 'two', 'three', 'two', 'two'];
    const out = seq.map((p, i) => recognize(st, frame([tracked(detection(p))], i * 33, i)).out.hands[0]!.pose.pose);
    expect(out.slice(2)).toEqual(['two', 'two', 'two', 'two']);
  });

  it('commits a real change within debounce + one frame', () => {
    const st = createRecognizer({ poseDebounceMs: 45 });
    const seq: Array<Exclude<PoseId, 'none'>> = ['fist', 'fist', 'fist', 'open', 'open', 'open'];
    const out = seq.map((p, i) => recognize(st, frame([tracked(detection(p))], i * 33, i)).out.hands[0]!.pose.pose);
    expect(out[5]).toBe('open');
    expect(out.indexOf('open')).toBeLessThanOrEqual(5);
  });

  it('reports confidence in [0,1] with the committed pose ranked first', () => {
    const st = createRecognizer();
    let pose = null;
    for (let i = 0; i < 4; i++) pose = recognize(st, frame([tracked(detection('four'))], i * 33, i)).out.hands[0]!.pose;
    expect(pose!.pose).toBe('four');
    expect(pose!.ranked[0]!.pose).toBe('four');
    expect(pose!.confidence).toBeGreaterThan(0.6);
    expect(pose!.confidence).toBeLessThanOrEqual(1);
  });

  it('counts extended fingers', () => {
    const st = createRecognizer();
    let count = 0;
    for (let i = 0; i < 3; i++) count = recognize(st, frame([tracked(detection('three'))], i * 33, i)).out.hands[0]!.count;
    expect(count).toBe(3);
  });
});

describe('baseline comparison', () => {
  it('the naive "tip.y < pip.y" rule breaks on rotated hands, ours does not', () => {
    const rng = mulberry32(99);
    let naiveOk = 0;
    let oursOk = 0;
    let n = 0;
    for (const pose of ['one', 'two', 'three', 'four', 'fist'] as const) {
      const expected = { one: 1, two: 2, three: 3, four: 4, fist: 0 }[pose];
      for (let k = 0; k < 120; k++) {
        const roll = deg((rng() * 2 - 1) * 120); // hands tilted up to sideways/upside-down
        const det = detection(pose, { roll, pitch: deg((rng() * 2 - 1) * 30) }, { image: 0.002, world: 0.004 }, rng);
        const naive = [[8, 6], [12, 10], [16, 14], [20, 18]].filter(([tip, pip]) => det.image[tip! * 3 + 1]! < det.image[pip! * 3 + 1]!).length;
        const st = createRecognizer();
        let ours = 0;
        for (let f = 0; f < 3; f++) {
          const h = recognize(st, frame([tracked(det)], f * 33, f)).out.hands[0]!;
          ours = [h.fingers.index, h.fingers.middle, h.fingers.ring, h.fingers.pinky].filter((x) => x.extended).length;
        }
        n++;
        if (naive === expected) naiveOk++;
        if (ours === expected) oursOk++;
      }
    }
    expect(oursOk / n).toBeGreaterThanOrEqual(0.99);
    expect(naiveOk / n).toBeLessThan(0.75);
  });
});
