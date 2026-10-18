// Learn-by-moving: watch every source for a couple of seconds and pick the one the user moved the most.

import { readSource } from '../../mapping/evaluate';
import { SOURCES, typicalRange } from '../../mapping/catalog';
import type { FeatureSource } from '../../mapping/types';
import { live } from '../../state/live';

export interface LearnResult {
  source: FeatureSource;
  range: [number, number];
}

const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]!;
};

export function learnSource(durationMs = 2500): Promise<LearnResult | null> {
  return new Promise((resolve) => {
    const values = new Map<FeatureSource, number[]>();
    const unsubscribe = live.subscribe((msg) => {
      for (const { value } of SOURCES) {
        const v = readSource(msg.frame, value);
        if (v === null) continue;
        let arr = values.get(value);
        if (!arr) values.set(value, (arr = []));
        arr.push(v);
      }
    });
    setTimeout(() => {
      unsubscribe();
      let best: LearnResult | null = null;
      let bestSpread = 0.08; // ignore jitter
      for (const [source, xs] of values) {
        if (xs.length < 10) continue;
        const lo = quantile(xs, 0.05);
        const hi = quantile(xs, 0.95);
        const spread = (hi - lo) / typicalRange(source);
        if (spread > bestSpread) {
          bestSpread = spread;
          best = { source, range: [lo, hi] };
        }
      }
      resolve(best);
    }, durationMs);
  });
}
