// Turns calibration samples (open palm, fist, pinch) into a per-user Calibration. Pure.

import { FINGERS, type LandmarkArray } from '../vision/landmarks';
import { DEFAULT_PALM_SCALE, DEFAULT_PINCH, imageScale } from './features';
import { DEFAULT_FINGER_RANGES, palmCenter, palmSize, rawFingerExtension, rawPinch } from './fingers';
import type { Calibration } from './types';
import { vec } from './vec';

export interface CalibrationSample {
  image: LandmarkArray;
  world: LandmarkArray;
  aspect: number;
}

export interface CalibrationInput {
  open: CalibrationSample[];
  fist: CalibrationSample[];
  pinch?: CalibrationSample[];
}

const median = (xs: number[]): number => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/**
 * Median raw extension per finger in each phase becomes that finger's range. The range is widened
 * slightly outward so the user's own extremes map to ~0 and ~1 instead of clipping early.
 * Falls back to defaults per finger if the samples don't separate cleanly.
 */
export function buildCalibration(input: CalibrationInput, now: number): Calibration {
  const raw = (s: CalibrationSample) => {
    const c = palmCenter(s.world, vec());
    const size = palmSize(s.world);
    return FINGERS.map((f) => rawFingerExtension(s.world, f, c, size));
  };
  const openRaw = input.open.map(raw);
  const fistRaw = input.fist.map(raw);

  const fingerExtension = { ...DEFAULT_FINGER_RANGES };
  FINGERS.forEach((f, i) => {
    const open = median(openRaw.map((r) => r[i]!));
    const curled = median(fistRaw.map((r) => r[i]!));
    if (Number.isFinite(open) && Number.isFinite(curled) && open - curled > 0.15) {
      const pad = (open - curled) * 0.08;
      fingerExtension[f] = { curled: curled + pad, open: open - pad };
    }
  });

  const scales = [...input.open, ...input.fist]
    .map((s) => imageScale(s.image, s.world, s.aspect))
    .filter((x) => x > 0);
  const typical = median(scales);
  // Calibration happens at a comfortable playing distance; allow ~2.2× closer and ~2.5× farther.
  const palmScale = Number.isFinite(typical)
    ? { near: typical * 2.2, far: typical / 2.5 }
    : DEFAULT_PALM_SCALE;

  let pinch = DEFAULT_PINCH;
  if (input.pinch?.length) {
    const closed = median(input.pinch.map((s) => rawPinch(s.world)));
    const open = median(input.open.map((s) => rawPinch(s.world)));
    if (open - closed > 0.3) pinch = { closed: closed * 1.15, open: open * 0.9 };
  }

  return { version: 1, fingerExtension, palmSize: palmScale, pinch, createdAt: now };
}
