// Session controller: owns the camera stream and the active gesture source (worker or demo) outside React.

import { cameraConstraints, detectCapabilities } from '../config/capabilities';
import { DemoSource } from '../vision/demoSource';
import type { WorkerSettings } from '../vision/protocol';
import { VisionClient } from '../vision/visionClient';
import { live } from './live';
import { ensureAudio, stopAudio } from './music';
import type { Calibration } from '../gestures/types';
import { useApp, type TrackingSettings } from './store';

let stream: MediaStream | null = null;
let client: VisionClient | null = null;
let demo: DemoSource | null = null;
let unsubscribeSettings: (() => void) | null = null;

export const capabilities = detectCapabilities();

export function getStream(): MediaStream | null {
  return stream;
}

function workerSettings(t: TrackingSettings): WorkerSettings {
  return {
    imageFilter: t.imageFilter,
    worldFilter: t.worldFilter,
    gestures: t.gestures,
    swapHandedness: t.swapHandedness,
    overlay: true,
    frameStride: 1,
  };
}

/** Explain a getUserMedia failure in plain language. */
function cameraErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
      return 'Camera permission was denied. You can allow it from the address bar, or try the demo instead.';
    case 'NotFoundError':
      return 'No camera was found. Plug one in, or try the demo instead.';
    case 'NotReadableError':
      return 'The camera is busy in another app. Close it there and try again.';
    default:
      return `Could not start the camera${err instanceof Error ? `: ${err.message}` : '.'}`;
  }
}

/** Ask for the camera: the stage mounts and calls startCamera with its video element. */
export function requestCamera(): void {
  void ensureAudio(); // inside the click handler: browsers only start audio on a user gesture
  useApp.getState().setPhase('starting', 'camera');
}

let starting = false;

export async function startCamera(video: HTMLVideoElement): Promise<void> {
  if (starting || stream) return; // idempotent (React StrictMode runs effects twice in dev)
  starting = true;
  try {
    await openCamera(video);
  } finally {
    starting = false;
  }
}

async function openCamera(video: HTMLVideoElement): Promise<void> {
  const app = useApp.getState();
  live.reset();
  try {
    stream = await navigator.mediaDevices.getUserMedia(cameraConstraints(capabilities));
  } catch (err) {
    useApp.getState().setPhase('error', 'camera', cameraErrorMessage(err));
    return;
  }
  video.srcObject = stream;
  await video.play().catch(() => undefined);

  client = new VisionClient({
    onGesture: (msg) => live.publish(msg),
    onStatus: (status) => {
      useApp.getState().setVision(status);
      if (status.error) useApp.getState().setPhase('error', 'camera', status.error);
      else if (status.ready && useApp.getState().phase === 'starting') useApp.getState().setPhase('running');
    },
  });
  await client.start(stream, video, workerSettings(app.tracking), app.tracking.preferGpu);
  client.setCalibration(useApp.getState().calibration);
  // First run (no saved calibration): walk the user through it.
  if (!useApp.getState().calibration) useApp.getState().setCalibrating(true);
  unsubscribeSettings = useApp.subscribe((s, prev) => {
    if (s.tracking !== prev.tracking) client?.updateSettings(workerSettings(s.tracking));
  });
}

/** Ask the worker to include unfiltered landmarks (capture tool). */
export function setCaptureRaw(enabled: boolean): void {
  client?.updateSettings({ captureRaw: enabled });
}

/** Play with keyboard / touch only — no camera at all. */
export function startManual(): void {
  void ensureAudio();
  live.reset();
  useApp.getState().setVision(null);
  useApp.getState().setPhase('running', 'manual');
}

/** Save (or clear) the user's calibration and apply it to the running recognizer. */
export function applyCalibration(calibration: Calibration | null): void {
  useApp.getState().setCalibration(calibration);
  client?.setCalibration(calibration);
}

export function startDemo(): void {
  void ensureAudio();
  live.reset();
  demo = new DemoSource((msg) => live.publish(msg));
  demo.start(30);
  useApp.getState().setVision(null);
  useApp.getState().setPhase('running', 'demo');
}

export function stopSession(): void {
  stopAudio();
  client?.stop();
  client = null;
  demo?.stop();
  demo = null;
  unsubscribeSettings?.();
  unsubscribeSettings = null;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  live.reset();
  useApp.getState().setVision(null);
  useApp.getState().setCalibrating(false);
  useApp.getState().setPhase('landing', null);
}
