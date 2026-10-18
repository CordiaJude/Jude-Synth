// The gesture recognizer: VisionFrame in, GestureFrame out. Deterministic — it depends only on its inputs
// and its own state (no clocks, no globals), so recorded landmark sequences replay identically in tests.
// For speed the state object is updated in place; callers own it and can snapshot or reset it freely.

import { FINGERS, LM, type Finger, type LandmarkArray } from '../vision/landmarks';
import type { HandId, HandRole, TrackedHand, VisionFrame } from '../vision/types';
import {
  stepPinch,
  stepSnap,
  stepSwipe,
  History,
  type PinchDetector,
  type SnapDetector,
  type SwipeDetector,
} from './events';
import { depthFromScale, imagePalmCenter, imageScale, palmOrientation, pinchAmount } from './features';
import { DEFAULT_FINGER_RANGES, fingerExtensions, palmSize } from './fingers';
import { extendedProbabilities, scorePoses } from './poses';
import {
  DEFAULT_GESTURE_CONFIG,
  type Calibration,
  type FingerState,
  type GestureConfig,
  type GestureEvent,
  type GestureFrame,
  type HandFeatures,
  type HandGesture,
  type PoseId,
  type PoseResult,
} from './types';
import { at, clamp01, dist, unlerp, vec } from './vec';

interface Kinematics {
  init: boolean;
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  ax: number;
  ay: number;
  az: number;
}

interface Tremor {
  init: boolean;
  prevX: number;
  prevY: number;
  hpX: number;
  hpY: number;
  lpX: number;
  lpY: number;
  energy: number;
}

interface HandState {
  id: HandId;
  role: HandRole;
  lastT: number;
  ext: Float64Array;
  extVel: Float64Array;
  extended: boolean[];
  pose: PoseId;
  poseSince: number;
  candidate: PoseId | null;
  candidateSince: number;
  /** Pose announced early by predictive onset and not yet confirmed. */
  tentative: PoseId | null;
  tentativeSince: number;
  pinch: PinchDetector;
  swipe: SwipeDetector;
  snap: SnapDetector;
  openness: History;
  kin: Kinematics;
  tremor: Tremor;
  midTip: { init: boolean; x: number; y: number };
  last: HandGesture | null;
}

export interface RecognizerState {
  config: GestureConfig;
  calibration: Calibration | null;
  hands: Map<HandId, HandState>;
  presenceEma: number;
}

export function createRecognizer(
  config: Partial<GestureConfig> = {},
  calibration: Calibration | null = null,
): RecognizerState {
  return { config: { ...DEFAULT_GESTURE_CONFIG, ...config }, calibration, hands: new Map(), presenceEma: 1 };
}

function newHandState(h: TrackedHand, t: number): HandState {
  return {
    id: h.id,
    role: h.role,
    lastT: t,
    ext: new Float64Array(5),
    extVel: new Float64Array(5),
    extended: [false, false, false, false, false],
    pose: 'none',
    poseSince: t,
    candidate: null,
    candidateSince: t,
    tentative: null,
    tentativeSince: t,
    pinch: { pinching: false, since: t },
    swipe: { armed: false, peak: 0, peakVx: 0, peakVy: 0, cooldownUntil: t + 150 },
    snap: { lastPrimedAt: -Infinity, cooldownUntil: t + 150 },
    openness: new History(400),
    kin: { init: false, px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, ax: 0, ay: 0, az: 0 },
    tremor: { init: false, prevX: 0, prevY: 0, hpX: 0, hpY: 0, lpX: 0, lpY: 0, energy: 0 },
    midTip: { init: false, x: 0, y: 0 },
    last: null,
  };
}

/** A GestureEvent without the fields the recognizer fills in (distributes over the union). */
type EventBody = GestureEvent extends infer E
  ? E extends GestureEvent
    ? Omit<E, 'hand' | 'role' | 'time'>
    : never
  : never;

const onePoleCoeff = (fc: number, dt: number): number => {
  const rc = 1 / (2 * Math.PI * fc);
  return dt / (rc + dt);
};

const tmpA = vec();
const tmpB = vec();
const tmpC = vec();

function fingerRecord(s: HandState): Record<Finger, FingerState> {
  const rec = {} as Record<Finger, FingerState>;
  FINGERS.forEach((f, i) => {
    rec[f] = { extension: s.ext[i]!, extended: s.extended[i]!, velocity: s.extVel[i]! };
  });
  return rec;
}

/** Pick the committed pose with debounce + margin; returns the PoseResult for this frame. */
function updatePose(
  s: HandState,
  ranked: Array<{ pose: PoseId; score: number }>,
  presence: number,
  t: number,
  cfg: GestureConfig,
): PoseResult {
  const top = ranked[0]!;
  const runnerUp = ranked[1]?.score ?? 0;
  const topPose: PoseId = top.score >= cfg.minPoseConfidence ? top.pose : 'none';
  const currentScore = ranked.find((r) => r.pose === s.pose)?.score ?? 0;

  if (topPose === s.pose) {
    s.candidate = null;
  } else if (topPose === 'none' || top.score - currentScore >= cfg.poseMargin) {
    if (s.candidate !== topPose) {
      s.candidate = topPose;
      s.candidateSince = t;
    }
    if (t - s.candidateSince >= cfg.poseDebounceMs) {
      s.pose = topPose;
      s.poseSince = t;
      s.candidate = null;
    }
  } else {
    s.candidate = null;
  }

  const committedScore = ranked.find((r) => r.pose === s.pose)?.score ?? 0;
  const margin = s.pose === top.pose ? top.score - runnerUp : 0;
  const confidence =
    s.pose === 'none'
      ? 0
      : clamp01(committedScore * (0.6 + 0.4 * clamp01(margin / 0.3)) * Math.min(1, presence / 0.7));
  return { pose: s.pose, confidence, ranked: ranked.slice(0, 4), heldMs: t - s.poseSince, tentative: false };
}

function recognizeHand(
  st: RecognizerState,
  s: HandState,
  h: TrackedHand,
  t: number,
  aspect: number,
  events: GestureEvent[],
): HandGesture {
  const cfg = st.config;
  const cal = st.calibration;
  const dt = Math.max(1e-3, (t - s.lastT) / 1000);
  const first = s.last === null;
  s.lastT = t;
  const emit = (e: EventBody) => events.push({ ...e, hand: h.id, role: h.role, time: t } as GestureEvent);

  // Fingers: calibrated extension, velocity, hysteresis.
  const prevExt = Float64Array.from(s.ext);
  fingerExtensions(h.world, cal?.fingerExtension ?? DEFAULT_FINGER_RANGES, s.ext);
  for (let i = 0; i < 5; i++) {
    const v = first ? 0 : (s.ext[i]! - prevExt[i]!) / dt;
    s.extVel[i] = s.extVel[i]! + 0.5 * (v - s.extVel[i]!);
    if (s.extended[i] && s.ext[i]! < cfg.extendExit) s.extended[i] = false;
    else if (!s.extended[i] && s.ext[i]! > cfg.extendEnter) s.extended[i] = true;
  }
  const count = s.extended.filter(Boolean).length;

  // Continuous features.
  const orient = palmOrientation(h.world, h.handedness);
  const center = imagePalmCenter(h.landmarks, tmpA);
  const scaleNow = imageScale(h.landmarks, h.world, aspect);
  const depth = depthFromScale(scaleNow, cal?.palmSize);
  const pinch = pinchAmount(h.world, cal?.pinch);
  const openness = (s.ext[0]! + s.ext[1]! + s.ext[2]! + s.ext[3]! + s.ext[4]!) / 5;
  s.openness.push(t, openness);

  // Kinematics in frame-heights (x), y up, depth units (z).
  const k = s.kin;
  const px = center.x * aspect;
  const py = 1 - center.y;
  const pz = depth;
  if (!k.init) {
    Object.assign(k, { init: true, px, py, pz, vx: 0, vy: 0, vz: 0, ax: 0, ay: 0, az: 0 });
  } else {
    const nvx = (px - k.px) / dt;
    const nvy = (py - k.py) / dt;
    const nvz = (pz - k.pz) / dt;
    const a = 0.55;
    const svx = k.vx + a * (nvx - k.vx);
    const svy = k.vy + a * (nvy - k.vy);
    const svz = k.vz + a * (nvz - k.vz);
    const b = 0.35;
    k.ax += b * ((svx - k.vx) / dt - k.ax);
    k.ay += b * ((svy - k.vy) / dt - k.ay);
    k.az += b * ((svz - k.vz) / dt - k.az);
    Object.assign(k, { px, py, pz, vx: svx, vy: svy, vz: svz });
  }

  // Tremor: 3–12 Hz band energy of the UNFILTERED palm centre, normalized by palm size in the image.
  const rawC = imagePalmCenter(h.raw, tmpB);
  const tr = s.tremor;
  const rx = rawC.x * aspect;
  const ry = rawC.y;
  if (!tr.init) {
    Object.assign(tr, { init: true, prevX: rx, prevY: ry });
  } else {
    const rc = 1 / (2 * Math.PI * 3);
    const hpA = rc / (rc + dt);
    tr.hpX = hpA * (tr.hpX + rx - tr.prevX);
    tr.hpY = hpA * (tr.hpY + ry - tr.prevY);
    tr.prevX = rx;
    tr.prevY = ry;
    const lpA = onePoleCoeff(12, dt);
    tr.lpX += lpA * (tr.hpX - tr.lpX);
    tr.lpY += lpA * (tr.hpY - tr.lpY);
    const e = tr.lpX * tr.lpX + tr.lpY * tr.lpY;
    tr.energy += (e - tr.energy) * (1 - Math.exp(-dt / 0.4));
  }
  const imgPalm = scaleNow * palmSize(h.world) || 1e-3;
  // Scaled so typical landmark jitter reads ~0.1–0.2 and a deliberate shake saturates.
  const tremor = clamp01((Math.sqrt(tr.energy) / imgPalm) * 10);

  const features: HandFeatures = {
    palmX: center.x,
    palmY: 1 - center.y,
    depth,
    roll: orient.roll,
    pitch: orient.pitch,
    yaw: orient.yaw,
    palmFacing: orient.palmFacing,
    pinch,
    openness,
    velocity: { x: k.vx, y: k.vy, z: k.vz },
    acceleration: { x: k.ax, y: k.ay, z: k.az },
    speed: Math.hypot(k.vx, k.vy),
    tremor,
  };

  // Pose.
  const pExt = extendedProbabilities(s.ext, s.extended, cfg.extendEnter, cfg.extendExit);
  const pinchCloseness = 1 - unlerp(pinch, 0.05, 0.25);
  const ranked = scorePoses(pExt, pinchCloseness);
  const prevPose = s.pose;
  let poseResult = updatePose(s, ranked, h.presence, t, cfg);
  if (prevPose !== s.pose) {
    if (prevPose !== 'none') emit({ type: 'poseExit', pose: prevPose });
    if (s.pose !== 'none') emit({ type: 'poseEnter', pose: s.pose });
    if (s.pose === 'fist') {
      const drop = s.openness.max() - openness;
      if (drop > 0.45) emit({ type: 'fistClench', strength: clamp01(drop) });
    }
  }

  // Predictive onset: extrapolate finger extensions one frame ahead. If that (or a pose already leading
  // the debounce) confidently lands on a new pose, announce it now as a tentative poseEnter — about one
  // frame earlier than the committed one. If it doesn't come true within ~150 ms, re-assert the committed
  // pose (a tentative poseEnter with `revert`) so downstream can undo it.
  if (cfg.predictiveOnset) {
    const ahead = new Float64Array(5);
    const flags: boolean[] = [];
    for (let i = 0; i < 5; i++) {
      ahead[i] = clamp01(s.ext[i]! + s.extVel[i]! * dt);
      flags.push(s.extended[i]!);
    }
    const predicted = scorePoses(
      extendedProbabilities(ahead, flags, cfg.extendEnter, cfg.extendExit),
      pinchCloseness,
    )[0]!;
    const strong = predicted.score > cfg.minPoseConfidence + 0.15 && predicted.pose !== 'none';
    const target = s.candidate && s.candidate !== 'none' ? s.candidate : strong ? predicted.pose : null;
    if (s.tentative !== null) {
      if (s.pose === s.tentative) {
        s.tentative = null; // confirmed
      } else if (target !== s.tentative || t - s.tentativeSince > 150) {
        emit({ type: 'poseEnter', pose: s.pose, tentative: true, revert: true });
        s.tentative = null;
      }
    }
    if (s.tentative === null && target && target !== s.pose && prevPose === s.pose) {
      s.tentative = target;
      s.tentativeSince = t;
      emit({ type: 'poseEnter', pose: target, tentative: true });
    }
    if (s.tentative)
      poseResult = { ...poseResult, pose: s.tentative, confidence: predicted.score * 0.8, tentative: true };
  }

  // Discrete events.
  for (const sig of stepPinch(s.pinch, pinch, t, cfg)) {
    emit({ type: sig === 'start' ? 'pinchStart' : sig === 'end' ? 'pinchEnd' : 'pinchTap' });
  }
  const swipe = stepSwipe(s.swipe, k.vx, k.vy, t, cfg);
  if (swipe) emit({ type: 'swipe', ...swipe });

  const size = imgPalm;
  const mid = at(h.landmarks, LM.MIDDLE_TIP, tmpC);
  const relX = ((mid.x - center.x) * aspect) / size;
  const relY = (mid.y - center.y) / size;
  let midSpeed = 0;
  if (s.midTip.init) midSpeed = Math.hypot(relX - s.midTip.x, relY - s.midTip.y) / dt;
  s.midTip = { init: true, x: relX, y: relY };
  const thumbMid =
    dist(at(h.world, LM.THUMB_TIP, tmpB), at(h.world, LM.MIDDLE_TIP, tmpC)) / palmSize(h.world);
  const snap = stepSnap(s.snap, thumbMid, midSpeed, t, cfg);
  if (snap !== null) emit({ type: 'snap', peakSpeed: snap });

  const gesture: HandGesture = {
    id: h.id,
    role: h.role,
    handedness: h.handedness,
    presence: h.presence,
    coasting: false,
    fingers: fingerRecord(s),
    count,
    pinching: s.pinch.pinching,
    pose: poseResult,
    features,
  };
  s.last = gesture;
  return gesture;
}

/** Run one frame through the recognizer. Mutates `state`; returns it for reducer-style use. */
export function recognize(
  state: RecognizerState,
  frame: VisionFrame,
  recognizeEnd?: () => number,
): { state: RecognizerState; out: GestureFrame } {
  const t = frame.captureTime;
  const events: GestureEvent[] = [];
  const hands: HandGesture[] = [];
  const seen = new Set<HandId>();

  for (const h of frame.hands) {
    seen.add(h.id);
    let s = state.hands.get(h.id);
    if (!s) {
      s = newHandState(h, t);
      state.hands.set(h.id, s);
      events.push({ type: 'handFound', hand: h.id, role: h.role, time: t });
    }
    if (h.lostFrames > 0 && s.last) {
      // Coasting: hold the last gesture so music doesn't stutter through a brief dropout.
      hands.push({ ...s.last, presence: h.presence, coasting: true });
      continue;
    }
    hands.push(recognizeHand(state, s, h, t, frame.aspect, events));
  }
  for (const [id, s] of state.hands) {
    if (!seen.has(id)) {
      if (s.pose !== 'none') events.push({ type: 'poseExit', hand: id, role: s.role, pose: s.pose, time: t });
      events.push({ type: 'handLost', hand: id, role: s.role, time: t });
      state.hands.delete(id);
    }
  }

  let twoHand: GestureFrame['twoHand'] = null;
  if (hands.length === 2) {
    const [a, b] = hands as [HandGesture, HandGesture];
    const dx = (b.features.palmX - a.features.palmX) * frame.aspect;
    const dy = b.features.palmY - a.features.palmY;
    twoHand = { distance: Math.hypot(dx, dy), angle: Math.atan2(dy, dx) };
  }

  const meanPresence = hands.length ? hands.reduce((acc, h) => acc + h.presence, 0) / hands.length : 1;
  state.presenceEma += 0.1 * (meanPresence - state.presenceEma);
  const brightnessLow = frame.brightness !== undefined && frame.brightness < 0.16;
  const out: GestureFrame = {
    frameId: frame.frameId,
    time: t,
    hands,
    twoHand,
    events,
    quality: {
      meanPresence: state.presenceEma,
      lowLight: brightnessLow || (hands.length > 0 && state.presenceEma < state.config.lowLightPresence),
    },
    timing: {
      captureTime: frame.captureTime,
      detectStart: frame.detectStart,
      detectEnd: frame.detectEnd,
      recognizeEnd: recognizeEnd ? recognizeEnd() : frame.detectEnd,
    },
  };
  return { state, out };
}

export function setCalibration(state: RecognizerState, calibration: Calibration | null): void {
  state.calibration = calibration;
}

export function setGestureConfig(state: RecognizerState, config: Partial<GestureConfig>): void {
  state.config = { ...state.config, ...config };
}

/** Exposed for tests and calibration: raw world landmarks → calibrated extension values. */
export function extensionsOf(world: LandmarkArray, cal: Calibration | null = null): number[] {
  return Array.from(fingerExtensions(world, cal?.fingerExtension ?? DEFAULT_FINGER_RANGES));
}
