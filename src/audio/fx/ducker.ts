import type { BaseContext } from 'tone';
import { glideTo } from '../params';

/** Sidechain-style ducking driven by scheduled triggers (e.g. kick drum events) — sample-accurate. */
export class Ducker {
  readonly node: GainNode;
  amount = 0;

  constructor(ctx: BaseContext) {
    this.node = ctx.createGain();
    this.node.gain.value = 1;
  }

  trigger(time: number, strength = 1): void {
    const depth = this.amount * strength;
    if (depth <= 0) return;
    glideTo(this.node.gain, 1 - depth * 0.85, time, 0.003);
    this.node.gain.setTargetAtTime(1, time + 0.04, 0.09);
  }
}
