// One synth voice built from a Patch. Oscillators are created once and run forever; notes are gated by the
// amp envelope and pitch changes are phase-continuous frequency glides — so a voice can never click.

import type { BaseContext } from 'tone';
import { midiToFreq, type Midi } from '../theory/notes';
import type { Patch } from './instruments/types';
import { glideTo, MIN_TAU } from './params';

/** Test-only switches used by the click-test positive control. Never enabled in the app. */
export const voiceDebug = { hardCuts: false };

/** Fade applied to a voice that is stolen while still sounding (s). */
export const STEAL_FADE = 0.008;

function softClipCurve(amount: number): Float32Array {
  const n = 1024;
  const k = 1 + amount * 6;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return curve;
}

export class Voice {
  readonly output: GainNode;
  private oscs: OscillatorNode[] = [];
  private filter: BiquadFilterNode;
  private vca: GainNode;
  private patch: Patch;
  note: Midi | null = null;
  gateOn = false;
  startedAt = -Infinity;
  releasedAt = -Infinity;
  /** After this time the voice is inaudible (< −70 dB) and free. */
  silentAfter = -Infinity;
  private velocity = 1;
  private brightnessHz: number;
  private spread = 1;

  constructor(
    private ctx: BaseContext,
    patch: Patch,
    destination: AudioNode,
  ) {
    this.patch = patch;
    this.output = ctx.createGain();
    this.output.gain.value = 1;
    this.vca = ctx.createGain();
    this.vca.gain.value = 0;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = patch.filter.type;
    this.filter.Q.value = patch.filter.Q;
    this.brightnessHz = patch.filter.cutoff[1];
    this.filter.frequency.value = this.brightnessHz;

    const mixIn = ctx.createGain();
    for (const spec of patch.oscs) {
      const osc = ctx.createOscillator();
      osc.type = spec.type;
      osc.frequency.value = midiToFreq(60) * Math.pow(2, spec.octave ?? 0);
      osc.detune.value = spec.detune ?? 0;
      const g = ctx.createGain();
      g.gain.value = spec.gain;
      osc.connect(g);
      if (spec.pan) {
        const p = ctx.createStereoPanner();
        p.pan.value = spec.pan;
        g.connect(p);
        p.connect(mixIn);
      } else {
        g.connect(mixIn);
      }
      this.oscs.push(osc);
    }
    mixIn.connect(this.filter);
    this.filter.connect(this.vca);
    if (patch.drive) {
      const shaper = ctx.createWaveShaper();
      shaper.curve = softClipCurve(patch.drive) as Float32Array<ArrayBuffer>;
      shaper.oversample = '2x';
      this.vca.connect(shaper);
      shaper.connect(this.output);
    } else {
      this.vca.connect(this.output);
    }
    this.output.connect(destination);
    // Random start offsets → random relative phases between detuned oscillators (no phasey attack).
    const t = ctx.currentTime;
    this.oscs.forEach((o, i) => o.start(t + (i === 0 ? 0 : Math.random() * 0.01)));
  }

  /** Free at `time` (not gated and already silent). */
  isFree(time: number): boolean {
    return !this.gateOn && time >= this.silentAfter;
  }

  private cutoffFor(note: Midi): number {
    const track = Math.pow(midiToFreq(note) / midiToFreq(60), this.patch.filter.keyTrack);
    return Math.min(0.4 * this.ctx.sampleRate, this.brightnessHz * track);
  }

  private setPitch(note: Midi, time: number, glide: number) {
    const f = midiToFreq(note);
    this.patch.oscs.forEach((spec, i) => {
      const target = f * Math.pow(2, spec.octave ?? 0);
      const p = this.oscs[i]!.frequency;
      if (glide <= 0) {
        // Phase-continuous jump (only used while the voice is silent or fading out).
        p.cancelScheduledValues(time);
        p.setValueAtTime(target, time);
      } else {
        glideTo(p, target, time, glide / 3);
      }
    });
  }

  /**
   * Gate on. If the voice is still sounding (stolen), it is faded out first and the new note starts
   * STEAL_FADE later. Returns the actual start time.
   */
  start(note: Midi, velocity: number, time: number, attack?: number): number {
    const p = this.patch;
    let t = time;
    if (!this.isFree(time)) {
      glideTo(this.vca.gain, 0, time, STEAL_FADE / 5);
      t = time + STEAL_FADE;
    }
    this.setPitch(note, t, 0);
    this.note = note;
    this.velocity = velocity;
    this.gateOn = true;
    this.startedAt = t;
    this.silentAfter = Infinity;

    const peak = p.level * (1 - p.velocitySens + p.velocitySens * velocity);
    const a = Math.max(0.003, attack ?? p.amp.attack);
    glideTo(this.vca.gain, peak, t, a / 3);
    this.vca.gain.setTargetAtTime(peak * p.amp.sustain, t + a, Math.max(MIN_TAU, p.amp.decay / 3));

    const fe = p.filter.env;
    const cutoff = this.cutoffFor(note);
    // The voice is silent here (free, or faded out above), so the cutoff can jump like the pitch does.
    // Gliding it instead would let the envelope push a still-high cutoff toward Nyquist (an ultrasonic
    // resonance burst). The envelope is also capped so cutoff × envelope stays below 0.4 × sample rate.
    this.filter.frequency.cancelScheduledValues(t);
    this.filter.frequency.setValueAtTime(cutoff, t);
    const headroom = 1200 * Math.log2((0.4 * this.ctx.sampleRate) / cutoff);
    const envAmt = Math.max(0, Math.min(fe.amount * (0.5 + 0.5 * velocity), headroom));
    glideTo(this.filter.detune, envAmt, t, Math.max(MIN_TAU, fe.attack / 3));
    this.filter.detune.setTargetAtTime(
      Math.min(fe.sustain, envAmt),
      t + fe.attack,
      Math.max(MIN_TAU, fe.decay / 3),
    );
    return t;
  }

  /** Legato: move to a new note without re-triggering the envelopes. */
  glide(note: Midi, time: number, seconds = this.patch.glide): void {
    this.note = note;
    this.setPitch(note, time, Math.max(0.003, seconds));
    glideTo(this.filter.frequency, this.cutoffFor(note), time, Math.max(0.003, seconds) / 3);
  }

  release(time: number, seconds = this.patch.amp.release): void {
    if (!this.gateOn) return;
    const r = Math.max(0.006, seconds);
    this.gateOn = false;
    this.releasedAt = time;
    if (voiceDebug.hardCuts) {
      // Deliberately broken (positive control): an instant cut, the way naive synths do it.
      this.vca.gain.cancelScheduledValues(time);
      this.vca.gain.setValueAtTime(0, time);
      this.silentAfter = time;
      return;
    }
    glideTo(this.vca.gain, 0, time, r / 4);
    glideTo(this.filter.detune, 0, time, Math.max(MIN_TAU, this.patch.filter.env.release / 3));
    // τ = r/4 → −70 dB after ~8τ = 2r.
    this.silentAfter = time + 2 * r;
  }

  setBrightness(hz: number, time: number, seconds: number): void {
    this.brightnessHz = hz;
    // Never cancel a cutoff jump scheduled by a note start at (or after) this time: glide from just after it.
    const at = this.startedAt >= time ? this.startedAt + 1 / this.ctx.sampleRate : time;
    glideTo(this.filter.frequency, this.cutoffFor(this.note ?? 60), at, Math.max(MIN_TAU, seconds / 3));
  }

  /** Scale oscillator detune spread (motion macro). 1 = patch default. */
  setSpread(scale: number, time: number, seconds: number): void {
    this.spread = scale;
    this.patch.oscs.forEach((spec, i) => {
      const cents = (spec.detune ?? 0) + (spec.spread ?? 0) * (scale - 1);
      glideTo(this.oscs[i]!.detune, cents, time, Math.max(MIN_TAU, seconds / 3));
    });
  }

  /** Rough current loudness for voice stealing (higher = louder). */
  loudness(time: number): number {
    if (this.gateOn) return 1 + this.velocity;
    if (time >= this.silentAfter) return 0;
    return Math.max(0, 1 - (time - this.releasedAt) / Math.max(1e-3, this.silentAfter - this.releasedAt));
  }

  dispose(): void {
    for (const o of this.oscs) {
      try {
        o.stop();
      } catch {
        /* already stopped */
      }
      o.disconnect();
    }
    this.output.disconnect();
  }
}
