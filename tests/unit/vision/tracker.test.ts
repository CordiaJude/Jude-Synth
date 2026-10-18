import { describe, expect, it } from 'vitest';
import { HandTracker } from '../../../src/vision/tracker';
import { mulberry32 } from '../../../src/gestures/testing/synthetic';
import { ASPECT, detection } from '../support/frames';

describe('HandTracker', () => {
  it('assigns roles by screen side and keeps IDs stable as hands cross', () => {
    const tracker = new HandTracker();
    const rng = mulberry32(3);
    const ids = new Map<string, number>();
    const roles = new Map<string, string>();
    for (let i = 0; i <= 60; i++) {
      const t = i * 33;
      const u = i / 60;
      // Left hand moves 0.2 → 0.8, right hand 0.8 → 0.2; they pass each other at frame 30.
      const left = detection('open', { handedness: 'Left', cx: 0.2 + 0.6 * u, cy: 0.5 + 0.05 * Math.sin(u * 6) }, undefined, rng);
      const right = detection('fist', { handedness: 'Right', cx: 0.8 - 0.6 * u, cy: 0.45 }, undefined, rng);
      // MediaPipe labels flip randomly while hands overlap.
      if (i > 25 && i < 35 && rng() < 0.5) {
        left.handedness = 'Right';
        right.handedness = 'Left';
      }
      // Occasionally only one hand is detected while they overlap.
      const dets = i === 30 ? [right] : [left, right];
      const hands = tracker.update(dets, t, ASPECT);
      // Identify each output track by which synthetic hand is nearest.
      for (const h of hands) {
        if (h.lostFrames > 0) continue;
        const x = h.landmarks[9 * 3]!;
        const expectedX = { L: 0.2 + 0.6 * u, R: 0.8 - 0.6 * u };
        const who = Math.abs(x - expectedX.L) < Math.abs(x - expectedX.R) ? 'L' : 'R';
        if (Math.abs(expectedX.L - expectedX.R) < 0.06) continue; // too close to judge
        if (!ids.has(who)) ids.set(who, h.id);
        if (!roles.has(who)) roles.set(who, h.role);
        expect(h.id, `frame ${i} ${who}`).toBe(ids.get(who));
        expect(h.role).toBe(roles.get(who));
      }
    }
    expect(roles.get('L')).toBe('primary');
    expect(roles.get('R')).toBe('secondary');
  });

  it('coasts through a short dropout and drops after maxLostFrames', () => {
    const tracker = new HandTracker({ ...new HandTracker().config, maxLostFrames: 3 });
    const det = detection('open', { cx: 0.3 });
    const [first] = tracker.update([det], 0, ASPECT);
    for (let i = 1; i <= 3; i++) {
      const hands = tracker.update([], i * 33, ASPECT);
      expect(hands).toHaveLength(1);
      expect(hands[0]!.lostFrames).toBe(i);
    }
    expect(tracker.update([detection('open', { cx: 0.31 })], 4 * 33, ASPECT)[0]!.id).toBe(first!.id);
    for (let i = 5; i <= 9; i++) tracker.update([], i * 33, ASPECT);
    expect(tracker.update([], 10 * 33, ASPECT)).toHaveLength(0);
  });

  it('smooths handedness: a single wrong label does not flip the track', () => {
    const tracker = new HandTracker();
    for (let i = 0; i < 20; i++) tracker.update([detection('open', { handedness: 'Right', cx: 0.6 })], i * 33, ASPECT);
    const flipped = detection('open', { handedness: 'Right', cx: 0.6 });
    flipped.handedness = 'Left';
    const [h] = tracker.update([flipped], 20 * 33, ASPECT);
    expect(h!.handedness).toBe('Right');
  });

  it('gives a lone hand the free role when a second hand appears', () => {
    const tracker = new HandTracker();
    const [a] = tracker.update([detection('open', { cx: 0.7 })], 0, ASPECT);
    expect(a!.role).toBe('secondary');
    const hands = tracker.update([detection('open', { cx: 0.7 }), detection('fist', { cx: 0.75, handedness: 'Left' })], 33, ASPECT);
    expect(new Set(hands.map((h) => h.role))).toEqual(new Set(['primary', 'secondary']));
    expect(hands.find((h) => h.id === a!.id)!.role).toBe('secondary');
  });
});
