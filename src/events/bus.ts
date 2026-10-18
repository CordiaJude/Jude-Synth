import type { MusicEvent } from './types';

type Listener = (e: MusicEvent) => void;

/** Synchronous fan-out of MusicEvents to every consumer (engine, looper, MIDI, visuals, HUD). */
export class EventBus {
  private listeners = new Set<Listener>();

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(e: MusicEvent): void {
    for (const l of this.listeners) l(e);
  }

  emitAll(events: readonly MusicEvent[]): void {
    for (const e of events) this.emit(e);
  }
}
