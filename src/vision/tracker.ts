// Multi-hand tracker: gives every hand a stable ID and musical role that survive crossing, brief
// occlusion and MediaPipe's per-frame handedness flips. MediaPipe's label is one vote in the match cost,
// never the source of truth.

import { LANDMARK_FLOATS, LM, PALM_POINTS, type LandmarkArray } from './landmarks';
import { DEFAULT_ONE_EURO, DEFAULT_ONE_EURO_WORLD, OneEuroBank, type OneEuroParams } from './oneEuro';
import type { Detection, HandId, HandRole, Handedness, RoleRule, TrackedHand } from './types';

export interface TrackerConfig {
  roleRule: RoleRule;
  /** Frames a track may coast without a detection before it is dropped. */
  maxLostFrames: number;
  /** Max palm-centre jump (in frame heights) that can still match an existing track. */
  gate: number;
  /** Smoothing for image-space landmarks (position, drawing). */
  filter: OneEuroParams;
  /** Smoothing for world landmarks (finger angles, orientation). */
  worldFilter: OneEuroParams;
}

export const DEFAULT_TRACKER: TrackerConfig = {
  roleRule: 'screenSide',
  maxLostFrames: 6,
  gate: 0.45,
  filter: DEFAULT_ONE_EURO,
  worldFilter: DEFAULT_ONE_EURO_WORLD,
};

interface Track {
  id: HandId;
  role: HandRole;
  /** Running estimate of P(hand is Right), 0..1. */
  pRight: number;
  imageFilter: OneEuroBank;
  worldFilter: OneEuroBank;
  image: Float32Array;
  world: Float32Array;
  raw: Float32Array;
  rawWorld: Float32Array;
  cx: number; // palm centre, aspect-corrected (x in frame heights)
  cy: number;
  vx: number; // per ms
  vy: number;
  size: number; // palm size in frame heights
  lastT: number;
  bornT: number;
  lostFrames: number;
  presence: number;
}

interface PalmGeom {
  cx: number;
  cy: number;
  size: number;
}

function palmGeom(image: LandmarkArray, aspect: number): PalmGeom {
  let cx = 0;
  let cy = 0;
  for (const i of PALM_POINTS) {
    cx += image[i * 3]! * aspect;
    cy += image[i * 3 + 1]!;
  }
  cx /= PALM_POINTS.length;
  cy /= PALM_POINTS.length;
  const w = LM.WRIST * 3;
  const m = LM.MIDDLE_MCP * 3;
  const size = Math.hypot((image[m]! - image[w]!) * aspect, image[m + 1]! - image[w + 1]!);
  return { cx, cy, size };
}

export class HandTracker {
  private tracks: Track[] = [];
  private nextId = 1;

  constructor(public config: TrackerConfig = DEFAULT_TRACKER) {}

  setFilter(image: Partial<OneEuroParams>, world: Partial<OneEuroParams> = {}): void {
    this.config = {
      ...this.config,
      filter: { ...this.config.filter, ...image },
      worldFilter: { ...this.config.worldFilter, ...world },
    };
    for (const t of this.tracks) this.applyFilterParams(t);
  }

  reset(): void {
    this.tracks = [];
  }

  /** Feed one frame of detections; returns the tracked hands (including coasting ones). */
  update(detections: readonly Detection[], tMs: number, aspect: number): TrackedHand[] {
    const geoms = detections.map((d) => palmGeom(d.image, aspect));
    const assignment = this.assign(detections, geoms, tMs);

    const matched = new Set<Track>();
    detections.forEach((det, di) => {
      let track = assignment[di];
      if (!track) track = this.createTrack(det, geoms[di]!, tMs);
      matched.add(track);
      this.updateTrack(track, det, geoms[di]!, tMs);
    });

    // Coast or drop unmatched tracks.
    this.tracks = this.tracks.filter((t) => {
      if (matched.has(t)) return true;
      t.lostFrames++;
      t.presence *= 0.6;
      return t.lostFrames <= this.config.maxLostFrames;
    });

    return this.tracks.map((t) => ({
      id: t.id,
      role: t.role,
      handedness: (t.pRight >= 0.5 ? 'Right' : 'Left') as Handedness,
      handednessConfidence: Math.abs(t.pRight - 0.5) * 2,
      landmarks: t.image,
      world: t.world,
      raw: t.raw,
      rawWorld: t.rawWorld,
      presence: t.presence,
      ageMs: tMs - t.bornT,
      lostFrames: t.lostFrames,
    }));
  }

  /** Exhaustive min-cost assignment (≤2 hands each side, so at most 7 cases). */
  private assign(dets: readonly Detection[], geoms: PalmGeom[], tMs: number): (Track | undefined)[] {
    const n = dets.length;
    const cost = (t: Track, di: number): number => {
      const g = geoms[di]!;
      const dt = Math.min(tMs - t.lastT, 200);
      const px = t.cx + t.vx * dt;
      const py = t.cy + t.vy * dt;
      const d = Math.hypot(g.cx - px, g.cy - py);
      if (d > this.config.gate) return Infinity;
      const scaleTerm = Math.abs(Math.log((g.size || 1e-3) / (t.size || 1e-3)));
      const det = dets[di]!;
      const detRight = det.handedness === 'Right' ? det.handednessScore : 1 - det.handednessScore;
      const vote = Math.abs(t.pRight - 0.5) * 2; // only penalize when the track is confident
      const handTerm = Math.abs(detRight - t.pRight) * vote;
      // Shape: hand-centred world landmarks barely change frame to frame, but differ a lot between two
      // hands holding different poses — the strongest cue when hands overlap and labels flip.
      let shape = 0;
      for (let i = 0; i < LANDMARK_FLOATS; i++) shape += Math.abs(det.world[i]! - t.world[i]!);
      const shapeTerm = shape / LANDMARK_FLOATS / 0.01; // ~1 per cm of mean landmark difference
      return d + 0.3 * scaleTerm + 0.15 * handTerm + 0.1 * shapeTerm;
    };

    let best: (Track | undefined)[] = new Array(n).fill(undefined);
    let bestCost = Infinity;
    let bestMatches = -1;
    const current: (Track | undefined)[] = new Array(n).fill(undefined);
    const used = new Set<Track>();
    const recurse = (di: number, acc: number, matches: number): void => {
      if (di === n) {
        // Prefer more matches, then lower cost.
        if (matches > bestMatches || (matches === bestMatches && acc < bestCost)) {
          bestMatches = matches;
          bestCost = acc;
          best = current.slice();
        }
        return;
      }
      current[di] = undefined;
      recurse(di + 1, acc, matches);
      for (const t of this.tracks) {
        if (used.has(t)) continue;
        const c = cost(t, di);
        if (!Number.isFinite(c)) continue;
        used.add(t);
        current[di] = t;
        recurse(di + 1, acc + c, matches + 1);
        used.delete(t);
        current[di] = undefined;
      }
    };
    recurse(0, 0, 0);
    return best;
  }

  private createTrack(det: Detection, g: PalmGeom, tMs: number): Track {
    const t: Track = {
      id: this.nextId++,
      role: this.pickRole(det, g),
      pRight: det.handedness === 'Right' ? 0.5 + det.handednessScore * 0.3 : 0.5 - det.handednessScore * 0.3,
      imageFilter: new OneEuroBank(LANDMARK_FLOATS),
      worldFilter: new OneEuroBank(LANDMARK_FLOATS),
      image: new Float32Array(LANDMARK_FLOATS),
      world: new Float32Array(LANDMARK_FLOATS),
      raw: new Float32Array(LANDMARK_FLOATS),
      rawWorld: new Float32Array(LANDMARK_FLOATS),
      cx: g.cx,
      cy: g.cy,
      vx: 0,
      vy: 0,
      size: g.size,
      lastT: tMs,
      bornT: tMs,
      lostFrames: 0,
      presence: det.handednessScore,
    };
    this.applyFilterParams(t);
    this.tracks.push(t);
    return t;
  }

  private applyFilterParams(t: Track): void {
    t.imageFilter.params = this.config.filter;
    t.worldFilter.params = this.config.worldFilter;
  }

  private pickRole(det: Detection, g: PalmGeom): HandRole {
    const taken = new Set(this.tracks.map((t) => t.role));
    if (taken.has('primary') && !taken.has('secondary')) return 'secondary';
    if (taken.has('secondary') && !taken.has('primary')) return 'primary';
    if (taken.size === 0) {
      switch (this.config.roleRule) {
        case 'handedness':
          return det.handedness === 'Left' ? 'primary' : 'secondary';
        case 'firstSeen':
          return 'primary';
        case 'screenSide': {
          // Primary = the hand on the viewer's left (the user's left hand in the mirrored view).
          // g.cx is aspect-corrected; compare against the frame's horizontal centre.
          const x01 = det.image[LM.MIDDLE_MCP * 3]!;
          return x01 < 0.5 ? 'primary' : 'secondary';
        }
      }
    }
    // Both roles taken (a third hand) — shouldn't happen with numHands=2; reuse secondary.
    void g;
    return 'secondary';
  }

  private updateTrack(t: Track, det: Detection, g: PalmGeom, tMs: number): void {
    const dt = tMs - t.lastT;
    if (dt > 0) {
      // Smoothed constant-velocity model for prediction (also carries a track through short dropouts).
      const k = t.lostFrames === 0 ? 0.5 : 0.25;
      t.vx += k * ((g.cx - t.cx) / dt - t.vx);
      t.vy += k * ((g.cy - t.cy) / dt - t.vy);
    }
    t.cx = g.cx;
    t.cy = g.cy;
    t.size = g.size;
    t.lastT = tMs;
    t.lostFrames = 0;
    t.presence = t.presence + 0.5 * (det.handednessScore - t.presence);

    const detRight = det.handedness === 'Right' ? det.handednessScore : 1 - det.handednessScore;
    t.pRight += 0.08 * (detRight - t.pRight);

    t.raw.set(det.image);
    t.rawWorld.set(det.world);
    t.imageFilter.filter(det.image, tMs, t.image);
    t.worldFilter.filter(det.world, tMs, t.world);
  }
}
