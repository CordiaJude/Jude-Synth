/// <reference lib="webworker" />
// Vision worker: camera frames → MediaPipe HandLandmarker → tracker (IDs + One Euro) → gesture recognizer.
// The main thread only ever receives a small GestureFrame per frame.

import { FilesetResolver, HandLandmarker, type HandLandmarkerResult } from '@mediapipe/tasks-vision';
import { createRecognizer, recognize, setCalibration, setGestureConfig } from '../gestures/recognizer';
import { LANDMARK_FLOATS } from './landmarks';
import type {
  Delegate,
  FromVisionWorker,
  OverlayHand,
  ToVisionWorker,
  WorkerSettings,
  WorkerStats,
} from './protocol';
import { HandTracker } from './tracker';
import { wallNow, type CaptureTimeSource, type Detection, type VisionFrame } from './types';

declare const self: DedicatedWorkerGlobalScope;

let landmarker: HandLandmarker | null = null;
let delegate: Delegate = 'CPU';
let initMsg: Extract<ToVisionWorker, { type: 'init' }> | null = null;
let settings: Required<WorkerSettings> = {
  imageFilter: {},
  worldFilter: {},
  tracker: {},
  gestures: {},
  swapHandedness: true,
  overlay: true,
  captureRaw: false,
  frameStride: 1,
};
const tracker = new HandTracker();
const recognizer = createRecognizer();
let frameId = 0;
let lastTimestamp = 0;
let strideCounter = 0;
let running = true;
let frameRate = 30;
let ownedTrack: MediaStreamTrack | null = null;
let activeReader: ReadableStreamDefaultReader<VideoFrame> | null = null;

const post = (msg: FromVisionWorker, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

// ---- stats -------------------------------------------------------------------------------------------
const detectMs: number[] = [];
const pipelineMs: number[] = [];
let processedSinceStats = 0;
let dropped = 0;
let lastStatsAt = performance.now();

const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
};
const pushBounded = (xs: number[], v: number) => {
  xs.push(v);
  if (xs.length > 120) xs.shift();
};

function maybePostStats() {
  const now = performance.now();
  if (now - lastStatsAt < 1000) return;
  const stats: WorkerStats = {
    fps: (processedSinceStats * 1000) / (now - lastStatsAt),
    detectMsP50: pct(detectMs, 0.5),
    detectMsP95: pct(detectMs, 0.95),
    pipelineMsP50: pct(pipelineMs, 0.5),
    pipelineMsP95: pct(pipelineMs, 0.95),
    dropped,
  };
  processedSinceStats = 0;
  lastStatsAt = now;
  post({ type: 'stats', stats, delegate });
}

// ---- brightness (low-light warning) -------------------------------------------------------------------
let lumaCtx: OffscreenCanvasRenderingContext2D | null = null;
let brightness: number | undefined;
function sampleBrightness(src: CanvasImageSource) {
  try {
    lumaCtx ??= new OffscreenCanvas(16, 9).getContext('2d', { willReadFrequently: true });
    if (!lumaCtx) return;
    lumaCtx.drawImage(src, 0, 0, 16, 9);
    const px = lumaCtx.getImageData(0, 0, 16, 9).data;
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) sum += 0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]!;
    brightness = sum / (px.length / 4) / 255;
  } catch {
    brightness = undefined;
  }
}

// ---- MediaPipe ------------------------------------------------------------------------------------------
async function createLandmarker(useGpu: boolean): Promise<HandLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks(initMsg!.wasmBase, true);
  return HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: initMsg!.modelUrl, delegate: useGpu ? 'GPU' : 'CPU' },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.6,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}

/**
 * Software WebGL (SwiftShader, llvmpipe — common in VMs and on GPU-blocklisted machines) runs the GPU
 * delegate several times slower than WASM SIMD, so treat it as "no GPU".
 */
function hasHardwareWebGL2(): boolean {
  try {
    const gl = new OffscreenCanvas(1, 1).getContext('webgl2');
    if (!gl) return false;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(
      ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    );
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return !/swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer);
  } catch {
    return false;
  }
}

async function init(msg: Extract<ToVisionWorker, { type: 'init' }>) {
  initMsg = msg;
  frameRate = msg.frameRate || 30;
  applySettings(msg.settings);
  if (msg.preferGpu && hasHardwareWebGL2()) {
    try {
      landmarker = await createLandmarker(true);
      delegate = 'GPU';
    } catch (err) {
      console.warn('[vision] GPU delegate unavailable, falling back to CPU', err);
    }
  }
  if (!landmarker) {
    landmarker = await createLandmarker(false);
    delegate = 'CPU';
  }
  post({ type: 'ready', delegate });
}

/** A GPU delegate can initialise but fail on the first frame (driver quirks); rebuild on CPU once. */
async function fallbackToCpu(err: unknown) {
  if (delegate === 'CPU') throw err;
  console.warn('[vision] GPU detection failed, switching to CPU', err);
  landmarker?.close();
  landmarker = null;
  landmarker = await createLandmarker(false);
  delegate = 'CPU';
  post({ type: 'ready', delegate });
}

function applySettings(s: WorkerSettings) {
  settings = { ...settings, ...s };
  if (s.imageFilter || s.worldFilter) tracker.setFilter(s.imageFilter ?? {}, s.worldFilter ?? {});
  if (s.tracker) tracker.config = { ...tracker.config, ...s.tracker };
  if (s.gestures) setGestureConfig(recognizer, s.gestures);
}

/** MediaPipe result → display-space detections (mirrored x, corrected handedness). */
function toDetections(res: HandLandmarkerResult): Detection[] {
  const out: Detection[] = [];
  const hands = res.landmarks ?? [];
  const handednesses = res.handedness ?? [];
  for (let h = 0; h < hands.length; h++) {
    const lm = hands[h]!;
    const wl = res.worldLandmarks?.[h];
    if (lm.length !== 21 || !wl || wl.length !== 21) continue;
    const image = new Float32Array(LANDMARK_FLOATS);
    const world = new Float32Array(LANDMARK_FLOATS);
    for (let i = 0; i < 21; i++) {
      image[i * 3] = 1 - lm[i]!.x;
      image[i * 3 + 1] = lm[i]!.y;
      image[i * 3 + 2] = lm[i]!.z;
      world[i * 3] = -wl[i]!.x;
      world[i * 3 + 1] = wl[i]!.y;
      world[i * 3 + 2] = wl[i]!.z;
    }
    const cat = handednesses[h]?.[0];
    let label = cat?.categoryName === 'Left' ? 'Left' : 'Right';
    if (settings.swapHandedness) label = label === 'Left' ? 'Right' : 'Left';
    out.push({
      image,
      world,
      handedness: label as Detection['handedness'],
      handednessScore: cat?.score ?? 0.5,
    });
  }
  return out;
}

let busy = false;

async function process(
  src: VideoFrame | ImageBitmap,
  width: number,
  height: number,
  captureTime: number,
  captureTimeSource: CaptureTimeSource,
): Promise<boolean> {
  if (!landmarker) return false;
  const detectStart = wallNow();
  // detectForVideo needs strictly increasing timestamps (ms).
  const ts = Math.max(lastTimestamp + 1, Math.round(performance.now()));
  lastTimestamp = ts;
  let res: HandLandmarkerResult;
  try {
    res = landmarker.detectForVideo(src, ts);
  } catch (err) {
    await fallbackToCpu(err);
    return false;
  }
  const detectEnd = wallNow();
  if (frameId % 15 === 0) sampleBrightness(src);

  const aspect = width / height || 16 / 9;
  const hands = tracker.update(toDetections(res), captureTime, aspect);
  const vf: VisionFrame = {
    frameId: frameId++,
    captureTime,
    captureTimeSource,
    detectStart,
    detectEnd,
    aspect,
    brightness,
    hands,
  };
  const { out } = recognize(recognizer, vf, wallNow);

  let overlay: OverlayHand[] | null = null;
  const transfer: Transferable[] = [];
  if (settings.overlay || settings.captureRaw) {
    overlay = hands.map((h) => {
      const o: OverlayHand = {
        id: h.id,
        role: h.role,
        handedness: h.handedness,
        landmarks: h.landmarks.slice(),
      };
      transfer.push(o.landmarks.buffer);
      if (settings.captureRaw) {
        o.raw = h.raw.slice();
        o.rawWorld = h.rawWorld.slice();
        transfer.push(o.raw.buffer, o.rawWorld.buffer);
      }
      return o;
    });
  }
  post({ type: 'gesture', frame: out, overlay, aspect, captureTimeSource }, transfer);

  pushBounded(detectMs, detectEnd - detectStart);
  pushBounded(pipelineMs, out.timing.recognizeEnd - captureTime);
  processedSinceStats++;
  maybePostStats();
  return true;
}

// ---- Tier A: frames delivered in the worker -------------------------------------------------------------

/** Best estimate of when the camera captured this VideoFrame, as wall-clock ms. */
function videoFrameCaptureTime(frame: VideoFrame): { t: number; source: CaptureTimeSource } {
  const arrived = wallNow();
  const fallback = { t: arrived - 1000 / frameRate, source: 'estimated' as const };
  try {
    const md = (frame as VideoFrame & { metadata?: () => { captureTime?: number } }).metadata?.();
    if (md && typeof md.captureTime === 'number') {
      const t = performance.timeOrigin + md.captureTime;
      if (t <= arrived && arrived - t < 500) return { t, source: 'videoFrame' };
    }
  } catch {
    /* metadata() not supported */
  }
  return fallback;
}

async function pump(readable: ReadableStream<VideoFrame>) {
  post({ type: 'tier', tier: 'A' });
  const reader = readable.getReader();
  activeReader = reader;
  while (running) {
    const { value: frame, done } = await reader.read();
    if (done || !frame) break;
    if (busy || !landmarker || strideCounter++ % settings.frameStride !== 0) {
      if (busy) dropped++;
      frame.close();
      continue;
    }
    busy = true;
    try {
      const { t, source } = videoFrameCaptureTime(frame);
      await process(frame, frame.displayWidth, frame.displayHeight, t, source);
    } catch (err) {
      post({ type: 'error', message: String(err), recoverable: true });
    } finally {
      frame.close();
      busy = false;
    }
  }
  reader.releaseLock();
}

// ---- messages -------------------------------------------------------------------------------------------
self.onmessage = async (e: MessageEvent<ToVisionWorker>) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'init':
        await init(msg);
        break;
      case 'track': {
        const Processor = (
          self as unknown as {
            MediaStreamTrackProcessor?: new (o: { track: MediaStreamTrack; maxBufferSize?: number }) => {
              readable: ReadableStream<VideoFrame>;
            };
          }
        ).MediaStreamTrackProcessor;
        if (!Processor) throw new Error('MediaStreamTrackProcessor unavailable in worker');
        ownedTrack = msg.track;
        void pump(new Processor({ track: msg.track, maxBufferSize: 1 }).readable);
        break;
      }
      case 'stream':
        void pump(msg.readable);
        break;
      case 'frame':
        if (busy || !landmarker) {
          dropped++;
          msg.bitmap.close();
          post({ type: 'dropped' });
          break;
        }
        busy = true;
        try {
          const ok = await process(
            msg.bitmap,
            msg.bitmap.width,
            msg.bitmap.height,
            msg.captureTime,
            msg.captureTimeSource,
          );
          if (!ok) post({ type: 'dropped' });
        } catch (err) {
          post({ type: 'dropped' });
          throw err;
        } finally {
          msg.bitmap.close();
          busy = false;
        }
        break;
      case 'settings':
        applySettings(msg.settings);
        break;
      case 'calibration':
        setCalibration(recognizer, msg.calibration);
        break;
      case 'stop':
        running = false;
        // Release the camera: the transferred track clone keeps it open otherwise.
        void activeReader?.cancel().catch(() => undefined);
        ownedTrack?.stop();
        landmarker?.close();
        landmarker = null;
        self.close();
        break;
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err), recoverable: false });
  }
};

post({ type: 'hello', canProcessTrack: 'MediaStreamTrackProcessor' in self });
