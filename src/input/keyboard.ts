// Keyboard fallback: plays everything the hands can, through the same Action language. Pure.
//
//   1–7        chord on degree I…VII (hold Shift: borrowed from the parallel mode)
//   Q W E R    triad · 7th · 9th · sus4
//   ↑ / ↓      chord octave up / down          ← / →   inversion down / up
//   Space · 0  release the chord               L       latch (hold chords)
//   Z X C V B N M , . /   melody: scale degrees 1–10 (held = sounding)
//   A arp · S strum (Shift: up) · D drums · F fill · G drop · H next drum style · J next bass pattern
//   T tap tempo · − / = tempo down / up
//   O looper record / overdub · P looper play / stop  (Ctrl/⌘ + Z / Shift + Z: undo / redo, in useKeyboardInput)

import type { Action, ParamUpdate } from '../mapping/types';
import { scaleOf, type Key } from '../theory/modes';
import { pc } from '../theory/notes';
import type { Degree } from '../theory/chords';

export interface KeyboardContext {
  key: Key;
  melody: { low: number; high: number };
  octave: -1 | 0 | 1;
  inversionBias: -1 | 0 | 1;
}

export interface KeyInput {
  code: string;
  shiftKey: boolean;
  repeat: boolean;
  type: 'down' | 'up';
}

export interface KeyResult {
  actions: Action[];
  params: ParamUpdate[];
  context: KeyboardContext;
}

const DEGREE_KEYS: Record<string, Degree> = {
  Digit1: 1, Digit2: 2, Digit3: 3, Digit4: 4, Digit5: 5, Digit6: 6, Digit7: 7,
  Numpad1: 1, Numpad2: 2, Numpad3: 3, Numpad4: 4, Numpad5: 5, Numpad6: 6, Numpad7: 7,
}; // prettier-ignore
const MELODY_KEYS = ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash'];

/** The melody.pitch control value (0..1) that lands on scale degree `index` (0-based) of the melody range. */
export function pitchForScaleIndex(key: Key, melody: { low: number; high: number }, index: number): number {
  const scale = scaleOf(key);
  // First scale tone at or above the bottom of the melody range.
  let m = Math.ceil(melody.low);
  while (!scale.includes(pc(m))) m++;
  for (let k = 0; k < index; k++) {
    m++;
    while (!scale.includes(pc(m))) m++;
  }
  return (m - melody.low) / (melody.high - melody.low);
}

/**
 * Translate one key event. Returns null if the key isn't ours (so the browser keeps its default).
 * `held` tracks melody keys currently down, so releasing one of two held notes doesn't stop the sound.
 */
export function handleKey(e: KeyInput, ctx: KeyboardContext, held: Set<string>): KeyResult | null {
  const out: KeyResult = { actions: [], params: [], context: ctx };
  const melodyIndex = MELODY_KEYS.indexOf(e.code);

  if (melodyIndex >= 0) {
    if (e.type === 'down') {
      if (e.repeat) return out;
      held.add(e.code);
      const value = pitchForScaleIndex(ctx.key, ctx.melody, melodyIndex);
      out.params.push({ target: 'melody.pitch', value, rampMs: 20, mappingId: 'keyboard' });
      out.actions.push({ type: 'melody.gate', on: true });
    } else {
      held.delete(e.code);
      const still = [...held].filter((c) => MELODY_KEYS.includes(c));
      const last = still[still.length - 1];
      if (last) {
        const value = pitchForScaleIndex(ctx.key, ctx.melody, MELODY_KEYS.indexOf(last));
        out.params.push({ target: 'melody.pitch', value, rampMs: 20, mappingId: 'keyboard' });
      } else {
        out.actions.push({ type: 'melody.gate', on: false });
      }
    }
    return out;
  }

  if (e.type === 'up') return DEGREE_KEYS[e.code] ? out : null;
  if (e.repeat) return DEGREE_KEYS[e.code] ? out : null;

  const degree = DEGREE_KEYS[e.code];
  if (degree) {
    out.actions.push({ type: 'chord.parallel', value: e.shiftKey });
    out.actions.push({ type: 'chord.degree', degree });
    return out;
  }
  switch (e.code) {
    case 'KeyQ':
      out.actions.push({ type: 'chord.shape', extension: 'triad', quality: 'diatonic' });
      return out;
    case 'KeyW':
      out.actions.push({ type: 'chord.shape', extension: 'seventh', quality: 'diatonic' });
      return out;
    case 'KeyE':
      out.actions.push({ type: 'chord.shape', extension: 'ninth', quality: 'diatonic' });
      return out;
    case 'KeyR':
      out.actions.push({ type: 'chord.shape', extension: 'triad', quality: 'sus4' });
      return out;
    case 'ArrowUp':
    case 'ArrowDown': {
      const octave = Math.max(-1, Math.min(1, ctx.octave + (e.code === 'ArrowUp' ? 1 : -1))) as -1 | 0 | 1;
      out.context = { ...ctx, octave };
      out.actions.push({ type: 'chord.octave', value: octave });
      return out;
    }
    case 'ArrowLeft':
    case 'ArrowRight': {
      const inversionBias = Math.max(
        -1,
        Math.min(1, ctx.inversionBias + (e.code === 'ArrowRight' ? 1 : -1)),
      ) as -1 | 0 | 1;
      out.context = { ...ctx, inversionBias };
      out.actions.push({ type: 'chord.inversionBias', value: inversionBias });
      return out;
    }
    case 'Space':
    case 'Digit0':
    case 'Numpad0':
      out.actions.push({ type: 'chord.release' });
      return out;
    case 'KeyL':
      out.actions.push({ type: 'latch.toggle' });
      return out;
    case 'KeyA':
      out.actions.push({ type: 'arp.toggle' });
      return out;
    case 'KeyS':
      out.actions.push({ type: 'strum.strum', direction: e.shiftKey ? 'up' : 'down' });
      return out;
    case 'KeyD':
      out.actions.push({ type: 'drums.toggle' });
      return out;
    case 'KeyF':
      out.actions.push({ type: 'drums.fill' });
      return out;
    case 'KeyG':
      out.actions.push({ type: 'drums.drop' });
      return out;
    case 'KeyH':
      out.actions.push({ type: 'drums.nextGenre' });
      return out;
    case 'KeyJ':
      out.actions.push({ type: 'bass.nextPattern' });
      return out;
    case 'KeyT':
      out.actions.push({ type: 'tempo.tap' });
      return out;
    case 'Minus':
    case 'Equal':
      out.actions.push({ type: 'tempo.nudge', delta: e.code === 'Equal' ? 5 : -5 });
      return out;
    case 'KeyO':
      out.actions.push({ type: 'looper.recordToggle' });
      return out;
    case 'KeyP':
      out.actions.push({ type: 'looper.playToggle' });
      return out;
    default:
      return null;
  }
}

export const KEYBOARD_HELP: Array<[string, string]> = [
  ['1 – 7', 'Chord on degree I … VII'],
  ['Shift + 1 – 7', 'Borrowed chord (parallel mode)'],
  ['Q · W · E · R', 'Triad · 7th · 9th · sus4'],
  ['↑ ↓', 'Chord octave'],
  ['← →', 'Inversion'],
  ['Space / 0', 'Release chord'],
  ['L', 'Latch (hold chords)'],
  ['Z … /', 'Melody notes (scale degrees 1 – 10)'],
  ['A', 'Arpeggiator on / off'],
  ['S (Shift + S)', 'Strum down (up)'],
  ['D · F · G', 'Drums on / off · fill · drop'],
  ['H · J', 'Next drum style · next bass pattern'],
  ['T · − =', 'Tap tempo · tempo down / up'],
  ['O', 'Looper: record (again: close the loop / overdub)'],
  ['P', 'Looper: play / stop'],
  ['Ctrl/⌘ + Z', 'Looper: undo (Shift: redo)'],
];
