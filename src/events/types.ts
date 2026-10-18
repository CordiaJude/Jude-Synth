// The single musical event stream. Everything audible is a MusicEvent with an audio-clock time; the synth,
// looper, MIDI out and visuals all consume the same events.

import type { Chord } from '../theory/chords';
import type { Midi } from '../theory/notes';

export type InstrumentSlot = 'chords' | 'melody' | 'bass' | 'drums';
/** A looper track's own instrument (`loop:<trackId>`): played back separately from the live slots. */
export type LoopSlot = `loop:${string}`;
export type SlotRef = InstrumentSlot | LoopSlot;

export const loopSlot = (trackId: string): LoopSlot => `loop:${trackId}`;
export const isLoopSlot = (slot: SlotRef | undefined): slot is LoopSlot =>
  slot !== undefined && slot.startsWith('loop:');
/** Every continuous engine parameter (all normalized 0..1 unless noted). */
export const PARAM_PATHS = [
  'master.volume',
  'macro.brightness',
  'macro.space',
  'macro.motion',
  'macro.grit',
  'fx.chorus.mix',
  'fx.delay.mix',
  'fx.delay.feedback',
  'fx.reverb.mix',
  'fx.tape.drive',
  /** DJ-style master filter: 0 = low-pass closed, 0.5 = bypass, 1 = high-pass closed. */
  'fx.djFilter',
  'chords.level',
  'bass.level',
  'melody.level',
  /** Vibrato depth on the melody instrument (0..1 → 0..70 cents). */
  'melody.vibrato',
  /** Sidechain-style ducking depth applied on every kick (0..1). */
  'fx.duck',
  'drums.level',
  /** Level of everything the looper plays back (0..1, 1 = unity). */
  'loops.level',
] as const;
export type ParamPath = (typeof PARAM_PATHS)[number];

/** What caused an event — lets us measure camera-to-sound latency, stage by stage. Wall-clock ms. */
export interface EventCause {
  /** The camera frame that triggered it. */
  captureTime: number;
  detectStart?: number;
  detectEnd?: number;
  recognizeEnd?: number;
  /** When the main thread received the gesture frame. */
  receivedAt?: number;
  /** Tentative (predictive-onset) trigger. */
  predicted?: boolean;
}

export const DRUM_VOICES = ['kick', 'snare', 'clap', 'hat', 'openHat', 'rim', 'tom', 'crash'] as const;
export type DrumVoice = (typeof DRUM_VOICES)[number];

export type ChordTransition = 'legato' | 'crossfade';

export type MusicEvent =
  | {
      kind: 'noteOn';
      id: string;
      slot: SlotRef;
      note: Midi;
      velocity: number;
      time: number;
      cause?: EventCause;
    }
  | { kind: 'noteOff'; id: string; slot: SlotRef; time: number }
  /** Continuous pitch for a sounding note (theremin / melody glide). `note` may be fractional. */
  | { kind: 'pitch'; id: string; slot: SlotRef; note: Midi; glide: number; time: number }
  | {
      kind: 'chord';
      slot: SlotRef;
      /** null = release the chord (the voicing is then empty). Looper tracks send voicings only (chord null). */
      chord: Chord | null;
      voicing: Midi[];
      velocity: number;
      transition?: ChordTransition;
      time: number;
      cause?: EventCause;
      /**
       * false = harmony only: the chord is current (HUD, arp, strum, looper) but the pad doesn't sound it,
       * because an arpeggiator or strum is playing it instead.
       */
      play?: boolean;
    }
  /** `slot` set = a looper drum track; omitted = the live drum machine. */
  | { kind: 'drum'; voice: DrumVoice; velocity: number; time: number; slot?: LoopSlot }
  /** Release everything sounding on a slot (no harmonic meaning — e.g. the pad when the arp takes over). */
  | { kind: 'slotRelease'; slot: SlotRef; time: number }
  /** `slot` set = applies to that looper track only (brightness / vibrato automation). */
  | { kind: 'param'; target: ParamPath; value: number; rampMs: number; time: number; slot?: LoopSlot }
  | { kind: 'transport'; action: 'tempo'; bpm: number; time: number };

export type MusicEventKind = MusicEvent['kind'];
