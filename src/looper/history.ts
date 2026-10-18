// Undo / redo over immutable snapshots. Every edit produces a new project, so a snapshot history is both
// the simplest and the most reliable command history. Pure.

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

export const LIMIT = 100;

export const createHistory = <T>(present: T): History<T> => ({ past: [], present, future: [] });

/** Record a new state (no-op if unchanged). Clears the redo stack. */
export function commit<T>(h: History<T>, next: T, limit = LIMIT): History<T> {
  if (next === h.present) return h;
  return { past: [...h.past, h.present].slice(-limit), present: next, future: [] };
}

/** Replace the present without an undo step (e.g. mute, solo, level: performance controls). */
export const replace = <T>(h: History<T>, next: T): History<T> => ({ ...h, present: next });

export function undo<T>(h: History<T>): History<T> {
  const prev = h.past[h.past.length - 1];
  if (prev === undefined) return h;
  return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  const [next, ...rest] = h.future;
  if (next === undefined) return h;
  return { past: [...h.past, h.present], present: next, future: rest };
}

export const canUndo = (h: History<unknown>): boolean => h.past.length > 0;
export const canRedo = (h: History<unknown>): boolean => h.future.length > 0;
