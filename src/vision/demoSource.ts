// No-camera demo: animates two synthetic hands through the real tracker + recognizer so the whole UI can be
// explored (and tested) without a webcam. Runs on the main thread; it is a few microseconds per frame.

import { createRecognizer, recognize } from '../gestures/recognizer';
import { buildLocalHand, placeHand, shapeFor } from '../gestures/testing/synthetic';
import type { PoseId } from '../gestures/types';
import type { GestureMessage } from './visionClient';
import { HandTracker } from './tracker';
import { wallNow, type Detection, type VisionFrame } from './types';

const PRIMARY_CYCLE: Array<Exclude<PoseId, 'none'>> = [
  'open',
  'one',
  'two',
  'three',
  'four',
  'fist',
  'indexPinky',
  'thumbIndexPinky',
];
const SECONDARY_CYCLE: Array<Exclude<PoseId, 'none'>> = ['open', 'open', 'pinch', 'open', 'fist', 'two'];
const ASPECT = 16 / 9;

export class DemoSource {
  private timer: ReturnType<typeof setInterval> | null = null;
  private tracker = new HandTracker();
  private recognizer = createRecognizer();
  private frameId = 0;
  private t0 = performance.now();
  private locals = new Map<string, Float64Array>();

  constructor(private onGesture: (msg: GestureMessage) => void) {}

  start(fps = 30): void {
    this.timer = setInterval(() => this.tick(), 1000 / fps);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private local(pose: Exclude<PoseId, 'none'>): Float64Array {
    let l = this.locals.get(pose);
    if (!l) this.locals.set(pose, (l = buildLocalHand(shapeFor(pose))));
    return l;
  }

  private tick() {
    const s = (performance.now() - this.t0) / 1000;
    const pPose = PRIMARY_CYCLE[Math.floor(s / 1.4) % PRIMARY_CYCLE.length]!;
    const sPose = SECONDARY_CYCLE[Math.floor(s / 1.1) % SECONDARY_CYCLE.length]!;
    const noise = { image: 0.0015, world: 0.002 };
    const left = placeHand(
      this.local(pPose),
      {
        handedness: 'Left',
        roll: 0.35 * Math.sin(s * 0.9),
        pitch: 0.2 * Math.sin(s * 0.6),
        yaw: 0.3 * Math.sin(s * 0.5),
        cx: 0.27 + 0.03 * Math.sin(s * 1.3),
        cy: 0.55 + 0.05 * Math.cos(s * 1.1),
        imageScale: 0.24,
        aspect: ASPECT,
      },
      noise,
    );
    const right = placeHand(
      this.local(sPose),
      {
        handedness: 'Right',
        roll: -0.25 + 0.3 * Math.sin(s * 1.7),
        pitch: 0.15 * Math.cos(s * 0.8),
        yaw: 0,
        cx: 0.72 + 0.08 * Math.cos(s * 0.7),
        cy: 0.5 + 0.22 * Math.sin(s * 0.7),
        imageScale: 0.22 + 0.04 * Math.sin(s * 0.4),
        aspect: ASPECT,
      },
      noise,
    );
    const dets: Detection[] = [
      { ...left, handedness: 'Left', handednessScore: 0.97 },
      { ...right, handedness: 'Right', handednessScore: 0.97 },
    ];
    const now = wallNow();
    const hands = this.tracker.update(dets, now, ASPECT);
    const vf: VisionFrame = {
      frameId: this.frameId++,
      captureTime: now,
      captureTimeSource: 'estimated',
      detectStart: now,
      detectEnd: now,
      aspect: ASPECT,
      brightness: 0.5,
      hands,
    };
    const { out } = recognize(this.recognizer, vf, wallNow);
    this.onGesture({
      frame: out,
      overlay: hands.map((h) => ({
        id: h.id,
        role: h.role,
        handedness: h.handedness,
        landmarks: h.landmarks.slice(),
      })),
      aspect: ASPECT,
      captureTimeSource: 'estimated',
      receivedAt: wallNow(),
    });
  }
}
