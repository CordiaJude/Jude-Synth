// The single musical event stream. Everything audible is a MusicEvent with an audio-clock time; the synth,
// looper, MIDI out and visuals all consume the same events.

import type { Chord } from '../theory/chords';
import type { Midi } from '../theory/notes';

export type InstrumentSlot = 'chords' | 'melody' | 'bass' | 'drums';
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
      slot: InstrumentSlot;
      note: Midi;
      velocity: number;
      time: number;
      cause?: EventCause;
    }
  | { kind: 'noteOff'; id: string; slot: InstrumentSlot; time: number }
  /** Continuous pitch for a sounding note (theremin / melody glide). `note` may be fractional. */
  | { kind: 'pitch'; id: string; slot: InstrumentSlot; note: Midi; glide: number; time: number }
  | {
      kind: 'chord';
      slot: InstrumentSlot;
      /** null = release the chord. */
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
  | { kind: 'drum'; voice: DrumVoice; velocity: number; time: number }
  /** Release everything sounding on a slot (no harmonic meaning — e.g. the pad when the arp takes over). */
  | { kind: 'slotRelease'; slot: InstrumentSlot; time: number }
  | { kind: 'param'; target: ParamPath; value: number; rampMs: number; time: number }
  | { kind: 'transport'; action: 'tempo'; bpm: number; time: number };

export type MusicEventKind = MusicEvent['kind'];
