// Validation for loop projects restored from storage (they are user data: never trust their shape).

import { z } from 'zod';
import { MODES } from '../theory/modes';
import { AUTOMATION_TARGETS, MAX_TRACKS, PARTS, PPQ, type LoopProject } from './model';

const INSTRUMENTS = [
  'supersawPad',
  'warmPoly',
  'subBass',
  'fmKeys',
  'pluck',
  'glassBell',
  'thereminLead',
  'testSine',
  'drums',
] as const;

const tick = z.number().int().min(0);
const note = z.object({
  tick,
  duration: z.number().int().min(1),
  note: z.number().min(0).max(127),
  velocity: z.number().min(0).max(1),
  chord: z.boolean().optional(),
  transition: z.enum(['legato', 'crossfade']).optional(),
  pitch: z
    .array(z.object({ tick, note: z.number().min(0).max(127), glide: z.number().min(0).max(2) }))
    .optional(),
});

const track = z.object({
  id: z.string().min(1).max(20),
  name: z.string().max(40),
  part: z.enum(PARTS),
  instrument: z.enum(INSTRUMENTS),
  notes: z.array(note).max(20000),
  automation: z.array(
    z.object({ target: z.enum(AUTOMATION_TARGETS), points: z.array(z.object({ tick, value: z.number() })) }),
  ),
  brightness: z.number().min(0).max(1),
  mute: z.boolean(),
  solo: z.boolean(),
  gainDb: z.number().min(-60).max(6),
});

const project = z.object({
  version: z.literal(1),
  ppq: z.literal(PPQ),
  bpm: z.number().min(40).max(220),
  timeSig: z.tuple([z.literal(4), z.literal(4)]),
  bars: z.number().int().min(0).max(64),
  key: z.object({ tonic: z.number().int().min(0).max(11), mode: z.enum(MODES) }),
  tracks: z.array(track).max(MAX_TRACKS),
  nextTrackId: z.number().int().min(1),
});

export function parseProject(json: unknown): LoopProject | null {
  const r = project.safeParse(json);
  return r.success ? (r.data as LoopProject) : null;
}
