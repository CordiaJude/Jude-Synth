// Runtime validation for user presets (imported JSON or loaded from storage).

import { z } from 'zod';
import { PARAM_PATHS } from '../events/types';
import { POSE_IDS } from '../gestures/types';
import { BORROWED_CHORDS, CHORD_QUALITIES } from '../theory/chords';
import { BASS_PATTERNS } from '../performance/bass';
import { GENRES } from '../performance/drums/patterns';
import { FINGER_NAMES, HAND_FEATURES, type MappingPreset } from './types';

const role = z.enum(['primary', 'secondary']);
const pose = z.enum(POSE_IDS);
const featureSource = z.union([
  z.templateLiteral([role, '.', z.enum(HAND_FEATURES)]),
  z.templateLiteral([role, '.finger.', z.enum(FINGER_NAMES)]),
  z.literal('twoHand.distance'),
  z.literal('twoHand.angle'),
]);
const range = z.tuple([z.number(), z.number()]);
const curve = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('linear') }),
  z.object({ kind: z.literal('exp'), k: z.number() }),
  z.object({ kind: z.literal('log'), k: z.number() }),
  z.object({ kind: z.literal('pow'), gamma: z.number().positive() }),
  z.object({ kind: z.literal('smoothstep') }),
  z.object({ kind: z.literal('steps'), n: z.number().int().min(1).max(24) }),
]);
const mode = z.enum(['chords', 'melody', 'theremin']);
const condition: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.object({ pose: z.object({ role, is: z.array(pose) }) }),
    z.object({ present: role }),
    z.object({ mode }),
    z.object({ all: z.array(condition) }),
    z.object({ any: z.array(condition) }),
    z.object({ not: condition }),
  ]),
);
const degree = z.union(
  [1, 2, 3, 4, 5, 6, 7].map((n) => z.literal(n)) as [z.ZodLiteral<1>, ...z.ZodLiteral<number>[]],
);
const extension = z.enum(['triad', 'seventh', 'ninth']);
const quality = z.union([z.enum(CHORD_QUALITIES), z.literal('diatonic')]);
const action = z.discriminatedUnion('type', [
  z.object({ type: z.literal('chord.degree'), degree }),
  z.object({ type: z.literal('chord.borrowed'), chord: z.enum(BORROWED_CHORDS) }),
  z.object({ type: z.literal('chord.parallel'), value: z.boolean() }),
  z.object({ type: z.literal('chord.quality'), quality }),
  z.object({ type: z.literal('chord.extension'), extension }),
  z.object({ type: z.literal('chord.shape'), extension, quality }),
  z.object({ type: z.literal('chord.octave'), value: z.union([z.literal(-1), z.literal(0), z.literal(1)]) }),
  z.object({
    type: z.literal('chord.inversionBias'),
    value: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  }),
  z.object({ type: z.literal('chord.release') }),
  z.object({ type: z.literal('melody.gate'), on: z.boolean() }),
  z.object({ type: z.literal('melody.octave'), delta: z.union([z.literal(-1), z.literal(1)]) }),
  z.object({ type: z.literal('mode.set'), mode }),
  z.object({ type: z.literal('latch.toggle') }),
  z.object({ type: z.literal('arp.toggle') }),
  z.object({ type: z.literal('strum.toggle') }),
  z.object({ type: z.literal('strum.strum'), direction: z.enum(['down', 'up']) }),
  z.object({ type: z.literal('drums.toggle') }),
  z.object({ type: z.literal('drums.fill') }),
  z.object({ type: z.literal('drums.drop') }),
  z.object({ type: z.literal('drums.nextGenre') }),
  z.object({ type: z.literal('bass.nextPattern') }),
  z.object({ type: z.literal('tempo.tap') }),
  z.object({ type: z.literal('tempo.nudge'), delta: z.number().min(-40).max(40) }),
  z.object({ type: z.literal('looper.recordToggle') }),
  z.object({ type: z.literal('looper.playToggle') }),
  z.object({ type: z.literal('looper.undo') }),
  z.object({ type: z.literal('looper.redo') }),
]);
const trigger = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pose'), role, pose }),
  z.object({
    kind: z.literal('event'),
    role,
    event: z.enum([
      'poseEnter',
      'poseExit',
      'pinchStart',
      'pinchEnd',
      'pinchTap',
      'fistClench',
      'swipe',
      'snap',
      'handFound',
      'handLost',
    ]),
    direction: z.enum(['left', 'right', 'up', 'down']).optional(),
  }),
  z.object({
    kind: z.literal('threshold'),
    source: featureSource,
    above: z.number().optional(),
    below: z.number().optional(),
    hysteresis: z.number().min(0),
  }),
]);
const instrument = z.enum([
  'supersawPad',
  'warmPoly',
  'subBass',
  'fmKeys',
  'pluck',
  'glassBell',
  'thereminLead',
  'testSine',
]);

export const presetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(60),
  description: z.string().max(400),
  version: z.literal(1),
  builtIn: z.boolean(),
  roles: z.object({ primary: z.string(), secondary: z.string() }),
  defaultMode: mode,
  instruments: z.object({ chords: instrument, melody: instrument, bass: z.boolean() }),
  melody: z.object({
    low: z.number().min(24).max(108),
    high: z.number().min(24).max(108),
    snap: z.number().min(0).max(1),
  }),
  groove: z
    .object({
      arp: z.boolean().optional(),
      strum: z.boolean().optional(),
      drums: z.boolean().optional(),
      genre: z.enum(GENRES).optional(),
      bassPattern: z.enum(BASS_PATTERNS).optional(),
    })
    .optional(),
  continuous: z.array(
    z.object({
      id: z.string(),
      label: z.string().optional(),
      source: featureSource,
      target: z.union([
        z.enum(PARAM_PATHS),
        z.enum(['melody.pitch', 'arp.rate', 'arp.gate', 'strum.position']),
      ]),
      inRange: range,
      outRange: range,
      curve,
      invert: z.boolean(),
      deadzone: z.number().min(0).max(0.49).optional(),
      smoothingMs: z.number().min(0).max(2000).optional(),
      enabledWhen: condition.optional(),
    }),
  ),
  discrete: z.array(
    z.object({
      id: z.string(),
      label: z.string().optional(),
      trigger,
      action,
      onExit: action.optional(),
      when: condition.optional(),
    }),
  ),
});

export function validatePreset(
  json: unknown,
): { ok: true; preset: MappingPreset } | { ok: false; errors: string[] } {
  const r = presetSchema.safeParse(json);
  if (r.success) return { ok: true, preset: r.data as MappingPreset };
  return { ok: false, errors: r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) };
}
