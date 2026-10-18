// High-rate data (gesture frames at camera rate) lives outside React. Components either subscribe directly
// (canvas drawing) or read throttled snapshots via useLiveSnapshot.

import { useEffect, useState } from 'react';
import type { GestureEvent } from '../gestures/types';
import type { GestureMessage } from '../vision/visionClient';

export interface LoggedEvent {
  event: GestureEvent;
  receivedAt: number;
}

type Listener = (msg: GestureMessage) => void;

class LiveStore {
  latest: GestureMessage | null = null;
  events: LoggedEvent[] = [];
  /** captureTime → main-thread receive, ms. */
  latency: number[] = [];
  private listeners = new Set<Listener>();
  private frameTimes: number[] = [];

  publish(msg: GestureMessage): void {
    this.latest = msg;
    for (const e of msg.frame.events) {
      this.events.push({ event: e, receivedAt: msg.receivedAt });
      if (this.events.length > 14) this.events.shift();
    }
    this.latency.push(msg.receivedAt - msg.frame.timing.captureTime);
    if (this.latency.length > 120) this.latency.shift();
    this.frameTimes.push(msg.receivedAt);
    while (this.frameTimes.length > 1 && msg.receivedAt - this.frameTimes[0]! > 1000) this.frameTimes.shift();
    for (const l of this.listeners) l(msg);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  fps(): number {
    return this.frameTimes.length;
  }

  reset(): void {
    this.latest = null;
    this.events = [];
    this.latency = [];
    this.frameTimes = [];
  }
}

export const live = new LiveStore();

export const percentile = (xs: number[], p: number): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
};

export interface LiveSnapshot {
  latest: GestureMessage | null;
  events: LoggedEvent[];
  latencyP50: number;
  latencyP95: number;
  fps: number;
}

const snapshot = (): LiveSnapshot => ({
  latest: live.latest,
  events: [...live.events],
  latencyP50: percentile(live.latency, 0.5),
  latencyP95: percentile(live.latency, 0.95),
  fps: live.fps(),
});

/** Re-render at most `hz` times per second with the latest live data. */
export function useLiveSnapshot(hz = 15): LiveSnapshot {
  const [snap, setSnap] = useState(snapshot);
  useEffect(() => {
    const id = setInterval(() => setSnap(snapshot()), 1000 / hz);
    return () => clearInterval(id);
  }, [hz]);
  return snap;
}
