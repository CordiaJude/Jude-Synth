// PCM WAV encoder (16- or 24-bit, interleaved). 16-bit output gets TPDF dither so quiet tails fade out
// smoothly instead of turning into quantization buzz. Pure; the dither noise is seeded, so output is
// reproducible.

import { mulberry32 } from '../gestures/testing/synthetic';

export type BitDepth = 16 | 24;

export function encodeWav(
  channels: readonly Float32Array[],
  sampleRate: number,
  bitDepth: BitDepth = 24,
): Uint8Array {
  const nCh = channels.length;
  const frames = channels[0]?.length ?? 0;
  const bytesPer = bitDepth / 8;
  const dataBytes = frames * nCh * bytesPer;
  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer);
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[offset + i] = s.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, nCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * nCh * bytesPer, true);
  view.setUint16(32, nCh * bytesPer, true);
  view.setUint16(34, bitDepth, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);

  const max = bitDepth === 16 ? 32767 : 8388607;
  const rng = mulberry32(0x5eed);
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nCh; c++) {
      const x = channels[c]![i]!;
      const s = Number.isFinite(x) ? Math.max(-1, Math.min(1, x)) : 0;
      const dither = bitDepth === 16 ? rng() - rng() : 0; // ±1 LSB triangular
      const v = Math.max(-max - 1, Math.min(max, Math.round(s * max + dither)));
      if (bitDepth === 16) {
        view.setInt16(o, v, true);
      } else {
        out[o] = v & 255;
        out[o + 1] = (v >> 8) & 255;
        out[o + 2] = (v >> 16) & 255;
      }
      o += bytesPer;
    }
  }
  return out;
}
