// Discrete gesture-event detectors. Each one is a small state machine fed once per frame with
// already-computed features, so it is deterministic and easy to unit test.

import type { GestureConfig, SwipeDirection } from './types';

export interface PinchDetector {
  pinching: boolean;
  since: number;
}

export type PinchSignal = 'start' | 'end' | 'tap' | null;

/** Hysteresis on pinch amount (0 = touching). A quick close-and-open also yields 'tap' (after 'end'). */
export function stepPinch(s: PinchDetector, pinch: number, t: number, cfg: GestureConfig): PinchSignal[] {
  if (!s.pinching && pinch < cfg.pinchEnter) {
    s.pinching = true;
    s.since = t;
    return ['start'];
  }
  if (s.pinching && pinch > cfg.pinchExit) {
    s.pinching = false;
    return t - s.since <= cfg.pinchTapMaxMs ? ['end', 'tap'] : ['end'];
  }
  return [];
}

/** Short history of a scalar for "what was it N ms ago" queries. */
export class History {
  private t: number[] = [];
  private v: number[] = [];
  constructor(private spanMs: number) {}
  push(t: number, v: number): void {
    this.t.push(t);
    this.v.push(v);
    while (this.t.length > 1 && t - this.t[0]! > this.spanMs) {
      this.t.shift();
      this.v.shift();
    }
  }
  max(): number {
    return this.v.length ? Math.max(...this.v) : 0;
  }
  min(): number {
    return this.v.length ? Math.min(...this.v) : 0;
  }
  clear(): void {
    this.t.length = 0;
    this.v.length = 0;
  }
}

export interface SwipeDetector {
  armed: boolean;
  peak: number;
  peakVx: number;
  peakVy: number;
  cooldownUntil: number;
}

/**
 * Swipe = palm speed above threshold; fires once at the speed peak (when it starts to fall) with the
 * direction of the peak velocity. Velocity is in frame-heights/s with y up.
 */
export function stepSwipe(
  s: SwipeDetector,
  vx: number,
  vy: number,
  t: number,
  cfg: GestureConfig,
): { direction: SwipeDirection; speed: number } | null {
  const speed = Math.hypot(vx, vy);
  if (t < s.cooldownUntil) return null;
  if (!s.armed) {
    if (speed > cfg.swipeMinSpeed) {
      s.armed = true;
      s.peak = speed;
      s.peakVx = vx;
      s.peakVy = vy;
    }
    return null;
  }
  if (speed > s.peak) {
    s.peak = speed;
    s.peakVx = vx;
    s.peakVy = vy;
    return null;
  }
  if (speed < s.peak * 0.8) {
    s.armed = false;
    s.cooldownUntil = t + cfg.swipeCooldownMs;
    const horizontal = Math.abs(s.peakVx) >= Math.abs(s.peakVy);
    const direction: SwipeDirection = horizontal ? (s.peakVx > 0 ? 'right' : 'left') : s.peakVy > 0 ? 'up' : 'down';
    return { direction, speed: s.peak };
  }
  return null;
}

export interface SnapDetector {
  lastPrimedAt: number;
  cooldownUntil: number;
}

/**
 * Finger snap: the middle fingertip whips away from the thumb at a very high speed (relative to the palm)
 * shortly after thumb and middle tip were pressed together.
 */
export function stepSnap(
  s: SnapDetector,
  thumbMiddleDist: number,
  middleTipSpeed: number,
  t: number,
  cfg: GestureConfig,
): number | null {
  if (thumbMiddleDist < 0.35) s.lastPrimedAt = t;
  if (t < s.cooldownUntil) return null;
  if (middleTipSpeed > cfg.snapMinPeak && t - s.lastPrimedAt < 250 && thumbMiddleDist > 0.45) {
    s.cooldownUntil = t + 300;
    s.lastPrimedAt = -Infinity;
    return middleTipSpeed;
  }
  return null;
}
