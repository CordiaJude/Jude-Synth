// Click-free parameter automation. Every change is a setTargetAtTime from the param's *current* value, so
// there is never a discontinuity — no matter what automation was in flight. Never assign `.value`.

/** Shortest time constant we ever use (s). τ = 1 ms reaches −60 dB in ~7 ms: fast but never a step. */
export const MIN_TAU = 0.001;

/** Anything with Web Audio automation methods: AudioParam or a Tone.js Param/Signal. */
export interface ParamLike {
  cancelScheduledValues(time: number): unknown;
  setTargetAtTime(value: number, time: number, tau: number): unknown;
}

/** Glide `param` toward `value` starting at `time`; ~95% there after 3·tau. Cancels later automation. */
export function glideTo(param: ParamLike, value: number, time: number, tau: number): void {
  param.cancelScheduledValues(time);
  param.setTargetAtTime(value, time, Math.max(MIN_TAU, tau));
}

/** Ramp so the move is ~95% complete after `seconds`. */
export function rampTo(param: ParamLike, value: number, time: number, seconds: number): void {
  glideTo(param, value, time, Math.max(MIN_TAU, seconds / 3));
}

export const dbToGain = (db: number): number => Math.pow(10, db / 20);

/** 0..1 fader → gain, with a −48 dB floor and true silence at 0. */
export function faderToGain(x: number): number {
  if (x <= 0.001) return 0;
  return dbToGain(-48 * Math.pow(1 - Math.min(1, x), 1.6));
}

/** 0..1 → exponential frequency range. */
export const expRange = (x: number, lo: number, hi: number): number =>
  lo * Math.pow(hi / lo, Math.max(0, Math.min(1, x)));
