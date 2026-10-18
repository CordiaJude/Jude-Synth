// The audio engine: instrument slots → FX bus → master. All scheduling uses the audio clock; the engine
// only ever receives MusicEvents with absolute AudioContext times.
//
//  chords ─► chorus ─┐
//  bass ─────────────┴► tape ─► dry ───────────────┐
//                            ├► delay send ► ping-pong ─┤─► ducker ─► master ─► limiter ─► analyser ─► out
//                            └► reverb send ► reverb ───┘

import * as Tone from 'tone';
import type { InstrumentSlot, MusicEvent, ParamPath } from '../events/types';
import { Ducker } from './fx/ducker';
import { Reverb } from './fx/reverb';
import { PATCHES } from './instruments/patches';
import type { InstrumentId, Patch } from './instruments/types';
import { faderToGain, glideTo, MIN_TAU } from './params';
import { VoiceManager } from './voiceManager';
import processorsUrl from './worklets/processors.worklet.ts?worker&url';

export interface EngineOptions {
  chords?: InstrumentId;
  bass?: InstrumentId | null;
  /** false = bypass chorus/delay/reverb/tape (used by the strict click test). */
  fx?: boolean;
  bpm?: number;
  /** Test hook: transform patches before use (e.g. the click test swaps oscillator waveforms for sines). */
  patchTransform?: (p: Patch) => Patch;
}

export interface EngineLatency {
  base: number;
  output: number;
  lookahead: number;
}

/** Audio-clock lookahead for live events (s): small, because every ms here is felt. */
export const LIVE_LOOKAHEAD = 0.012;

type Slot = { manager: VoiceManager; gain: GainNode; id: InstrumentId };

export class AudioEngine {
  readonly ctx: Tone.BaseContext;
  readonly analyser: AnalyserNode;
  readonly ducker: Ducker;
  private slots: Partial<Record<InstrumentSlot, Slot>> = {};
  private slotInputs: Record<'chords' | 'bass', AudioNode>;
  private master: GainNode;
  private limiter: AudioWorkletNode | null;
  private tape: AudioWorkletNode | null;
  private chorus: Tone.Chorus | null = null;
  private delay: Tone.PingPongDelay | null = null;
  private reverb: Reverb | null = null;
  private delaySend: GainNode;
  private reverbSend: GainNode;
  private retired: Array<{ manager: VoiceManager; gain: GainNode; at: number }> = [];
  /** Lowest limiter gain over the last ~100 ms (1 = no limiting). */
  limiterGain = 1;
  private patchTransform: (p: Patch) => Patch;

  private constructor(ctx: Tone.BaseContext, worklets: boolean, opts: EngineOptions) {
    this.ctx = ctx;
    this.patchTransform = opts.patchTransform ?? ((p) => p);
    const fx = opts.fx !== false;
    this.master = ctx.createGain();
    this.master.gain.value = faderToGain(0.75);
    this.ducker = new Ducker(ctx);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.6;

    const sum = ctx.createGain();
    const preFx = ctx.createGain();
    this.delaySend = ctx.createGain();
    this.reverbSend = ctx.createGain();
    this.delaySend.gain.value = fx ? 0.12 : 0;
    this.reverbSend.gain.value = fx ? 0.28 : 0;

    this.tape =
      worklets && fx ? ctx.createAudioWorkletNode('handwave-tape', { outputChannelCount: [2] }) : null;
    this.limiter = worklets
      ? ctx.createAudioWorkletNode('handwave-limiter', { outputChannelCount: [2] })
      : null;
    if (this.limiter) {
      this.limiter.port.onmessage = (e: MessageEvent<{ minGain: number }>) =>
        (this.limiterGain = e.data.minGain);
    }

    const chordsIn = ctx.createGain();
    const bassIn = ctx.createGain();
    if (fx) {
      this.chorus = new Tone.Chorus({
        frequency: 0.45,
        delayTime: 3.2,
        depth: 0.55,
        spread: 160,
        wet: 0.4,
      }).start();
      Tone.connect(chordsIn, this.chorus);
      this.chorus.connect(preFx);
    } else {
      chordsIn.connect(preFx);
    }
    bassIn.connect(preFx);
    this.slotInputs = { chords: chordsIn, bass: bassIn };

    const afterTape: AudioNode = this.tape ?? preFx;
    if (this.tape) preFx.connect(this.tape);
    afterTape.connect(sum);

    if (fx) {
      this.delay = new Tone.PingPongDelay({ delayTime: '8n.', feedback: 0.32, wet: 1, maxDelay: 2 });
      afterTape.connect(this.delaySend);
      Tone.connect(this.delaySend, this.delay);
      this.delay.connect(sum);
      this.reverb = new Reverb(ctx, { decay: 3.2, damping: 0.45, preDelay: 0.018 });
      afterTape.connect(this.reverbSend);
      this.reverbSend.connect(this.reverb.input);
      // A little delay into the reverb so echoes sit in the room.
      const delayToVerb = ctx.createGain();
      delayToVerb.gain.value = 0.35;
      this.delay.connect(delayToVerb);
      delayToVerb.connect(this.reverb.input);
      this.reverb.output.connect(sum);
    }

    sum.connect(this.ducker.node);
    this.ducker.node.connect(this.master);
    if (this.limiter) {
      this.master.connect(this.limiter);
      this.limiter.connect(this.analyser);
    } else {
      this.master.connect(this.analyser);
    }
    Tone.connect(this.analyser, ctx.destination);

    this.setInstrument('chords', opts.chords ?? 'supersawPad', ctx.currentTime);
    if (opts.bass !== null) this.setInstrument('bass', opts.bass ?? 'subBass', ctx.currentTime);
    if (opts.bpm) ctx.transport.bpm.value = opts.bpm;
  }

  /** Build the engine on Tone's current context (live or Tone.Offline). Loads the worklet module once. */
  static async create(opts: EngineOptions = {}): Promise<AudioEngine> {
    const ctx = Tone.getContext();
    let worklets = true;
    try {
      await ctx.addAudioWorkletModule(processorsUrl);
    } catch (err) {
      console.warn('[audio] AudioWorklet unavailable; tape and limiter disabled', err);
      worklets = false;
    }
    return new AudioEngine(ctx, worklets, opts);
  }

  now(): number {
    return this.ctx.currentTime;
  }

  latency(): EngineLatency {
    const raw = this.ctx.rawContext as AudioContext;
    return { base: raw.baseLatency ?? 0, output: raw.outputLatency ?? 0, lookahead: LIVE_LOOKAHEAD };
  }

  /** Wall-clock ms at which audio scheduled for `time` reaches the speakers (best available estimate). */
  heardAt(time: number): number {
    const raw = this.ctx.rawContext as AudioContext;
    const ts = raw.getOutputTimestamp?.();
    if (ts && ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.performanceTime > 0) {
      return performance.timeOrigin + ts.performanceTime + (time - ts.contextTime) * 1000;
    }
    const { base, output } = this.latency();
    return performance.timeOrigin + performance.now() + (time - raw.currentTime + base + output) * 1000;
  }

  instrumentOf(slot: InstrumentSlot): InstrumentId | null {
    return this.slots[slot]?.id ?? null;
  }

  /** Swap an instrument: the old one releases its notes and fades out, the new one fades in. */
  setInstrument(slot: 'chords' | 'bass', id: InstrumentId, time: number): void {
    const old = this.slots[slot];
    if (old?.id === id) return;
    const gain = this.ctx.createGain();
    gain.gain.value = old ? 0 : 1;
    gain.connect(this.slotInputs[slot]);
    const manager = new VoiceManager(this.ctx, this.patchTransform(PATCHES[id]), gain);
    if (old) {
      const notes = old.manager.chordNotes();
      old.manager.releaseAll(time);
      glideTo(old.gain.gain, 0, time, 0.15);
      glideTo(gain.gain, 1, time, 0.05);
      if (notes.length) manager.setChord(notes, time);
      manager.setBrightness(old.manager.brightnessValue, time, 0.01);
      this.retired.push({ manager: old.manager, gain: old.gain, at: time + 3 });
    }
    this.slots[slot] = { manager, gain, id };
  }

  manager(slot: InstrumentSlot): VoiceManager | null {
    return this.slots[slot]?.manager ?? null;
  }

  schedule(e: MusicEvent): void {
    this.collectRetired();
    switch (e.kind) {
      case 'chord': {
        const m = this.manager(e.slot);
        if (!m) return;
        m.setChord(e.chord ? e.voicing : [], e.time, { transition: e.transition, velocity: e.velocity });
        break;
      }
      case 'noteOn':
        this.manager(e.slot)?.noteOn(e.id, e.note, e.velocity, e.time);
        break;
      case 'noteOff':
        this.manager(e.slot)?.noteOff(e.id, e.time);
        break;
      case 'param':
        this.setParam(e.target, e.value, e.time, e.rampMs / 1000);
        break;
      case 'transport':
        this.ctx.transport.bpm.setValueAtTime(e.bpm, e.time);
        this.delay?.delayTime.setValueAtTime(Tone.Time('8n.').toSeconds(), e.time);
        break;
    }
  }

  setParam(path: ParamPath, value: number, time: number, seconds: number): void {
    // Slot levels may boost (up to +12 dB); everything else is a 0..1 control.
    const v = Math.max(0, Math.min(path.endsWith('.level') ? 4 : 1, value));
    const tau = Math.max(MIN_TAU, seconds / 3);
    switch (path) {
      case 'master.volume':
        glideTo(this.master.gain, faderToGain(v), time, tau);
        break;
      case 'macro.brightness':
        for (const s of Object.values(this.slots))
          if (s && s.id !== 'subBass') s.manager.setBrightness(v, time, seconds);
        break;
      case 'macro.space':
        glideTo(this.reverbSend.gain, 0.04 + v * 0.62, time, tau);
        glideTo(this.delaySend.gain, v * 0.3, time, tau);
        break;
      case 'macro.motion':
        this.slots.chords?.manager.setSpread(0.4 + v * 1.8, time, seconds);
        if (this.chorus) glideTo(this.chorus.wet, 0.15 + v * 0.55, time, tau);
        break;
      case 'macro.grit':
        if (this.tape) {
          glideTo(this.tape.parameters.get('drive')!, v, time, tau);
          glideTo(this.tape.parameters.get('wow')!, v * 0.6, time, tau);
        }
        break;
      case 'fx.chorus.mix':
        if (this.chorus) glideTo(this.chorus.wet, v, time, tau);
        break;
      case 'fx.delay.mix':
        glideTo(this.delaySend.gain, v, time, tau);
        break;
      case 'fx.delay.feedback':
        if (this.delay) glideTo(this.delay.feedback, v * 0.85, time, tau);
        break;
      case 'fx.reverb.mix':
        glideTo(this.reverbSend.gain, v, time, tau);
        break;
      case 'fx.tape.drive':
        if (this.tape) glideTo(this.tape.parameters.get('drive')!, v, time, tau);
        break;
      case 'chords.level':
        if (this.slots.chords) glideTo(this.slots.chords.gain.gain, v, time, tau);
        break;
      case 'bass.level':
        if (this.slots.bass) glideTo(this.slots.bass.gain.gain, v, time, tau);
        break;
    }
  }

  releaseAll(time: number): void {
    for (const s of Object.values(this.slots)) s?.manager.releaseAll(time);
  }

  private collectRetired() {
    const now = this.ctx.currentTime;
    this.retired = this.retired.filter((r) => {
      if (now < r.at) return true;
      r.manager.dispose();
      r.gain.disconnect();
      return false;
    });
  }

  dispose(): void {
    for (const s of Object.values(this.slots)) s?.manager.dispose();
    for (const r of this.retired) r.manager.dispose();
    this.chorus?.dispose();
    this.delay?.dispose();
    this.master.disconnect();
  }
}
