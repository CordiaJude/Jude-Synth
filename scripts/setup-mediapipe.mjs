#!/usr/bin/env node
// Self-hosts MediaPipe assets under public/mediapipe so the app never fetches anything at runtime.
//  - WASM runtime: copied from the installed @mediapipe/tasks-vision package (version-locked by pnpm).
//  - Hand landmarker model: downloaded once from a pinned, versioned URL and verified by SHA-256.
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public', 'mediapipe');

const MODEL = {
  file: 'hand_landmarker.task',
  url: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  sha256: 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1',
};

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function copyWasm() {
  const require = createRequire(import.meta.url);
  // The package doesn't export package.json, so resolve its main entry and walk to the wasm dir.
  const wasmDir = path.join(path.dirname(require.resolve('@mediapipe/tasks-vision')), 'wasm');
  const files = await readdir(wasmDir);
  await Promise.all(files.map((f) => copyFile(path.join(wasmDir, f), path.join(outDir, f))));
  console.log(`[mediapipe] copied ${files.length} wasm files`);
}

async function ensureModel() {
  const dest = path.join(outDir, MODEL.file);
  if (await exists(dest)) {
    if (sha256(await readFile(dest)) === MODEL.sha256) {
      console.log('[mediapipe] model present, checksum ok');
      return;
    }
    console.warn('[mediapipe] model checksum mismatch, re-downloading');
  }
  console.log(`[mediapipe] downloading ${MODEL.url}`);
  const res = await fetch(MODEL.url);
  if (!res.ok) throw new Error(`model download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = sha256(buf);
  if (got !== MODEL.sha256) throw new Error(`model checksum mismatch: expected ${MODEL.sha256}, got ${got}`);
  await writeFile(dest, buf);
  console.log(`[mediapipe] model saved (${(buf.length / 1e6).toFixed(1)} MB)`);
}

await mkdir(outDir, { recursive: true });
await copyWasm();
await ensureModel();
