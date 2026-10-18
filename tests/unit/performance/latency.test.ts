import { describe, expect, it } from 'vitest';
import { LATENCY_STAGES, latencyStages } from '../../../src/performance/latency';

describe('latency breakdown', () => {
  it('splits camera → speaker into stages that add up to the total', () => {
    const r = latencyStages({
      cause: { captureTime: 1000, detectStart: 1018, detectEnd: 1030, recognizeEnd: 1031, receivedAt: 1032 },
      scheduledAt: 1032.5,
      lookaheadMs: 12,
      quantizeMs: 0,
      heardAt: 1060.5,
    });
    expect(r.total).toBeCloseTo(60.5);
    expect(r.stages['hand detection']).toBeCloseTo(12);
    expect(r.stages['audio output']).toBeCloseTo(16);
    const sum = LATENCY_STAGES.reduce((a, s) => a + r.stages[s], 0);
    expect(sum).toBeCloseTo(r.total);
  });

  it('tolerates missing worker timestamps (demo / keyboard input)', () => {
    const r = latencyStages({
      cause: { captureTime: 0 },
      scheduledAt: 1,
      lookaheadMs: 12,
      quantizeMs: 100,
      heardAt: 130,
    });
    expect(r.stages['quantize wait']).toBe(100);
    for (const s of LATENCY_STAGES) expect(r.stages[s]).toBeGreaterThanOrEqual(0);
  });
});
