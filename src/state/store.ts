import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { DEFAULT_GESTURE_CONFIG, type GestureConfig } from '../gestures/types';
import { DEFAULT_ONE_EURO, DEFAULT_ONE_EURO_WORLD, type OneEuroParams } from '../vision/oneEuro';
import type { VisionStatus } from '../vision/visionClient';

export type SessionPhase = 'landing' | 'starting' | 'running' | 'error';
export type SessionSource = 'camera' | 'demo';

export interface TrackingSettings {
  imageFilter: OneEuroParams;
  worldFilter: OneEuroParams;
  gestures: GestureConfig;
  swapHandedness: boolean;
  preferGpu: boolean;
}

export const DEFAULT_TRACKING: TrackingSettings = {
  imageFilter: DEFAULT_ONE_EURO,
  worldFilter: DEFAULT_ONE_EURO_WORLD,
  gestures: DEFAULT_GESTURE_CONFIG,
  swapHandedness: true,
  preferGpu: true,
};

interface AppState {
  phase: SessionPhase;
  source: SessionSource | null;
  error: string | null;
  vision: VisionStatus | null;
  debugOpen: boolean;
  showOverlay: boolean;
  tracking: TrackingSettings;
  setPhase: (phase: SessionPhase, source?: SessionSource | null, error?: string | null) => void;
  setVision: (vision: VisionStatus | null) => void;
  toggleDebug: () => void;
  setShowOverlay: (v: boolean) => void;
  setTracking: (patch: Partial<TrackingSettings>) => void;
  resetTracking: () => void;
}

export const useApp = create<AppState>()(
  persist(
    (set) => ({
      phase: 'landing',
      source: null,
      error: null,
      vision: null,
      debugOpen: true,
      showOverlay: true,
      tracking: DEFAULT_TRACKING,
      setPhase: (phase, source, error = null) =>
        set((s) => ({ phase, source: source === undefined ? s.source : source, error })),
      setVision: (vision) => set({ vision }),
      toggleDebug: () => set((s) => ({ debugOpen: !s.debugOpen })),
      setShowOverlay: (showOverlay) => set({ showOverlay }),
      setTracking: (patch) => set((s) => ({ tracking: { ...s.tracking, ...patch } })),
      resetTracking: () => set({ tracking: DEFAULT_TRACKING }),
    }),
    {
      name: 'handwave.settings.v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ debugOpen: s.debugOpen, showOverlay: s.showOverlay, tracking: s.tracking }),
      // New gesture-config fields added in later versions get their defaults.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>;
        return {
          ...current,
          ...p,
          tracking: {
            ...DEFAULT_TRACKING,
            ...p.tracking,
            gestures: { ...DEFAULT_GESTURE_CONFIG, ...p.tracking?.gestures },
          },
        };
      },
    },
  ),
);
