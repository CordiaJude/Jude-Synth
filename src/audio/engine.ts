// The audio engine: instrument slots → FX bus → master. All scheduling uses the audio clock; the engine
// only ever receives MusicEvents with absolute AudioContext times.
//
//  chords ─► chorus ─┐
//  bass ─────────────┴► tape ─► dry ───────────────┐
//                            ├► delay send ► ping-pong ─┤─► ducker ─► master ─► limiter ─► analyser ─► out
//                            └► reverb send ► reverb ───┘

import * as Tone from 'tone';
import {
  isLoopSlot,
  type InstrumentSlot,
  type MusicEvent,
  type ParamPath,
  type SlotRef,
} from '../events/types';
import { DrumKit } from './drums';
import { Ducker } from './fx/ducker';
import { Reverb } from './fx/reverb';
import { PATCHES } from './instruments/patches';
import type { InstrumentId, Patch } from './instruments/types';
import { expRange, faderToGain, glideTo, MIN_TAU } from './params';

/** DJ filter "open" cutoffs: effectively bypassed. */
const DJ_OPEN_LP = (sampleRate: number) => 0.45 * sampleRate;
const DJ_OPEN_HP = 12;
import { VoiceManager } from './voiceManager';
import processorsUrl from './worklets/processors.worklet.ts?worker&url';

export interface EngineOptions {
  chords?: InstrumentId;
  bass?: InstrumentId | null;
  melody?: InstrumentId | null;
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
export type SlotName = 'chords' | 'bass' | 'melody';
/** Which live part a looper track was recorded from; decides where in the mix it plays. */
export type TrackPart = 'chords' | 'melody' | 'bass' | 'drums';
type Track = { part: TrackPart; gain: GainNode; slot: Slot | null; kit: DrumKit | null };

const dbToGain = (db: number) => (db <= -60 ? 0 : Math.pow(10, db / 20));

export class AudioEngine {
  readonly ctx: Tone.BaseContext;
  readonly analyser: AnalyserNode;
  readonly ducker: Ducker;
  private drums: DrumKit;
  private drumsGain: GainNode;
  private slots: Partial<Record<InstrumentSlot, Slot>> = {};
  /** Looper tracks, each with its own instrument and level, feeding the looper bus. */
  private tracks = new Map<string, Track>();
  private loopBus: Record<TrackPart, GainNode>;
  private slotInputs: Record<SlotName, AudioNode>;
  private djLow: BiquadFilterNode;
  private djHigh: BiquadFilterNode;
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
    const melodyIn = ctx.createGain();
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
    melodyIn.connect(preFx);
    // Drums go through tape (glue) but skip the chorus; they are not ducked by their own kick.
    this.drums = new DrumKit(ctx);
    this.drumsGain = ctx.createGain();
    this.drums.output.connect(this.drumsGain);
    this.slotInputs = { chords: chordsIn, bass: bassIn, melody: melodyIn };
    // Looper tracks join the mix at the same points as the live part they were recorded from.
    this.loopBus = {
      chords: ctx.createGain(),
      melody: ctx.createGain(),
      bass: ctx.createGain(),
      drums: ctx.createGain(),
    };
    this.loopBus.chords.connect(chordsIn);
    this.loopBus.melody.connect(melodyIn);
    this.loopBus.bass.connect(bassIn);
    this.loopBus.drums.connect(this.drumsGain);

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

    // DJ filter: a low-pass and a high-pass always in series; "bypass" is both wide open, so sweeping
    // through the centre never switches anything in or out (no clicks).
    this.djLow = ctx.createBiquadFilter();
    this.djLow.type = 'lowpass';
    this.djLow.Q.value = 0.9;
    this.djLow.frequency.value = DJ_OPEN_LP(ctx.sampleRate);
    this.djHigh = ctx.createBiquadFilter();
    this.djHigh.type = 'highpass';
    this.djHigh.Q.value = 0.9;
    this.djHigh.frequency.value = DJ_OPEN_HP;
    sum.connect(this.djLow);
    // Drums join after the ducker so the kick ducks everything else, not itself.
    const drumsPost = ctx.createGain();
    this.drumsGain.connect(drumsPost);
    if (this.tape) {
      const drumTape = ctx.createAudioWorkletNode('handwave-tape', { outputChannelCount: [2] });
      drumsPost.connect(drumTape);
      drumTape.connect(this.master);
    } else {
      drumsPost.connect(this.master);
    }
    if (this.reverb) {
      const drumVerb = ctx.createGain();
      drumVerb.gain.value = 0.12;
      this.drumsGain.connect(drumVerb);
      drumVerb.connect(this.reverb.input);
    }
    this.djLow.connect(this.djHigh);
    this.djHigh.connect(this.ducker.node);
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
    if (opts.melody) this.setInstrument('melody', opts.melody, ctx.currentTime);
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
  setInstrument(slot: SlotName, id: InstrumentId, time: number): void {
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

  manager(slot: SlotRef): VoiceManager | null {
    if (isLoopSlot(slot)) return this.tracks.get(slot.slice(5))?.slot?.manager ?? null;
    return this.slots[slot]?.manager ?? null;
  }

  // ---- looper tracks ------------------------------------------------------------------------------------

  hasTrack(id: string): boolean {
    return this.tracks.has(id);
  }

  /** Add a looper track (its instrument, level and starting brightness). */
  addTrack(
    id: string,
    part: TrackPart,
    instrument: InstrumentId | 'drums',
    opts: { gainDb: number; brightness: number },
    time: number,
  ): void {
    if (this.tracks.has(id)) return;
    const gain = this.ctx.createGain();
    gain.gain.value = dbToGain(opts.gainDb);
    gain.connect(this.loopBus[part]);
    const track: Track = { part, gain, slot: null, kit: null };
    if (instrument === 'drums') {
      track.kit = new DrumKit(this.ctx);
      track.kit.output.connect(gain);
    } else {
      track.slot = this.trackSlot(instrument, gain);
      if (opts.brightness !== track.slot.manager.brightnessValue && instrument !== 'subBass')
        track.slot.manager.setBrightness(opts.brightness, time, 0.01);
    }
    this.tracks.set(id, track);
  }

  private trackSlot(id: InstrumentId, out: AudioNode): Slot {
    const gain = this.ctx.createGain();
    gain.connect(out);
    return { manager: new VoiceManager(this.ctx, this.patchTransform(PATCHES[id]), gain), gain, id };
  }

  /** Change a track's instrument with the same crossfade as the live slots. */
  setTrackInstrument(id: string, instrument: InstrumentId, time: number): void {
    const t = this.tracks.get(id);
    if (!t?.slot || t.slot.id === instrument) return;
    const old = t.slot;
    const next = this.trackSlot(instrument, t.gain);
    next.gain.gain.value = 0;
    old.manager.releaseAll(time);
    glideTo(old.gain.gain, 0, time, 0.15);
    glideTo(next.gain.gain, 1, time, 0.05);
    next.manager.setBrightness(old.manager.brightnessValue, time, 0.01);
    this.retired.push({ manager: old.manager, gain: old.gain, at: time + 3 });
    t.slot = next;
  }

  setTrackGain(id: string, db: number, time: number): void {
    const t = this.tracks.get(id);
    if (t) glideTo(t.gain.gain, dbToGain(db), time, 0.03);
  }

  /** Release and fade a track out, then free it. */
  removeTrack(id: string, time: number): void {
    const t = this.tracks.get(id);
    if (!t) return;
    this.tracks.delete(id);
    t.slot?.manager.releaseAll(time);
    glideTo(t.gain.gain, 0, time, 0.05);
    if (t.slot) this.retired.push({ manager: t.slot.manager, gain: t.gain, at: time + 3 });
    else setTimeout(() => t.gain.disconnect(), 3000);
  }

  releaseTracks(time: number): void {
    for (const t of this.tracks.values()) t.slot?.manager.releaseAll(time);
  }

  /** Metronome / count-in tick. Goes straight to the kit, never through the bus (so it is never recorded). */
  click(time: number, accent: boolean): void {
    this.drums.click(time, accent);
  }

  schedule(e: MusicEvent): void {
    this.collectRetired();
    switch (e.kind) {
      case 'chord': {
        const m = this.manager(e.slot);
        if (!m || e.play === false) return;
        const voicing = e.chord || isLoopSlot(e.slot) ? e.voicing : [];
        m.setChord(voicing, e.time, { transition: e.transition, velocity: e.velocity });
        break;
      }
      case 'noteOn':
        this.manager(e.slot)?.noteOn(e.id, e.note, e.velocity, e.time);
        break;
      case 'noteOff':
        this.manager(e.slot)?.noteOff(e.id, e.time);
        break;
      case 'pitch':
        this.manager(e.slot)?.pitchNote(e.id, e.note, e.time, e.glide);
        break;
      case 'slotRelease':
        this.manager(e.slot)?.releaseAll(e.time);
        break;
      case 'drum': {
        const kit = e.slot ? this.tracks.get(e.slot.slice(5))?.kit : this.drums;
        if (!kit) return;
        kit.trigger(e.voice, e.velocity, e.time);
        if (e.voice === 'kick') this.ducker.trigger(e.time, e.velocity);
        break;
      }
      case 'param':
        if (e.slot) this.setTrackParam(e.slot.slice(5), e.target, e.value, e.time, e.rampMs / 1000);
        else this.setParam(e.target, e.value, e.time, e.rampMs / 1000);
        break;
      case 'transport':
        this.ctx.transport.bpm.setValueAtTime(e.bpm, e.time);
        this.delay?.delayTime.setValueAtTime(Tone.Time('8n.').toSeconds(), e.time);
        break;
    }
  }

  /** Track automation: only the per-instrument controls make sense on a single track. */
  private setTrackParam(id: string, path: ParamPath, value: number, time: number, seconds: number) {
    const m = this.tracks.get(id)?.slot?.manager;
    if (!m) return;
    if (path === 'macro.brightness') m.setBrightness(Math.max(0, Math.min(1, value)), time, seconds);
    else if (path === 'melody.vibrato') m.setVibrato(Math.max(0, Math.min(1, value)), time, seconds);
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
      case 'fx.duck':
        this.ducker.amount = v;
        break;
      case 'drums.level':
        glideTo(this.drumsGain.gain, v, time, tau);
        break;
      case 'loops.level':
        for (const g of Object.values(this.loopBus)) glideTo(g.gain, v, time, tau);
        break;
      case 'melody.level':
        if (this.slots.melody) glideTo(this.slots.melody.gain.gain, v, time, tau);
        break;
      case 'melody.vibrato':
        this.slots.melody?.manager.setVibrato(v, time, seconds);
        break;
      case 'fx.djFilter': {
        const sr = this.ctx.sampleRate;
        const lp = v < 0.5 ? expRange(v / 0.5, 140, DJ_OPEN_LP(sr)) : DJ_OPEN_LP(sr);
        const hp = v > 0.5 ? expRange((v - 0.5) / 0.5, DJ_OPEN_HP, 5000) : DJ_OPEN_HP;
        glideTo(this.djLow.frequency, lp, time, tau);
        glideTo(this.djHigh.frequency, hp, time, tau);
        break;
      }
      case 'bass.level':
        if (this.slots.bass) glideTo(this.slots.bass.gain.gain, v, time, tau);
        break;
    }
  }

  /** Release the live slots (looper tracks keep playing; see releaseTracks). */
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
    for (const t of this.tracks.values()) t.slot?.manager.dispose();
    for (const r of this.retired) r.manager.dispose();
    this.chorus?.dispose();
    this.delay?.dispose();
    this.master.disconnect();
  }
}
