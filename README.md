# HANDWAVE

A webcam hand-tracking instrument for the browser. Everything runs on your device — no video or landmark
data ever leaves the browser (enforced by a `connect-src 'self'` Content-Security-Policy).

> The product name lives in one place: `src/config/app.ts → APP_NAME`.
> Architecture, interfaces and roadmap: [PLAN.md](PLAN.md).

## Status

- **Phase 1 — tracking core:** hand tracking in a Web Worker, One Euro smoothing, stable hand IDs, a
  rotation-invariant pose recognizer, continuous features, gesture events, debug overlay, capture & label tool.
- **Phase 2 — sound:** theory engine (7 modes, diatonic 7ths/9ths, sus, modal interchange,
  Roman numerals, automatic voice leading, scale quantizer), a click-free polyphonic synth (Supersaw Pad,
  Warm Analog Poly, Sub Bass), an FX bus (chorus, tempo-synced ping-pong delay, procedural convolution
  reverb, tape saturation and lookahead limiter as AudioWorklets), and the **Classic Two-Hand** preset.
- **Phase 3 — mapping & UX (this build):** a declarative gesture → music mapping layer with four presets
  and a live editor, four more instruments (FM Keys, Pluck, Glass Bell, Theremin Lead with tremor vibrato),
  10-second calibration, keyboard and touch play (no camera needed), accessibility settings.

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
| `pnpm test` | Unit tests (Vitest): theory, voice leading, Classic preset, DSP cores, click detectors, filter, tracker, poses, features, events, calibration |
| `pnpm e2e` | Builds, serves the production bundle, runs Playwright in Chromium with a fake webcam, plus the offline-render click tests |
| `pnpm typecheck` / `pnpm lint` | Strict TypeScript / ESLint |
| `pnpm build && pnpm preview` | Production build served with the real CSP headers |

If Playwright's own Chromium isn't installed, point it at any Chromium:
`PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome pnpm e2e`.

## Presets

| Preset | Primary hand (left) | Secondary hand (right) |
|---|---|---|
| **Classic Two-Hand** | chord by pose, tilt = borrow, fist = release | shape (triad/7th/9th/sus4), height = volume, tilt = brightness, distance = space |
| **One-Hand Chords + Melody** | chords; height = pad level | pinch = play a note, height = pitch (scale-locked), swipe up/down = octave |
| **Theremin Pro** | height = volume, distance = space | height = pitch (pulled 60% to the scale), tilt = tone, **hand tremor = vibrato** |
| **DJ/FX** | chords; height = master volume | left/right = DJ filter (centre off), height = delay, tilt = feedback, distance = reverb, close hand = grit |

Open **Mappings** to see exactly what each gesture does, with live meters and curve previews. Change any
source, target, range, curve, inversion or deadzone; press **Learn** and move to assign whatever you moved
most; add or remove gesture triggers. Editing a built-in preset saves a copy. Presets are stored in this
browser and can be exported/imported as JSON (imports are validated).

## No camera? Keyboard and touch

Choose **Play with keyboard / touch** on the start page (or enable the touch pad in Settings).

| Keys | Does |
|---|---|
| `1`–`7` (Shift = borrowed) | chord on degree I…VII |
| `Q` `W` `E` `R` | triad · 7th · 9th · sus4 |
| `↑` `↓` / `←` `→` | chord octave / inversion |
| `Space` or `0` / `L` | release / latch |
| `Z` … `/` | melody notes (scale degrees 1–10) |

The touch pad has the seven degree pads (labelled with Roman numeral and chord name), shapes, borrow,
latch and release, plus a melody strip for the melody/theremin presets.

## Calibration and settings

The first time the camera starts, a 10-second calibration (open palm → fist → pinch) learns your range of
motion; the timer pauses whenever no hand is visible. It is saved locally and can be redone or reset in
**Settings**, which also has reduced motion (or follow the OS), a high-contrast palette, and the keyboard
reference.

## Playing Classic Two-Hand

| Hand | Gesture | Does |
|---|---|---|
| Primary (left) | 1 · 2 · 3 · 4 fingers, open hand, index+pinky, thumb+index+pinky | chord on degree I … VII of the key |
| Primary | tilt the wrist past ~30° | borrow that chord from the parallel mode (IV → iv, VI → ♭VI, VII → ♭VII …) |
| Primary | fist (or take the hand away) | release the chord |
| Secondary (right) | 1 · 2 · 3 · 4 fingers / open | triad · 7th · 9th · sus4 / triad |
| Secondary | fist | voice the chord an octave lower |
| Secondary | height · wrist tilt · distance | volume · brightness (filter) · space (reverb) |

Chords are voice-led (each voice moves to the nearest note of the next chord) and the Sub Bass follows
the root. Key, mode, instrument and bass are in the bar under the top bar; the chord name and Roman
numeral are shown large. The demo mode plays too.

**No clicks, verified.** `pnpm e2e` renders scripted performances through the real engine offline
(Tone.Offline) and checks every sample. Every instrument's real patch — envelopes, resonant filter
envelopes, glides, voice stealing, crossfades — is rendered with its oscillators swapped for sines, where a
click is unambiguous (a sum of sines has a bounded second derivative). Positive controls prove the
detector catches naive synthesis and a deliberately broken hard-cut release. Full-FX renders of the real
waveforms check levels, NaNs and the −1 dBFS limiter ceiling.

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
