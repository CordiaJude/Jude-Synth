// Labeled landmark recordings ("captures") — the format of tests/fixtures/landmarks/*.json. Recorded with
// the capture & label tool in the debug panel, replayed by the corpus accuracy test.

import { APP_NAME } from '../config/app';
import type { PoseId } from '../gestures/types';
import type { HandRole, Handedness } from './types';

export type CaptureLabel = PoseId | 'transition';

export interface CaptureHand {
  role: HandRole;
  handedness: Handedness;
  score: number;
  /** Unfiltered display-space landmarks, rounded to 5 decimals. */
  image: number[];
  world: number[];
}

export interface CaptureFrame {
  /** ms since the recording started (camera capture time). */
  t: number;
  label: CaptureLabel;
  labelRole: HandRole | 'both';
  hands: CaptureHand[];
}

export interface CaptureFile {
  version: 1;
  app: string;
  createdAt: string;
  aspect: number;
  frameRate: number;
  notes?: string;
  /** Name of the companion video file, if one was recorded. */
  video?: string;
  frames: CaptureFrame[];
}

const round = (xs: ArrayLike<number>) => Array.from(xs, (v) => Math.round(v * 1e5) / 1e5);

export class CaptureRecorder {
  private frames: CaptureFrame[] = [];
  private startedAt = 0;
  label: CaptureLabel = 'transition';
  labelRole: HandRole | 'both' = 'primary';

  start(now: number): void {
    this.frames = [];
    this.startedAt = now;
  }

  add(
    captureTime: number,
    hands: Array<{
      role: HandRole;
      handedness: Handedness;
      presence: number;
      raw: ArrayLike<number>;
      rawWorld: ArrayLike<number>;
    }>,
  ): void {
    this.frames.push({
      t: Math.round((captureTime - this.startedAt) * 10) / 10,
      label: this.label,
      labelRole: this.labelRole,
      hands: hands.map((h) => ({
        role: h.role,
        handedness: h.handedness,
        score: Math.round(h.presence * 1000) / 1000,
        image: round(h.raw),
        world: round(h.rawWorld),
      })),
    });
  }

  get length(): number {
    return this.frames.length;
  }

  finish(meta: { aspect: number; frameRate: number; video?: string }): CaptureFile {
    return { version: 1, app: APP_NAME, createdAt: new Date().toISOString(), ...meta, frames: this.frames };
  }
}
