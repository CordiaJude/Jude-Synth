// Replays a labeled capture through the same tracker + recognizer the app uses, and scores it.

import type { CaptureFile } from '../../vision/capture';
import { HandTracker } from '../../vision/tracker';
import type { Detection, VisionFrame } from '../../vision/types';
import { createRecognizer, recognize } from '../recognizer';
import type { PoseId } from '../types';

export interface ReplayScore {
  judged: number;
  correct: number;
  accuracy: number;
  confusion: Record<string, Record<string, number>>;
}

/**
 * Frames within `settleMs` of a label change are skipped (people press the key a moment before or after
 * their hand gets there), as are 'transition' frames and frames where the labeled hand isn't visible.
 */
export function scoreCapture(file: CaptureFile, settleMs = 150): ReplayScore {
  const tracker = new HandTracker();
  const recognizer = createRecognizer();
  const confusion: ReplayScore['confusion'] = {};
  let judged = 0;
  let correct = 0;
  let lastLabel: string | null = null;
  let labelSince = 0;

  file.frames.forEach((f, i) => {
    if (f.label !== lastLabel) {
      lastLabel = f.label;
      labelSince = f.t;
    }
    const dets: Detection[] = f.hands.map((h) => ({
      image: Float32Array.from(h.image),
      world: Float32Array.from(h.world),
      handedness: h.handedness,
      handednessScore: h.score,
    }));
    const hands = tracker.update(dets, f.t, file.aspect);
    const vf: VisionFrame = {
      frameId: i,
      captureTime: f.t,
      captureTimeSource: 'estimated',
      detectStart: f.t,
      detectEnd: f.t,
      aspect: file.aspect,
      hands,
    };
    const { out } = recognize(recognizer, vf);
    if (f.label === 'transition' || f.t - labelSince < settleMs) return;

    // Match each recorded (labeled) hand to the replayed hand nearest its wrist.
    for (const rec of f.hands) {
      if (f.labelRole !== 'both' && rec.role !== f.labelRole) continue;
      let best: (typeof out.hands)[number] | null = null;
      let bestD = Infinity;
      for (const h of out.hands) {
        const tracked = hands.find((t) => t.id === h.id)!;
        const d = Math.hypot(tracked.raw[0]! - rec.image[0]!, tracked.raw[1]! - rec.image[1]!);
        if (d < bestD) {
          bestD = d;
          best = h;
        }
      }
      if (!best || bestD > 0.05) continue;
      judged++;
      const got: PoseId = best.pose.pose;
      if (got === f.label) correct++;
      else {
        confusion[f.label] ??= {};
        confusion[f.label]![got] = (confusion[f.label]![got] ?? 0) + 1;
      }
    }
  });
  return { judged, correct, accuracy: judged ? correct / judged : NaN, confusion };
}
