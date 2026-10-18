// Lookahead brick-wall limiter (stereo-linked). Pure DSP core shared by the AudioWorklet and the tests.
//
// For every input sample we compute the gain that would keep it under the ceiling, take the minimum over a
// lookahead window, apply a release, then box-average over the same window. Because the audio is delayed by
// the window length, the averaged gain at the moment a peak comes out is guaranteed to be ≤ the gain that
// peak needs — no overshoot, and the gain itself never jumps (so the limiter can't click).

export class LimiterCore {
  readonly lookahead: number;
  private ceiling: number;
  private releaseCoef: number;
  // Delay lines for audio.
  private bufL: Float32Array;
  private bufR: Float32Array;
  // Required-gain history and monotonic deque for the sliding minimum.
  private req: Float32Array;
  private dq: Int32Array;
  private dqHead = 0;
  private dqTail = 0;
  // Box average of the smoothed gain.
  private box: Float32Array;
  private boxSum: number;
  private smoothed = 1;
  private n = 0;
  /** Lowest gain applied since the last read (for metering). */
  minGain = 1;
  /** Gain applied to the most recent output sample. */
  lastGain = 1;

  constructor(sampleRate: number, ceilingDb = -1, lookaheadMs = 5, releaseMs = 80) {
    this.lookahead = Math.max(1, Math.round((lookaheadMs / 1000) * sampleRate));
    const size = this.lookahead + 1;
    // Audio is delayed by exactly `lookahead` samples; gain windows span lookahead + 1 samples.
    this.bufL = new Float32Array(this.lookahead);
    this.bufR = new Float32Array(this.lookahead);
    this.req = new Float32Array(size).fill(1);
    this.dq = new Int32Array(size + 1);
    this.box = new Float32Array(size).fill(1);
    this.boxSum = size;
    this.ceiling = Math.pow(10, ceilingDb / 20);
    this.releaseCoef = 1 - Math.exp(-1 / ((releaseMs / 1000) * sampleRate));
  }

  setCeilingDb(db: number): void {
    this.ceiling = Math.pow(10, db / 20);
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array): void {
    const size = this.lookahead + 1;
    const dqSize = this.dq.length;
    for (let i = 0; i < inL.length; i++) {
      const l = inL[i]!;
      const r = inR[i]!;
      const peak = Math.max(Math.abs(l), Math.abs(r));
      const need = peak > this.ceiling ? this.ceiling / peak : 1;
      const slot = this.n % size;

      // Sliding-window minimum of `need` over the last `size` samples.
      while (this.dqTail !== this.dqHead) {
        const lastIdx = this.dq[(this.dqTail - 1 + dqSize) % dqSize]!;
        if (this.req[lastIdx % size]! >= need) this.dqTail = (this.dqTail - 1 + dqSize) % dqSize;
        else break;
      }
      this.req[slot] = need;
      this.dq[this.dqTail] = this.n;
      this.dqTail = (this.dqTail + 1) % dqSize;
      while (this.dq[this.dqHead]! <= this.n - size) this.dqHead = (this.dqHead + 1) % dqSize;
      const windowMin = this.req[this.dq[this.dqHead]! % size]!;

      // Release toward unity, never above the window minimum.
      this.smoothed = Math.min(windowMin, this.smoothed + (1 - this.smoothed) * this.releaseCoef);

      // Box average over the window.
      this.boxSum += this.smoothed - this.box[slot]!;
      this.box[slot] = this.smoothed;
      const g = this.boxSum / size;
      if (g < this.minGain) this.minGain = g;
      this.lastGain = g;

      // Output the sample that entered `lookahead` samples ago.
      const aSlot = this.n % this.lookahead;
      const dl = this.bufL[aSlot]!;
      const dr = this.bufR[aSlot]!;
      this.bufL[aSlot] = l;
      this.bufR[aSlot] = r;
      outL[i] = dl * g;
      outR[i] = dr * g;
      this.n++;
    }
  }
}
