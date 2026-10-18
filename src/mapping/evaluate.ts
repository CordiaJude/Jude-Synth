// Evaluate a mapping preset against one gesture frame. Pure apart from the small state it is handed
// (threshold hysteresis, last values sent), which the caller owns.

import type { GestureFrame, HandGesture } from '../gestures/types';
import type { HandRole } from '../vision/types';
import { applyCurve, normalizeInput } from './curves';
import type {
  Action,
  Condition,
  ContinuousMapping,
  FeatureSource,
  MappingOutput,
  MappingPreset,
  PerformanceMode,
  ParamUpdate,
} from './types';

export interface MappingState {
  /** False until the first frame: hands already holding a pose then count as entering it. */
  primed: boolean;
  thresholds: Record<string, boolean>;
  sent: Record<string, number>;
}

export const createMappingState = (): MappingState => ({ primed: false, thresholds: {}, sent: {} });

const handOf = (frame: GestureFrame, role: HandRole): HandGesture | undefined =>
  frame.hands.find((h) => h.role === role);

/** Current value of a feature source, or null when the hand isn't (reliably) visible. */
export function readSource(frame: GestureFrame, source: FeatureSource): number | null {
  if (source === 'twoHand.distance') return frame.twoHand?.distance ?? null;
  if (source === 'twoHand.angle') return frame.twoHand?.angle ?? null;
  const [role, a, b] = source.split('.') as [HandRole, string, string | undefined];
  const hand = handOf(frame, role);
  if (!hand || hand.coasting) return null;
  if (a === 'finger' && b) return hand.fingers[b as keyof HandGesture['fingers']]?.extension ?? null;
  const f = hand.features;
  switch (a) {
    case 'rollAbs':
      return Math.abs(f.roll);
    case 'velocityX':
      return f.velocity.x;
    case 'velocityY':
      return f.velocity.y;
    default: {
      const v = (f as unknown as Record<string, unknown>)[a];
      return typeof v === 'number' ? v : null;
    }
  }
}

export function checkCondition(
  c: Condition | undefined,
  frame: GestureFrame,
  mode: PerformanceMode,
): boolean {
  if (!c) return true;
  if ('pose' in c) {
    const h = handOf(frame, c.pose.role);
    return !!h && c.pose.is.includes(h.pose.pose);
  }
  if ('present' in c) return !!handOf(frame, c.present);
  if ('mode' in c) return c.mode === mode;
  if ('all' in c) return c.all.every((x) => checkCondition(x, frame, mode));
  if ('any' in c) return c.any.some((x) => checkCondition(x, frame, mode));
  return !checkCondition(c.not, frame, mode);
}

/** Source value → target value for one continuous mapping (also used by the editor's curve preview). */
export function mapValue(m: ContinuousMapping, v: number): { input: number; output: number } {
  let x = normalizeInput(v, m.inRange, m.deadzone);
  const input = x;
  x = applyCurve(x, m.curve);
  if (m.invert) x = 1 - x;
  return { input, output: m.outRange[0] + (m.outRange[1] - m.outRange[0]) * x };
}

export function evaluateMapping(
  preset: MappingPreset,
  frame: GestureFrame,
  state: MappingState,
  mode: PerformanceMode,
): { state: MappingState; out: MappingOutput } {
  const s: MappingState = { primed: true, thresholds: { ...state.thresholds }, sent: { ...state.sent } };
  const actions: Action[] = [];
  const params: ParamUpdate[] = [];
  const inputs: MappingOutput['inputs'] = {};

  for (const d of preset.discrete) {
    const t = d.trigger;
    const fire = (a: Action | undefined) => {
      if (a && checkCondition(d.when, frame, mode)) actions.push(a);
    };
    switch (t.kind) {
      case 'pose': {
        for (const e of frame.events) {
          if (e.role !== t.role) continue;
          if (e.type === 'poseEnter' && e.pose === t.pose) fire(d.action);
          if (e.type === 'poseExit' && e.pose === t.pose) fire(d.onExit);
        }
        if (!state.primed) {
          const h = handOf(frame, t.role);
          const enteredNow = frame.events.some((e) => e.type === 'poseEnter' && e.role === t.role);
          if (h && h.pose.pose === t.pose && !enteredNow) fire(d.action);
        }
        break;
      }
      case 'event':
        for (const e of frame.events) {
          if (e.role !== t.role || e.type !== t.event) continue;
          if (t.direction && (e.type !== 'swipe' || e.direction !== t.direction)) continue;
          fire(d.action);
        }
        break;
      case 'threshold': {
        const v = readSource(frame, t.source);
        const active = s.thresholds[d.id] ?? false;
        if (v === null) {
          if (active) {
            s.thresholds[d.id] = false;
            fire(d.onExit);
          }
          break;
        }
        const enter = t.above !== undefined ? v > t.above : t.below !== undefined ? v < t.below : false;
        const exit =
          t.above !== undefined
            ? v < t.above - t.hysteresis
            : t.below !== undefined
              ? v > t.below + t.hysteresis
              : true;
        if (!active && enter) {
          s.thresholds[d.id] = true;
          fire(d.action);
        } else if (active && exit) {
          s.thresholds[d.id] = false;
          fire(d.onExit);
        }
        break;
      }
    }
  }

  for (const m of preset.continuous) {
    const v = readSource(frame, m.source);
    const active = v !== null && checkCondition(m.enabledWhen, frame, mode);
    if (v === null) {
      inputs[m.id] = { input: 0, output: s.sent[m.id] ?? m.outRange[0], active: false };
      continue;
    }
    const { input, output } = mapValue(m, v);
    inputs[m.id] = { input, output, active };
    if (!active) continue;
    const last = s.sent[m.id];
    const eps = Math.abs(m.outRange[1] - m.outRange[0]) * 0.003;
    if (last !== undefined && Math.abs(last - output) <= eps) continue;
    s.sent[m.id] = output;
    params.push({ target: m.target, value: output, rampMs: m.smoothingMs ?? 60, mappingId: m.id });
  }

  return { state: s, out: { params, actions, inputs } };
}
