// Main ⇄ vision-worker message protocol. Discriminated unions, structured-clone or transferable only.

import type { Calibration, GestureConfig, GestureFrame } from '../gestures/types';
import type { OneEuroParams } from './oneEuro';
import type { TrackerConfig } from './tracker';
import type { CaptureTimeSource, HandId, HandRole, Handedness } from './types';

export type Delegate = 'GPU' | 'CPU';
/** A: frames delivered inside the worker (MediaStreamTrackProcessor). B: ImageBitmaps posted from main. */
export type FrameTier = 'A' | 'B';

export interface WorkerSettings {
  imageFilter?: Partial<OneEuroParams>;
  worldFilter?: Partial<OneEuroParams>;
  tracker?: Partial<Omit<TrackerConfig, 'filter' | 'worldFilter'>>;
  gestures?: Partial<GestureConfig>;
  /** MediaPipe assumes selfie (mirrored) input; raw camera frames need labels swapped. Default true. */
  swapHandedness?: boolean;
  /** Send filtered landmarks for drawing the overlay. */
  overlay?: boolean;
  /** Also send unfiltered landmarks (capture & label tool). */
  captureRaw?: boolean;
  /** Process every Nth frame (weak devices). */
  frameStride?: number;
}

export type ToVisionWorker =
  | {
      type: 'init';
      wasmBase: string;
      modelUrl: string;
      preferGpu: boolean;
      frameRate: number;
      settings: WorkerSettings;
    }
  | { type: 'track'; track: MediaStreamTrack }
  | { type: 'stream'; readable: ReadableStream<VideoFrame> }
  | { type: 'frame'; bitmap: ImageBitmap; captureTime: number; captureTimeSource: CaptureTimeSource }
  | { type: 'settings'; settings: WorkerSettings }
  | { type: 'calibration'; calibration: Calibration | null }
  | { type: 'stop' };

export interface OverlayHand {
  id: HandId;
  role: HandRole;
  handedness: Handedness;
  landmarks: Float32Array;
  raw?: Float32Array;
  rawWorld?: Float32Array;
}

export interface WorkerStats {
  fps: number;
  detectMsP50: number;
  detectMsP95: number;
  /** captureTime → gesture ready, ms. */
  pipelineMsP50: number;
  pipelineMsP95: number;
  dropped: number;
}

export type FromVisionWorker =
  | { type: 'hello'; canProcessTrack: boolean }
  | { type: 'ready'; delegate: Delegate }
  | { type: 'tier'; tier: FrameTier }
  | {
      type: 'gesture';
      frame: GestureFrame;
      overlay: OverlayHand[] | null;
      aspect: number;
      captureTimeSource: CaptureTimeSource;
    }
  /** Tier B: a posted frame was not turned into a gesture (busy / not ready); main may send the next one. */
  | { type: 'dropped' }
  | { type: 'stats'; stats: WorkerStats; delegate: Delegate }
  | { type: 'error'; message: string; recoverable: boolean };
