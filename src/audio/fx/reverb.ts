// Convolution reverb with a procedurally generated IR. Changing the room crossfades between two
// convolvers, because swapping a convolver's buffer while it plays would click.

import type { BaseContext } from 'tone';
import { rampTo } from '../params';
import { generateIR, type ReverbShape } from './reverbIR';

export class Reverb {
  readonly input: GainNode;
  readonly output: GainNode;
  private a: { conv: ConvolverNode; gain: GainNode };
  private b: { conv: ConvolverNode; gain: GainNode };
  private active: 'a' | 'b' = 'a';

  constructor(
    private ctx: BaseContext,
    shape: ReverbShape,
  ) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    const make = () => {
      const conv = ctx.createConvolver();
      conv.normalize = false;
      const gain = ctx.createGain();
      this.input.connect(conv);
      conv.connect(gain);
      gain.connect(this.output);
      return { conv, gain };
    };
    this.a = make();
    this.b = make();
    this.a.conv.buffer = this.buffer(shape);
    this.a.gain.gain.value = 1;
    this.b.gain.gain.value = 0;
  }

  private buffer(shape: ReverbShape): AudioBuffer {
    const [l, r] = generateIR(this.ctx.sampleRate, shape);
    const buf = this.ctx.createBuffer(2, l.length, this.ctx.sampleRate);
    buf.copyToChannel(l as Float32Array<ArrayBuffer>, 0);
    buf.copyToChannel(r as Float32Array<ArrayBuffer>, 1);
    return buf;
  }

  /** Swap to a new room with a 400 ms equal-ish crossfade. */
  setShape(shape: ReverbShape, time: number): void {
    const from = this.active === 'a' ? this.a : this.b;
    const to = this.active === 'a' ? this.b : this.a;
    to.conv.buffer = this.buffer(shape);
    rampTo(from.gain.gain, 0, time, 0.4);
    rampTo(to.gain.gain, 1, time, 0.4);
    this.active = this.active === 'a' ? 'b' : 'a';
  }
}
