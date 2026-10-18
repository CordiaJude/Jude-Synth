// Feature detection drives graceful degradation. Evaluated once at startup (browser only).

export interface Capabilities {
  mobile: boolean;
  lowPower: boolean;
  offscreenCanvas: boolean;
  requestVideoFrameCallback: boolean;
  mediaStreamTrackProcessor: boolean;
  webMidi: boolean;
  webCodecs: boolean;
  mediaRecorder: boolean;
}

export function detectCapabilities(): Capabilities {
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  const mobile =
    nav.userAgentData?.mobile ??
    (/Android|iPhone|iPod/i.test(navigator.userAgent) ||
      (navigator.maxTouchPoints > 1 && window.innerWidth < 820));
  return {
    mobile,
    lowPower: mobile || (navigator.hardwareConcurrency ?? 8) <= 4,
    offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
    requestVideoFrameCallback: 'requestVideoFrameCallback' in HTMLVideoElement.prototype,
    mediaStreamTrackProcessor: 'MediaStreamTrackProcessor' in window,
    webMidi: 'requestMIDIAccess' in navigator,
    webCodecs: typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined',
    mediaRecorder: typeof MediaRecorder !== 'undefined',
  };
}

/** Camera constraints per device class: phones get a smaller, 30 fps stream to keep tracking real-time. */
export function cameraConstraints(caps: Capabilities): MediaStreamConstraints {
  if (caps.lowPower) {
    return {
      audio: false,
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
    };
  }
  return {
    audio: false,
    video: {
      facingMode: 'user',
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 60, max: 60 },
    },
  };
}
