import { createMappingState, evaluateMapping } from '../../../src/mapping/evaluate';
import type { MappingPreset } from '../../../src/mapping/types';
import {
  conduct,
  DEFAULT_CONDUCTOR,
  initialConductorState,
  type ConductorSettings,
} from '../../../src/performance/conductor';
import type { MusicEvent } from '../../../src/events/types';
import { framesFrom, type Step } from './gestures';

/** Run steps through preset → evaluator → conductor, the same path the app uses. */
export function perform(preset: MappingPreset, steps: Step[], settings: Partial<ConductorSettings> = {}) {
  const cfg = { ...DEFAULT_CONDUCTOR, bass: preset.instruments.bass, melody: preset.melody, ...settings };
  let ms = createMappingState();
  let cs = initialConductorState(preset.defaultMode);
  const perFrame: MusicEvent[][] = [];
  framesFrom(steps).forEach((frame, i) => {
    const m = evaluateMapping(preset, frame, ms, cs.mode);
    ms = m.state;
    const r = conduct(
      cs,
      { actions: m.out.actions, params: m.out.params, cause: { captureTime: frame.timing.captureTime } },
      i * 0.033,
      cfg,
    );
    cs = r.state;
    perFrame.push(r.events);
  });
  return { perFrame, state: cs };
}

export const chordsOf = (evs: MusicEvent[]) =>
  evs.filter((e): e is Extract<MusicEvent, { kind: 'chord' }> => e.kind === 'chord' && e.slot === 'chords');
export const paramsOf = (evs: MusicEvent[]) =>
  Object.fromEntries(
    evs
      .filter((e) => e.kind === 'param')
      .map((e) => [(e as { target: string }).target, (e as { value: number }).value]),
  );
