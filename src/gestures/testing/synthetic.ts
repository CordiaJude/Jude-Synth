// Synthetic hand model: forward kinematics producing MediaPipe-style landmarks for any pose, rotation,
// position and scale. Used by unit tests (rotation-invariance grid) and the no-camera demo mode.
// Anatomy is approximate but proportioned like an adult hand.

import { LANDMARK_FLOATS, LM, type Finger } from '../../vision/landmarks';
import type { Handedness } from '../../vision/types';
import type { PoseId } from '../types';
import { add, normalize, scale, vec, type Vec3 } from '../vec';

/** Per-joint flexion in radians for long fingers: [MCP, PIP, DIP]. */
export type FingerFlex = [number, number, number];

export interface HandShape {
  index: FingerFlex;
  middle: FingerFlex;
  ring: FingerFlex;
  pinky: FingerFlex;
  /** Thumb: adduction across the palm at CMC, then MCP and IP flexion, each bending toward the given axes. */
  thumb: ThumbShape;
  /** Optional: force the thumb tip onto the index tip (pinch / OK sign). */
  pinch?: boolean;
  /** Finger splay in radians (fan-out). */
  splay?: number;
}

export const STRAIGHT: FingerFlex = [0.05, 0.06, 0.04];
export const CURLED: FingerFlex = [1.45, 1.75, 1.05];
export interface ThumbShape {
  adduct: number;
  mcp: number;
  ip: number;
  /** Direction the metacarpal swings toward when adducting (hand-local). */
  across: Vec3;
  /** Direction the MCP/IP joints flex toward (hand-local). */
  flexToward: Vec3;
}

const THUMB_OUT: ThumbShape = { adduct: -0.15, mcp: 0.1, ip: 0.08, across: vec(1, -0.6, 0.1), flexToward: vec(0.6, 0.8, 0.2) };
/** Folded across the palm toward the ring-finger base (as in "four"). */
const THUMB_TUCK: ThumbShape = { adduct: 0.6, mcp: 0.7, ip: 0.9, across: vec(1, -0.6, 0.1), flexToward: vec(0.6, 0.8, 0.2) };
/** Wrapped over the curled index/middle fingers (as in a fist). */
const THUMB_FIST: ThumbShape = { adduct: 0.6, mcp: 0.3, ip: 0.9, across: vec(1, 0.2, 0.1), flexToward: vec(0.6, 0.8, 0.2) };

const f = (on: boolean): FingerFlex => (on ? STRAIGHT : CURLED);

/** Canonical finger states for each pose: [thumb, index, middle, ring, pinky]. */
export const POSE_FINGERS: Record<Exclude<PoseId, 'none' | 'pinch'>, [boolean, boolean, boolean, boolean, boolean]> = {
  fist: [false, false, false, false, false],
  one: [false, true, false, false, false],
  two: [false, true, true, false, false],
  three: [false, true, true, true, false],
  four: [false, true, true, true, true],
  open: [true, true, true, true, true],
  indexPinky: [false, true, false, false, true],
  thumbIndexPinky: [true, true, false, false, true],
  thumbOnly: [true, false, false, false, false],
};

export function shapeFor(pose: Exclude<PoseId, 'none'>): HandShape {
  if (pose === 'pinch') {
    return {
      index: [0.55, 0.75, 0.45],
      middle: STRAIGHT,
      ring: STRAIGHT,
      pinky: STRAIGHT,
      thumb: { ...THUMB_OUT, adduct: 0.35, mcp: 0.3, ip: 0.2 },
      pinch: true,
      splay: 0.08,
    };
  }
  const [t, i, m, r, p] = POSE_FINGERS[pose];
  return {
    thumb: t ? THUMB_OUT : i || m ? THUMB_TUCK : THUMB_FIST,
    index: f(i),
    middle: f(m),
    ring: f(r),
    pinky: f(p),
    splay: 0.1,
  };
}

/**
 * Anatomical variation: real people never hold a "straight" finger perfectly straight or a fist perfectly
 * tight. Jitters every joint by up to ±amount radians (straight joints only bend further, never backwards).
 */
export function varyShape(shape: HandShape, rng: () => number, amount = 0.25): HandShape {
  const j = (v: number) => Math.max(0, v + (rng() * 2 - 1) * amount);
  const jf = (ff: FingerFlex): FingerFlex => [j(ff[0]), j(ff[1]), j(ff[2])];
  return {
    ...shape,
    index: jf(shape.index),
    middle: jf(shape.middle),
    ring: jf(shape.ring),
    pinky: jf(shape.pinky),
    thumb: { ...shape.thumb, adduct: shape.thumb.adduct + (rng() * 2 - 1) * amount * 0.6, mcp: j(shape.thumb.mcp), ip: j(shape.thumb.ip) },
    splay: (shape.splay ?? 0.1) + (rng() * 2 - 1) * 0.08,
  };
}

// Hand-local frame for a RIGHT hand, palm toward the camera, fingers up, in display (mirrored) coordinates:
// x → viewer's right, y ↓, z away from the camera. Units are palm sizes (wrist → middle MCP = 1).
const MCP: Record<Exclude<Finger, 'thumb'>, Vec3> = {
  index: vec(-0.3, -0.93, 0),
  middle: vec(-0.02, -1.0, 0),
  ring: vec(0.2, -0.93, 0.01),
  pinky: vec(0.38, -0.8, 0.02),
};
const BONES: Record<Finger, [number, number, number]> = {
  thumb: [0.4, 0.33, 0.27],
  index: [0.44, 0.26, 0.2],
  middle: [0.48, 0.3, 0.21],
  ring: [0.45, 0.28, 0.2],
  pinky: [0.35, 0.21, 0.18],
};
const BASE_IDX: Record<Finger, number> = {
  thumb: LM.THUMB_CMC,
  index: LM.INDEX_MCP,
  middle: LM.MIDDLE_MCP,
  ring: LM.RING_MCP,
  pinky: LM.PINKY_MCP,
};
const PALM_NORMAL = vec(0, 0, -1); // palm faces the camera
const THUMB_CMC = vec(-0.22, -0.22, -0.06);

function rotateToward(dir: Vec3, toward: Vec3, angle: number): Vec3 {
  return normalize(add(scale(dir, Math.cos(angle)), scale(toward, Math.sin(angle))));
}

/** Build hand-local landmarks (palm-size units, right hand). */
export function buildLocalHand(shape: HandShape): Float64Array {
  const out = new Float64Array(LANDMARK_FLOATS);
  const put = (i: number, p: Vec3) => {
    out[i * 3] = p.x;
    out[i * 3 + 1] = p.y;
    out[i * 3 + 2] = p.z;
  };
  put(LM.WRIST, vec(0, 0, 0));

  const splay = shape.splay ?? 0.1;
  const fanOrigin = vec(0.02, 0.35, 0);
  (['index', 'middle', 'ring', 'pinky'] as const).forEach((finger, k) => {
    const mcp = MCP[finger];
    put(BASE_IDX[finger], mcp);
    // Base direction fans out from a point below the wrist, plus splay.
    let dir = normalize(vec(mcp.x - fanOrigin.x, mcp.y - fanOrigin.y, 0));
    const spread = (k - 1.3) * splay;
    dir = normalize(vec(dir.x * Math.cos(spread) - dir.y * Math.sin(spread), dir.x * Math.sin(spread) + dir.y * Math.cos(spread), 0));
    // Curl axis: flexion rotates the finger from `dir` toward the palm normal (toward the camera).
    const flex = shape[finger];
    let p = mcp;
    let phi = 0;
    for (let j = 0; j < 3; j++) {
      phi += flex[j]!;
      const d = add(scale(dir, Math.cos(phi)), scale(PALM_NORMAL, Math.sin(phi)));
      p = add(p, scale(d, BONES[finger][j]!));
      put(BASE_IDX[finger] + j + 1, p);
    }
  });

  // Thumb: base direction up-left and slightly forward; adduction swings it across the palm.
  put(LM.THUMB_CMC, THUMB_CMC);
  const thumbOut = normalize(vec(-0.75, -0.62, -0.25));
  const { adduct, mcp, ip } = shape.thumb;
  const acrossPalm = normalize(shape.thumb.across);
  const flexToward = normalize(shape.thumb.flexToward);
  let tdir = rotateToward(thumbOut, acrossPalm, adduct);
  let tp = add(THUMB_CMC, scale(tdir, BONES.thumb[0]));
  put(LM.THUMB_MCP, tp);
  tdir = rotateToward(tdir, flexToward, mcp);
  tp = add(tp, scale(tdir, BONES.thumb[1]));
  put(LM.THUMB_IP, tp);
  tdir = rotateToward(tdir, flexToward, ip);
  tp = add(tp, scale(tdir, BONES.thumb[2]));
  put(LM.THUMB_TIP, tp);

  if (shape.pinch) {
    // Pull the thumb chain so the tip meets the index tip.
    const tip = vec(out[LM.INDEX_TIP * 3]!, out[LM.INDEX_TIP * 3 + 1]!, out[LM.INDEX_TIP * 3 + 2]! - 0.03);
    const mcpP = vec(out[LM.THUMB_MCP * 3]!, out[LM.THUMB_MCP * 3 + 1]!, out[LM.THUMB_MCP * 3 + 2]!);
    put(LM.THUMB_TIP, tip);
    put(LM.THUMB_IP, vec((tip.x + mcpP.x) / 2, (tip.y + mcpP.y) / 2 - 0.04, (tip.z + mcpP.z) / 2 - 0.05));
  }
  return out;
}

export interface Placement {
  handedness: Handedness;
  /** Euler rotation in radians applied in hand space: roll (about z), pitch (about x), yaw (about y). */
  roll: number;
  pitch: number;
  yaw: number;
  /** Palm centre in the image, 0..1 (display/mirrored coords). */
  cx: number;
  cy: number;
  /** Palm size in frame heights. */
  imageScale: number;
  aspect: number;
  /** Real palm size in metres. */
  palmMeters?: number;
}

export interface NoiseSpec {
  image: number; // σ in normalized image units
  world: number; // σ in metres
}

function rotate(p: Vec3, roll: number, pitch: number, yaw: number): Vec3 {
  // yaw (y) then pitch (x) then roll (z) — so roll is the final in-image tilt.
  let { x, y, z } = p;
  let c = Math.cos(yaw);
  let s = Math.sin(yaw);
  [x, z] = [c * x + s * z, -s * x + c * z];
  c = Math.cos(pitch);
  s = Math.sin(pitch);
  // Positive pitch tips the fingers (−y) toward the camera (−z).
  [y, z] = [c * y - s * z, s * y + c * z];
  c = Math.cos(roll);
  s = Math.sin(roll);
  // Positive roll tilts the fingers toward +x (clockwise on screen).
  [x, y] = [c * x - s * y, s * x + c * y];
  return vec(x, y, z);
}

/** Box–Muller Gaussian from a uniform RNG. */
export function gaussian(rng: () => number): number {
  const u = Math.max(rng(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Place a hand-local shape in the scene and produce MediaPipe-like image + world landmarks.
 * World: metres, centred on the hand. Image: weak-perspective projection, normalized 0..1.
 */
export function placeHand(
  local: Float64Array,
  pl: Placement,
  noise: NoiseSpec = { image: 0, world: 0 },
  rng: () => number = Math.random,
): { image: Float32Array; world: Float32Array } {
  const meters = pl.palmMeters ?? 0.085;
  const image = new Float32Array(LANDMARK_FLOATS);
  const world = new Float32Array(LANDMARK_FLOATS);
  const mirror = pl.handedness === 'Left' ? -1 : 1;
  const pts: Vec3[] = [];
  for (let i = 0; i < 21; i++) {
    const p = vec(local[i * 3]! * mirror, local[i * 3 + 1]!, local[i * 3 + 2]!);
    pts.push(rotate(p, pl.roll, pl.pitch, pl.yaw));
  }
  // Centre on the palm centroid.
  const c = vec();
  for (const i of [0, 5, 9, 13, 17]) {
    c.x += pts[i]!.x / 5;
    c.y += pts[i]!.y / 5;
    c.z += pts[i]!.z / 5;
  }
  pts.forEach((p, i) => {
    const x = p.x - c.x;
    const y = p.y - c.y;
    const z = p.z - c.z;
    world[i * 3] = x * meters + gaussian(rng) * noise.world;
    world[i * 3 + 1] = y * meters + gaussian(rng) * noise.world;
    world[i * 3 + 2] = z * meters + gaussian(rng) * noise.world * 1.5;
    image[i * 3] = pl.cx + (x * pl.imageScale) / pl.aspect + gaussian(rng) * noise.image;
    image[i * 3 + 1] = pl.cy + y * pl.imageScale + gaussian(rng) * noise.image;
    image[i * 3 + 2] = z * pl.imageScale + gaussian(rng) * noise.image;
  });
  return { image, world };
}

/** Convenience: one synthetic detection for a pose. `variation` > 0 applies varyShape (needs rng). */
export function syntheticHand(
  pose: Exclude<PoseId, 'none'>,
  pl: Partial<Placement> = {},
  noise?: NoiseSpec,
  rng?: () => number,
  variation = 0,
): { image: Float32Array; world: Float32Array } {
  const shape = variation > 0 && rng ? varyShape(shapeFor(pose), rng, variation) : shapeFor(pose);
  return placeHand(
    buildLocalHand(shape),
    { handedness: 'Right', roll: 0, pitch: 0, yaw: 0, cx: 0.5, cy: 0.5, imageScale: 0.25, aspect: 16 / 9, ...pl },
    noise,
    rng,
  );
}
