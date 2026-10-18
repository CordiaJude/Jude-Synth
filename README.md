# HANDWAVE

A webcam hand-tracking instrument for the browser. Everything runs on your device — no video or landmark
data ever leaves the browser (enforced by a `connect-src 'self'` Content-Security-Policy).

> The product name lives in one place: `src/config/app.ts → APP_NAME`.
> Architecture, interfaces and roadmap: [PLAN.md](PLAN.md).

## Status

**Phase 1 — tracking core** (this build): hand tracking in a Web Worker, One Euro smoothing, stable hand
IDs, a rotation-invariant pose recognizer, continuous features, gesture events, a debug overlay and a
capture & label tool. No sound yet — that is Phase 2.

## Run it locally

Requirements: Node 20+ and pnpm (`corepack enable` gives you pnpm).

```bash
pnpm install        # also copies the MediaPipe WASM into public/mediapipe and downloads the
                    # hand model once (7.8 MB, pinned URL, SHA-256 verified)
pnpm dev            # http://localhost:5173
```

Open the URL in Chrome or Edge, click **Enable camera**, allow access, and hold up a hand. Or click
**Try the demo (no camera)** to see synthetic hands drive the same recognizer.

Other scripts:

| Command | What it does |
|---|---|
| `pnpm test` | Unit tests (Vitest): filter, tracker, finger extension, poses, features, events, calibration |
| `pnpm e2e` | Builds, serves the production bundle, runs Playwright in Chromium with a fake webcam |
| `pnpm typecheck` / `pnpm lint` | Strict TypeScript / ESLint |
| `pnpm build && pnpm preview` | Production build served with the real CSP headers |

If Playwright's own Chromium isn't installed, point it at any Chromium:
`PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome pnpm e2e`.

## What to try in Phase 1

- **Poses** (primary = your left hand by default, secondary = your right): fist, one … four, open hand,
  index+pinky, thumb+index+pinky, thumb only, pinch (OK sign). Rotate and tilt your hand — the pose should
  hold, because extension is measured from 3D joint angles, not screen-space y positions.
- **Cross your hands** — the blue (primary) and orange (secondary) roles stay with the same hand.
- **Debug panel** (right side): per-finger extension bars with the hysteresis thresholds marked, ranked pose
  scores, palm position/depth/roll/pitch/yaw, pinch, speed, tremor, the event log (pinch tap, fist clench,
  swipes, snaps) and live pipeline timing: detect time, capture→gesture latency, main-thread cost per frame.
- **Tuning**: One Euro cutoff/beta for position and fingers, hysteresis thresholds, debounce, predictive
  onset. Settings persist in localStorage.

## Building the accuracy corpus (≥95% bar)

The synthetic rotation-grid tests pass at ≥99%, but the real bar is measured on recorded hands:

1. Start the camera, open the debug panel, scroll to **Capture & label**.
2. Pick which hand you are labeling, press **Record**.
3. Hold a pose and press its key (`0` fist, `1`–`4`, `5` open, `6` index+pinky, `7` thumb+index+pinky,
   `8` thumb, `9` pinch). Slowly rotate/tilt the hand. Press `t` while moving between poses.
4. **Stop & save** downloads `handwave-capture-*.json` (unfiltered landmarks + labels) and a `.webm` video.
5. Put the JSON in `tests/fixtures/landmarks/`. `pnpm test` now runs `corpus.test.ts`, which replays every
   recording through the real tracker + recognizer and requires ≥95% accuracy.
6. For the fake-camera e2e run, convert the video:
   `ffmpeg -i capture.webm -pix_fmt yuv420p tests/e2e/fixtures/hands.y4m`, then
   `FAKE_VIDEO=tests/e2e/fixtures/hands.y4m pnpm e2e`.

## Browser support (Phase 1)

| | Frame path | Notes |
|---|---|---|
| Chrome / Edge | Tier A: `MediaStreamTrackProcessor` frames inside the worker | zero main-thread video work |
| Safari 17+, Firefox | Tier B: `requestVideoFrameCallback` → `ImageBitmap` transferred to the worker | ~0.3–1 ms main thread per frame |

The GPU delegate is used when the machine has a hardware WebGL2 renderer; software renderers
(SwiftShader/llvmpipe) and failures fall back to the WASM CPU delegate automatically.
