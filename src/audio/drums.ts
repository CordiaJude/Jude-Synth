// Synthesized drum kit — no samples. Each hit builds a few short-lived nodes with scheduled envelopes and
// disconnects them when done. Envelopes start from silence and use setTarget decays, so hits are
// percussive but never click on release.

import type { BaseContext } from 'tone';
import type { DrumVoice } from '../events/types';
import { mulberry32 } from '../gestures/testing/synthetic';

const TAIL = {
  kick: 0.6,
  snare: 0.4,
  clap: 0.5,
  hat: 0.15,
  openHat: 0.7,
  rim: 0.15,
  tom: 0.6,
  crash: 2.4,
} as const;

export class DrumKit {
  readonly output: GainNode;
  private noise: AudioBuffer;
  private openHatGain: GainNode | null = null;

  constructor(private ctx: BaseContext) {
    this.output = ctx.createGain();
    this.output.gain.value = 0.8;
    // 1 s of deterministic white noise shared by all noisy voices.
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const rng = mulberry32(42);
    const data = new Float32Array(len);
    for (let i = 0; i < len; i++) data[i] = rng() * 2 - 1;
    this.noise.copyToChannel(data, 0);
  }

  /** Envelope: 1 ms linear attack to `peak`, then exponential decay with time constant `tau`. */
  private env(time: number, peak: number, tau: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(peak, time + 0.001);
    g.gain.setTargetAtTime(0, time + 0.001, tau);
    return g;
  }

  private noiseSource(time: number, stop: number): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start(time, Math.random() * 0.9);
    src.stop(stop);
    return src;
  }

  private filtered(type: BiquadFilterType, freq: number, q: number): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  private cleanup(nodes: AudioNode[], src: AudioScheduledSourceNode) {
    src.onended = () => nodes.forEach((n) => n.disconnect());
  }

  trigger(voice: DrumVoice, velocity: number, time: number): void {
    const v = Math.max(0.05, Math.min(1, velocity));
    const end = time + TAIL[voice];
    const out = this.output;
    switch (voice) {
      case 'kick': {
        const osc = this.ctx.createOscillator();
        osc.frequency.setValueAtTime(160, time);
        osc.frequency.exponentialRampToValueAtTime(48, time + 0.11);
        const g = this.env(time, 0.95 * v, 0.13);
        osc.connect(g).connect(out);
        osc.start(time);
        osc.stop(end);
        // Beater click.
        const n = this.noiseSource(time, time + 0.02);
        const hp = this.filtered('highpass', 3000, 0.7);
        const ng = this.env(time, 0.12 * v, 0.003);
        n.connect(hp).connect(ng).connect(out);
        this.cleanup([osc, g], osc);
        this.cleanup([n, hp, ng], n);
        break;
      }
      case 'snare': {
        const n = this.noiseSource(time, end);
        const bp = this.filtered('bandpass', 1900, 0.8);
        const ng = this.env(time, 0.55 * v, 0.06);
        n.connect(bp).connect(ng).connect(out);
        const tone = this.ctx.createOscillator();
        tone.type = 'triangle';
        tone.frequency.setValueAtTime(220, time);
        tone.frequency.exponentialRampToValueAtTime(170, time + 0.05);
        const tg = this.env(time, 0.4 * v, 0.04);
        tone.connect(tg).connect(out);
        tone.start(time);
        tone.stop(end);
        this.cleanup([n, bp, ng], n);
        this.cleanup([tone, tg], tone);
        break;
      }
      case 'clap': {
        const n = this.noiseSource(time, end);
        const bp = this.filtered('bandpass', 1300, 1.2);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0, time);
        // Three quick bursts then a short tail: the classic handclap.
        for (const [k, dt] of [0, 0.011, 0.022].entries()) {
          g.gain.setTargetAtTime(0.6 * v * (k === 2 ? 1 : 0.8), time + dt, 0.0005);
          g.gain.setTargetAtTime(0.05 * v, time + dt + 0.003, 0.003);
        }
        g.gain.setTargetAtTime(0, time + 0.03, 0.07);
        n.connect(bp).connect(g).connect(out);
        this.cleanup([n, bp, g], n);
        break;
      }
      case 'hat':
      case 'openHat': {
        // A closed hat chokes a ringing open hat, like a real hi-hat.
        if (this.openHatGain) {
          this.openHatGain.gain.cancelScheduledValues(time);
          this.openHatGain.gain.setTargetAtTime(0, time, 0.006);
          this.openHatGain = null;
        }
        const n = this.noiseSource(time, end);
        const hp = this.filtered('highpass', 7500, 0.6);
        const g = this.env(time, (voice === 'hat' ? 0.32 : 0.28) * v, voice === 'hat' ? 0.018 : 0.18);
        n.connect(hp).connect(g).connect(out);
        if (voice === 'openHat') this.openHatGain = g;
        this.cleanup([n, hp, g], n);
        break;
      }
      case 'rim': {
        const osc = this.ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.value = 820;
        const bp = this.filtered('bandpass', 1700, 3);
        const g = this.env(time, 0.3 * v, 0.012);
        osc.connect(bp).connect(g).connect(out);
        osc.start(time);
        osc.stop(end);
        this.cleanup([osc, bp, g], osc);
        break;
      }
      case 'tom': {
        const osc = this.ctx.createOscillator();
        osc.frequency.setValueAtTime(170, time);
        osc.frequency.exponentialRampToValueAtTime(95, time + 0.18);
        const g = this.env(time, 0.7 * v, 0.1);
        osc.connect(g).connect(out);
        osc.start(time);
        osc.stop(end);
        this.cleanup([osc, g], osc);
        break;
      }
      case 'crash': {
        const n = this.noiseSource(time, end);
        const hp = this.filtered('highpass', 4200, 0.5);
        const g = this.env(time, 0.3 * v, 0.55);
        n.connect(hp).connect(g).connect(out);
        this.cleanup([n, hp, g], n);
        break;
      }
    }
  }
}
