/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// Strict CSP: everything is same-origin. 'wasm-unsafe-eval' is required to compile the MediaPipe runtime.
// connect-src 'self' guarantees no video or landmark data can leave the browser.
const CSP = [
  "default-src 'self'",
  // blob: is needed because Tone's standardized-audio-context loads AudioWorklet modules from blob URLs.
  "script-src 'self' 'wasm-unsafe-eval' blob:",
  "worker-src 'self' blob:",
  "connect-src 'self' blob: data:",
  "img-src 'self' blob: data:",
  "media-src 'self' blob: mediastream:",
  "style-src 'self' 'unsafe-inline'",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

/** Injects the CSP as a <meta> tag in production builds (dev needs inline scripts for Fast Refresh). */
function cspMeta(): Plugin {
  return {
    name: 'handwave-csp-meta',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
        injectTo: 'head-prepend',
      },
    ],
  };
}

// The offline-render audio test harness is only built for tests (HANDWAVE_HARNESS=1).
const harness = process.env.HANDWAVE_HARNESS === '1';

export default defineConfig({
  plugins: [react(), cspMeta()],
  build: {
    rollupOptions: {
      input: harness ? { main: 'index.html', harness: 'audio-harness.html' } : { main: 'index.html' },
    },
  },
  worker: { format: 'es' },
  server: {
    // The dev server needs inline scripts for React Fast Refresh, so it only sends cross-origin isolation headers.
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Content-Security-Policy': CSP,
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
