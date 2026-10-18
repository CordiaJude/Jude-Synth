// Scale quantizer for melody / theremin pitch: snap 0 = free pitch, 1 = hard snap to the scale.

import { scaleOf, type Key } from './modes';
import { pc, type Midi } from './notes';

/** Nearest scale tone to a (fractional) MIDI pitch. */
export function nearestScaleNote(midi: Midi, key: Key): Midi {
  const scale = scaleOf(key);
  const base = Math.floor(midi);
  let best = base;
  let bestD = Infinity;
  for (let m = base - 2; m <= base + 3; m++) {
    if (!scale.includes(pc(m))) continue;
    const d = Math.abs(m - midi);
    if (d < bestD) {
      bestD = d;
      best = m;
    }
  }
  return best;
}

/**
 * Pull `midi` toward the nearest scale tone by `snap` (0..1). In between, the distance to the note is
 * compressed by (1 − snap): the pitch still follows the hand but lingers near scale tones, and the synth's
 * glide smooths the hop at the midpoint between two tones.
 */
export function quantizePitch(midi: Midi, key: Key, snap: number): Midi {
  const s = Math.max(0, Math.min(1, snap));
  if (s === 0) return midi;
  const n = nearestScaleNote(midi, key);
  return n + (midi - n) * (1 - s);
}
