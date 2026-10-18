// End-to-end latency, broken into stages: camera frame → … → sound at the speaker. Pure.

import type { EventCause } from '../events/types';

export const LATENCY_STAGES = [
  'camera→worker',
  'hand detection',
  'gesture recognition',
  'worker→main',
  'main thread',
  'scheduling lookahead',
  'quantize wait',
  'audio output',
] as const;
export type LatencyStage = (typeof LATENCY_STAGES)[number];

export interface LatencyInput {
  cause: EventCause;
  /** Wall-clock ms when the main thread scheduled the event. */
  scheduledAt: number;
  /** Lookahead (ms) between scheduling and the unquantized event time. */
  lookaheadMs: number;
  /** Extra wait added by quantization (ms). */
  quantizeMs: number;
  /** Wall-clock ms the sound reaches the speaker. */
  heardAt: number;
}

/** Stage durations (ms). Missing timestamps fold into the neighbouring stage; values never go negative. */
export function latencyStages(x: LatencyInput): { stages: Record<LatencyStage, number>; total: number } {
  const c = x.cause;
  const detectStart = c.detectStart ?? c.captureTime;
  const detectEnd = c.detectEnd ?? detectStart;
  const recognizeEnd = c.recognizeEnd ?? detectEnd;
  const receivedAt = c.receivedAt ?? recognizeEnd;
  const pos = (v: number) => Math.max(0, v);
  const scheduledTimeWall = x.scheduledAt + x.lookaheadMs + x.quantizeMs;
  const stages: Record<LatencyStage, number> = {
    'camera→worker': pos(detectStart - c.captureTime),
    'hand detection': pos(detectEnd - detectStart),
    'gesture recognition': pos(recognizeEnd - detectEnd),
    'worker→main': pos(receivedAt - recognizeEnd),
    'main thread': pos(x.scheduledAt - receivedAt),
    'scheduling lookahead': pos(x.lookaheadMs),
    'quantize wait': pos(x.quantizeMs),
    'audio output': pos(x.heardAt - scheduledTimeWall),
  };
  return { stages, total: pos(x.heardAt - c.captureTime) };
}
