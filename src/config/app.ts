/** The one place the product name lives. Rename here and everywhere follows. */
export const APP_NAME = 'HANDWAVE';
export const APP_TAGLINE = 'Play music with your hands.';
export const PRIVACY_STATEMENT =
  'Everything runs on your device. Your camera feed is processed locally and never leaves this browser.';

/** Base URL for self-hosted MediaPipe assets (see scripts/setup-mediapipe.mjs). */
export const MEDIAPIPE_BASE = `${import.meta.env.BASE_URL}mediapipe`;
export const HAND_MODEL_URL = `${MEDIAPIPE_BASE}/hand_landmarker.task`;

/** Camera request: prefer 60 fps (halves frame-interval latency) and a modest resolution. */
export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: 'user',
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 60, max: 60 },
  },
};
