// All custom AudioWorklet processors live in ONE module: Tone's context can only load a single worklet
// module per context.

import { LimiterCore } from '../dsp/limiter';
import { TapeCore } from '../dsp/tape';

const silence = new Float32Array(128);

class TapeProcessor extends AudioWorkletProcessor {
  private core = new TapeCore(sampleRate);
  static get parameterDescriptors(): AudioParamDescriptor[] {
    return [
      { name: 'drive', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'wow', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    params: Record<string, Float32Array>,
  ): boolean {
    const input = inputs[0] ?? [];
    const out = outputs[0]!;
    const l = input[0] ?? silence;
    const r = input[1] ?? l;
    this.core.process(l, r, out[0]!, out[1] ?? out[0]!, params.drive![0]!, params.wow![0]!);
    return true;
  }
}

class LimiterProcessor extends AudioWorkletProcessor {
  private core = new LimiterCore(sampleRate, -1);
  private frames = 0;
  constructor(options?: unknown) {
    super(options);
    this.port.onmessage = (e: MessageEvent<{ ceilingDb?: number }>) => {
      if (typeof e.data.ceilingDb === 'number') this.core.setCeilingDb(e.data.ceilingDb);
    };
  }
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0] ?? [];
    const out = outputs[0]!;
    const l = input[0] ?? silence;
    const r = input[1] ?? l;
    this.core.process(l, r, out[0]!, out[1] ?? out[0]!);
    // Report gain reduction ~10×/s for the meter.
    if ((this.frames += l.length) >= sampleRate / 10) {
      this.port.postMessage({ minGain: this.core.minGain });
      this.core.minGain = 1;
      this.frames = 0;
    }
    return true;
  }
}

registerProcessor('handwave-tape', TapeProcessor);
registerProcessor('handwave-limiter', LimiterProcessor);
