// Tape stage: gentle 2× oversampled asymmetric saturation, a darkening tone filter, and wow/flutter from a
// modulated delay line. With drive = 0 and wow = 0 it is exactly a fixed short delay (transparent).

const BASE_DELAY_S = 0.004;

export class TapeCore {
  private sr: number;
  private ringL: Float32Array;
  private ringR: Float32Array;
  private w = 0;
  private phaseWow = 0;
  private phaseFlutter = 0;
  private prevL = 0;
  private prevR = 0;
  private toneL = 0;
  private toneR = 0;

  constructor(sampleRate: number) {
    this.sr = sampleRate;
    const size = 1 << Math.ceil(Math.log2(sampleRate * 0.02));
    this.ringL = new Float32Array(size);
    this.ringR = new Float32Array(size);
  }

  /**
   * Asymmetric soft saturation, normalized to unity gain at the nominal program level (−12 dBFS), so more
   * drive adds harmonics and compression instead of making everything quieter.
   */
  private static sat(x: number, k: number): number {
    const bias = 0.12; // a small DC bias before tanh adds even harmonics ("warmth"); its DC is removed
    const nominal = 0.25;
    const norm = nominal / (Math.tanh(k * (nominal + bias)) - Math.tanh(k * bias));
    return (Math.tanh(k * (x + bias)) - Math.tanh(k * bias)) * norm;
  }

  private read(ring: Float32Array, delaySamples: number): number {
    const mask = ring.length - 1;
    const pos = this.w - delaySamples;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const a = ring[i0 & mask]!;
    const b = ring[(i0 + 1) & mask]!;
    return a + (b - a) * frac;
  }

  process(
    inL: Float32Array,
    inR: Float32Array,
    outL: Float32Array,
    outR: Float32Array,
    drive: number,
    wow: number,
  ): void {
    const mask = this.ringL.length - 1;
    const k = 1 + 7 * drive;
    const wet = Math.min(1, drive * 3);
    // Tone: one-pole lowpass whose cutoff falls from ~16 kHz to ~7 kHz with drive (only when driven).
    const fc = 16000 - 9000 * drive;
    const toneA = 1 - Math.exp((-2 * Math.PI * fc) / this.sr);
    const wowDepth = wow * 0.0016 * this.sr; // up to ±1.6 ms
    const flutterDepth = wow * 0.00012 * this.sr;
    const dWow = (2 * Math.PI * 0.55) / this.sr;
    const dFlutter = (2 * Math.PI * 6.8) / this.sr;
    const base = BASE_DELAY_S * this.sr;

    for (let i = 0; i < inL.length; i++) {
      let l = inL[i]!;
      let r = inR[i]!;
      if (wet > 0) {
        // 2× oversample: saturate the midpoint and the sample, average back down.
        const ml = TapeCore.sat((l + this.prevL) * 0.5, k);
        const mr = TapeCore.sat((r + this.prevR) * 0.5, k);
        const sl = TapeCore.sat(l, k);
        const sr = TapeCore.sat(r, k);
        this.prevL = l;
        this.prevR = r;
        const satL = (ml + sl) * 0.5;
        const satR = (mr + sr) * 0.5;
        this.toneL += toneA * (satL - this.toneL);
        this.toneR += toneA * (satR - this.toneR);
        l = l + (this.toneL - l) * wet;
        r = r + (this.toneR - r) * wet;
      } else {
        this.prevL = l;
        this.prevR = r;
        this.toneL = l;
        this.toneR = r;
      }
      this.ringL[this.w & mask] = l;
      this.ringR[this.w & mask] = r;
      const d = base + wowDepth * Math.sin(this.phaseWow) + flutterDepth * Math.sin(this.phaseFlutter);
      outL[i] = this.read(this.ringL, d);
      outR[i] = this.read(this.ringR, d + flutterDepth * 0.3);
      this.phaseWow += dWow;
      this.phaseFlutter += dFlutter;
      this.w++;
    }
    if (this.phaseWow > 1e4) this.phaseWow %= 2 * Math.PI;
    if (this.phaseFlutter > 1e4) this.phaseFlutter %= 2 * Math.PI;
  }
}
