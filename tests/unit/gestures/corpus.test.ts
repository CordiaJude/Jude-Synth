// Accuracy on REAL recorded hands (tests/fixtures/landmarks/*.json, made with the capture & label tool).
// This is the ≥95% acceptance bar. Skipped until recordings are added.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scoreCapture } from '../../../src/gestures/testing/replay';
import type { CaptureFile } from '../../../src/vision/capture';

const dir = path.resolve(__dirname, '../../fixtures/landmarks');
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

describe('recorded corpus accuracy', () => {
  it.skipIf(files.length === 0)('≥95% across all recordings', () => {
    let judged = 0;
    let correct = 0;
    const perFile: string[] = [];
    for (const name of files) {
      const capture = JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as CaptureFile;
      const s = scoreCapture(capture);
      judged += s.judged;
      correct += s.correct;
      perFile.push(
        `${name}: ${(s.accuracy * 100).toFixed(1)}% of ${s.judged} ${JSON.stringify(s.confusion)}`,
      );
    }
    expect(judged).toBeGreaterThan(0);
    expect(correct / judged, perFile.join('\n')).toBeGreaterThanOrEqual(0.95);
  });
});

describe('scoreCapture', () => {
  it('replays a synthetic capture end to end', async () => {
    const { syntheticHand } = await import('../../../src/gestures/testing/synthetic');
    const poses = ['open', 'fist', 'two', 'pinch'] as const;
    const frames: CaptureFile['frames'] = [];
    let t = 0;
    for (const pose of poses) {
      for (let i = 0; i < 20; i++, t += 33) {
        const { image, world } = syntheticHand(pose, { cx: 0.3, roll: i * 0.03, aspect: 16 / 9 });
        frames.push({
          t,
          label: i < 3 ? 'transition' : pose,
          labelRole: 'primary',
          hands: [
            {
              role: 'primary',
              handedness: 'Right',
              score: 0.95,
              image: Array.from(image),
              world: Array.from(world),
            },
          ],
        });
      }
    }
    const s = scoreCapture({ version: 1, app: 'test', createdAt: '', aspect: 16 / 9, frameRate: 30, frames });
    expect(s.judged).toBeGreaterThan(40);
    expect(s.accuracy).toBe(1);
  });
});
