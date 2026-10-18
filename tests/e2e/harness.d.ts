// Shape of the audio test harness exposed on window by src/audio/testing/harness.ts (kept minimal here so
// the e2e project doesn't compile app code).
interface HarnessScenarioResult {
  name: string;
  detector: 'sine' | 'transient' | 'levels';
  threshold?: number;
  clicks: number;
  firstClicks: Array<{ time: number; ratio: number }>;
  worstRatio: number;
  peakDb: number;
  nonFinite: number;
  renderMs: number;
}

interface Window {
  handwaveHarness: {
    runClickSuite(): Promise<HarnessScenarioResult[]>;
    runPositiveControl(): Promise<{ sine: number; transient: number }>;
    runBrokenVoiceControl(): Promise<HarnessScenarioResult>;
    runLoopEquivalence(
      only?: string,
      fx?: boolean,
      selfTest?: boolean,
    ): Promise<{
      seconds: number;
      tracks: string[];
      liveEvents: number;
      maxDiff: number;
      residualDb: number;
      peakDb: number;
      rmsDb: number;
      nonFinite: number;
    }>;
    loopRenderWav(): Promise<number[]>;
  };
}
