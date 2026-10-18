// Save bytes as a file. Everything is generated on the device; nothing is uploaded.

export function downloadBytes(bytes: Uint8Array, filename: string, type: string): void {
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** "handwave-loop-2026-10-18-1432" style names (local time). */
export function fileStamp(prefix: string, d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${prefix}-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export const safeName = (s: string): string =>
  s
    .replace(/[^\w\- ]+/g, '')
    .trim()
    .replace(/\s+/g, '-') || 'track';
