// Main-thread side of the vision pipeline: spawns the worker, picks the cheapest way to get camera frames
// into it, and measures how much main-thread time the pipeline costs.

import { HAND_MODEL_URL, MEDIAPIPE_BASE } from '../config/app';
import type { Calibration, GestureFrame } from '../gestures/types';
import type {
  Delegate,
  FrameTier,
  FromVisionWorker,
  OverlayHand,
  ToVisionWorker,
  WorkerSettings,
  WorkerStats,
} from './protocol';
import { wallNow, type CaptureTimeSource } from './types';

export interface GestureMessage {
  frame: GestureFrame;
  overlay: OverlayHand[] | null;
  aspect: number;
  captureTimeSource: CaptureTimeSource;
  /** Wall-clock ms when the main thread received it. */
  receivedAt: number;
}

export interface VisionStatus {
  delegate: Delegate | null;
  tier: FrameTier | null;
  ready: boolean;
  worker: WorkerStats | null;
  /** Main-thread cost of handling one gesture message, ms. */
  mainHandlerP50: number;
  mainHandlerP99: number;
  longTasks: number;
  longTaskMaxMs: number;
  error: string | null;
}

export interface VisionClientHandlers {
  onGesture: (msg: GestureMessage) => void;
  onStatus: (status: VisionStatus) => void;
}

type MSTPCtor = new (o: { track: MediaStreamTrack; maxBufferSize?: number }) => {
  readable: ReadableStream<VideoFrame>;
};

export class VisionClient {
  private worker: Worker | null = null;
  private status: VisionStatus = {
    delegate: null,
    tier: null,
    ready: false,
    worker: null,
    mainHandlerP50: 0,
    mainHandlerP99: 0,
    longTasks: 0,
    longTaskMaxMs: 0,
    error: null,
  };
  private handlerMs: number[] = [];
  private longTaskObserver: PerformanceObserver | null = null;
  private stopped = false;
  private inFlight = false;
  private video: HTMLVideoElement | null = null;
  private frameRate = 30;
  /** Track clone feeding a main-thread MediaStreamTrackProcessor (tier A via transferred stream). */
  private processorTrack: MediaStreamTrack | null = null;

  constructor(private handlers: VisionClientHandlers) {}

  async start(
    stream: MediaStream,
    video: HTMLVideoElement,
    settings: WorkerSettings,
    preferGpu = true,
  ): Promise<void> {
    this.video = video;
    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error('No video track');
    this.frameRate = track.getSettings().frameRate ?? 30;

    this.observeLongTasks();
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'vision' });
    this.worker = worker;
    const hello = new Promise<boolean>((resolve) => {
      const onHello = (e: MessageEvent<FromVisionWorker>) => {
        if (e.data.type === 'hello') {
          worker.removeEventListener('message', onHello);
          resolve(e.data.canProcessTrack);
        }
      };
      worker.addEventListener('message', onHello);
    });
    worker.onmessage = (e: MessageEvent<FromVisionWorker>) => this.handle(e.data);
    worker.onerror = (e) => this.update({ error: e.message || 'Vision worker failed to start' });

    const canProcessTrack = await hello;
    this.send({
      type: 'init',
      wasmBase: new URL(MEDIAPIPE_BASE, location.href).href,
      modelUrl: new URL(HAND_MODEL_URL, location.href).href,
      preferGpu,
      frameRate: this.frameRate,
      settings,
    });
    this.connectFrames(track, canProcessTrack);
  }

  updateSettings(settings: WorkerSettings): void {
    this.send({ type: 'settings', settings });
  }

  setCalibration(calibration: Calibration | null): void {
    this.send({ type: 'calibration', calibration });
  }

  stop(): void {
    this.stopped = true;
    this.send({ type: 'stop' });
    // Give the worker a moment to stop its track clone and close MediaPipe, then make sure it's gone.
    const worker = this.worker;
    setTimeout(() => worker?.terminate(), 250);
    this.worker = null;
    this.processorTrack?.stop();
    this.processorTrack = null;
    this.longTaskObserver?.disconnect();
  }

  private send(msg: ToVisionWorker, transfer: Transferable[] = []) {
    this.worker?.postMessage(msg, transfer);
  }

  private update(partial: Partial<VisionStatus>) {
    this.status = { ...this.status, ...partial };
    this.handlers.onStatus(this.status);
  }

  private handle(msg: FromVisionWorker) {
    const t0 = performance.now();
    switch (msg.type) {
      case 'gesture':
        this.inFlight = false;
        this.handlers.onGesture({ ...msg, receivedAt: wallNow() });
        break;
      case 'dropped':
        this.inFlight = false;
        break;
      case 'ready':
        this.update({ ready: true, delegate: msg.delegate, error: null });
        break;
      case 'tier':
        this.update({ tier: msg.tier });
        break;
      case 'stats': {
        const s = [...this.handlerMs].sort((a, b) => a - b);
        const at = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
        this.update({
          worker: msg.stats,
          delegate: msg.delegate,
          mainHandlerP50: at(0.5),
          mainHandlerP99: at(0.99),
        });
        break;
      }
      case 'error':
        if (!msg.recoverable) this.update({ error: msg.message });
        else console.warn('[vision]', msg.message);
        break;
      case 'hello':
        break;
    }
    if (msg.type === 'gesture') {
      this.handlerMs.push(performance.now() - t0);
      if (this.handlerMs.length > 300) this.handlerMs.shift();
    }
  }

  /** Tier A if frames can be read inside the worker (zero main-thread cost), else tier B. */
  private connectFrames(track: MediaStreamTrack, workerCanProcess: boolean) {
    if (workerCanProcess) {
      try {
        const clone = track.clone();
        this.send({ type: 'track', track: clone }, [clone as unknown as Transferable]);
        return;
      } catch {
        /* MediaStreamTrack not transferable here */
      }
    }
    const MSTP = (window as unknown as { MediaStreamTrackProcessor?: MSTPCtor }).MediaStreamTrackProcessor;
    if (MSTP) {
      try {
        this.processorTrack = track.clone();
        const { readable } = new MSTP({ track: this.processorTrack, maxBufferSize: 1 });
        this.send({ type: 'stream', readable }, [readable as unknown as Transferable]);
        return;
      } catch {
        /* ReadableStream not transferable */
      }
    }
    this.update({ tier: 'B' });
    this.startBitmapLoop();
  }

  /** Tier B: on each new video frame, snapshot it as an ImageBitmap and transfer it (one in flight). */
  private startBitmapLoop() {
    const video = this.video!;
    const hasRvfc = 'requestVideoFrameCallback' in video;
    const schedule = () => {
      if (this.stopped) return;
      if (hasRvfc) video.requestVideoFrameCallback(tick);
      else requestAnimationFrame(() => tick(performance.now()));
    };
    const tick = (_now: number, md?: VideoFrameCallbackMetadata) => {
      schedule();
      if (this.inFlight || !this.status.ready || video.readyState < 2) return;
      this.inFlight = true;
      let captureTime: number;
      let captureTimeSource: CaptureTimeSource;
      if (md?.captureTime !== undefined) {
        captureTime = performance.timeOrigin + md.captureTime;
        captureTimeSource = 'rvfc';
      } else {
        captureTime = wallNow() - 1000 / this.frameRate;
        captureTimeSource = 'estimated';
      }
      createImageBitmap(video)
        .then((bitmap) => this.send({ type: 'frame', bitmap, captureTime, captureTimeSource }, [bitmap]))
        .catch(() => {
          this.inFlight = false;
        });
    };
    schedule();
  }

  private observeLongTasks() {
    if (typeof PerformanceObserver === 'undefined') return;
    try {
      this.longTaskObserver = new PerformanceObserver((list) => {
        let { longTasks, longTaskMaxMs } = this.status;
        for (const entry of list.getEntries()) {
          longTasks++;
          longTaskMaxMs = Math.max(longTaskMaxMs, entry.duration);
        }
        this.status = { ...this.status, longTasks, longTaskMaxMs };
      });
      this.longTaskObserver.observe({ type: 'longtask', buffered: false });
    } catch {
      /* longtask not supported (Firefox/Safari) */
    }
  }
}
