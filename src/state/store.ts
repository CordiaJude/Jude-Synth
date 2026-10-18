import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { DEFAULT_GESTURE_CONFIG, type Calibration, type GestureConfig } from '../gestures/types';
import { DEFAULT_ONE_EURO, DEFAULT_ONE_EURO_WORLD, type OneEuroParams } from '../vision/oneEuro';
import type { VisionStatus } from '../vision/visionClient';

export type SessionPhase = 'landing' | 'starting' | 'running' | 'error';
export type SessionSource = InputMode;

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

export type MotionPref = 'system' | 'reduce' | 'full';
export type SidePanel = 'none' | 'debug' | 'mappings' | 'settings' | 'groove' | 'looper';
export type Palette = 'default' | 'highContrast';
/** How the user plays: hands (camera), synthetic demo hands, or keyboard/touch only. */
export type InputMode = 'camera' | 'demo' | 'manual';

interface AppState {
  phase: SessionPhase;
  calibration: Calibration | null;
  /** Show the calibration step on the next camera start. */
  calibrating: boolean;
  motion: MotionPref;
  palette: Palette;
  setCalibration: (c: Calibration | null) => void;
  setCalibrating: (v: boolean) => void;
  setMotion: (m: MotionPref) => void;
  setPalette: (p: Palette) => void;
  source: SessionSource | null;
  error: string | null;
  vision: VisionStatus | null;
  /** Which side panel is open. */
  panel: SidePanel;
  showOverlay: boolean;
  tracking: TrackingSettings;
  setPhase: (phase: SessionPhase, source?: SessionSource | null, error?: string | null) => void;
  setVision: (vision: VisionStatus | null) => void;
  togglePanel: (p: Exclude<SidePanel, 'none'>) => void;
  /** Show the on-screen touch pad over the camera view. */
  padOpen: boolean;
  setPadOpen: (v: boolean) => void;
  setShowOverlay: (v: boolean) => void;
  setTracking: (patch: Partial<TrackingSettings>) => void;
  resetTracking: () => void;
}

export const useApp = create<AppState>()(
  persist(
    (set) => ({
      phase: 'landing',
      calibration: null,
      calibrating: false,
      motion: 'system',
      palette: 'default',
      setCalibration: (calibration) => set({ calibration }),
      setCalibrating: (calibrating) => set({ calibrating }),
      setMotion: (motion) => set({ motion }),
      setPalette: (palette) => set({ palette }),
      source: null,
      error: null,
      vision: null,
      panel: 'none',
      padOpen: false,
      setPadOpen: (padOpen) => set({ padOpen }),
      showOverlay: true,
      tracking: DEFAULT_TRACKING,
      setPhase: (phase, source, error = null) =>
        set((s) => ({ phase, source: source === undefined ? s.source : source, error })),
      setVision: (vision) => set({ vision }),
      togglePanel: (p) => set((s) => ({ panel: s.panel === p ? 'none' : p })),
      setShowOverlay: (showOverlay) => set({ showOverlay }),
      setTracking: (patch) => set((s) => ({ tracking: { ...s.tracking, ...patch } })),
      resetTracking: () => set({ tracking: DEFAULT_TRACKING }),
    }),
    {
      name: 'handwave.settings.v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        showOverlay: s.showOverlay,
        tracking: s.tracking,
        calibration: s.calibration,
        motion: s.motion,
        palette: s.palette,
      }),
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
