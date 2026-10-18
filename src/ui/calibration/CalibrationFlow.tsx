// First-run calibration: open palm (4 s) → fist (4 s) → pinch (2 s). The timer only runs while a hand is
// visible, so nobody gets rushed. Personalizes finger-extension ranges, pinch distance and depth.

import { useEffect, useRef, useState } from 'react';
import { buildCalibration, type CalibrationSample } from '../../gestures/calibration';
import { live } from '../../state/live';
import { applyCalibration, setCaptureRaw } from '../../state/session';
import { useApp } from '../../state/store';
import styles from './Calibration.module.css';

type Phase = 'intro' | 'open' | 'fist' | 'pinch' | 'done';

const STEPS: Record<'open' | 'fist' | 'pinch', { seconds: number; title: string; hint: string }> = {
  open: {
    seconds: 4,
    title: 'Show an open palm',
    hint: 'Spread your fingers wide. Both hands if you can — slowly turn them a little.',
  },
  fist: { seconds: 4, title: 'Now make a fist', hint: 'A relaxed, natural fist — the way you would play.' },
  pinch: {
    seconds: 2,
    title: 'Pinch thumb and index',
    hint: 'Touch the tips together, like holding a guitar pick.',
  },
};
const ORDER: Phase[] = ['intro', 'open', 'fist', 'pinch', 'done'];

export function CalibrationFlow() {
  const setCalibrating = useApp((s) => s.setCalibrating);
  const hadCalibration = useApp((s) => s.calibration !== null);
  const [phase, setPhase] = useState<Phase>('intro');
  const [progress, setProgress] = useState(0);
  const [handVisible, setHandVisible] = useState(false);
  const samples = useRef<Record<'open' | 'fist' | 'pinch', CalibrationSample[]>>({
    open: [],
    fist: [],
    pinch: [],
  });

  useEffect(() => {
    if (phase === 'intro' || phase === 'done') return;
    setCaptureRaw(true);
    const step = STEPS[phase];
    let elapsed = 0;
    let last = performance.now();
    const unsubscribe = live.subscribe((msg) => {
      const now = performance.now();
      const hands = (msg.overlay ?? []).filter((o) => o.raw && o.rawWorld);
      const visible = hands.length > 0;
      if (visible) {
        elapsed += Math.min(100, now - last);
        for (const o of hands)
          samples.current[phase].push({ image: o.raw!, world: o.rawWorld!, aspect: msg.aspect });
      }
      last = now;
      setHandVisible(visible);
      setProgress(Math.min(1, elapsed / (step.seconds * 1000)));
      if (elapsed >= step.seconds * 1000) {
        setProgress(0);
        setPhase(ORDER[ORDER.indexOf(phase) + 1]!);
      }
    });
    return () => unsubscribe();
  }, [phase]);

  useEffect(() => {
    if (phase !== 'done') return;
    setCaptureRaw(false);
    const { open, fist, pinch } = samples.current;
    applyCalibration(buildCalibration({ open, fist, pinch }, Date.now()));
  }, [phase]);

  useEffect(() => () => setCaptureRaw(false), []);

  const restart = () => {
    samples.current = { open: [], fist: [], pinch: [] };
    setPhase('open');
  };

  const r = 52;
  const circumference = 2 * Math.PI * r;
  const stepIndex = ['open', 'fist', 'pinch'].indexOf(phase);

  return (
    <div className={styles.overlay} role="dialog" aria-modal="false" aria-labelledby="calib-title">
      <div className={styles.card}>
        {phase === 'intro' && (
          <>
            <h2 id="calib-title">Quick calibration · 10 seconds</h2>
            <p>
              Everyone’s hands are different. Show an open palm, a fist and a pinch, and the tracker learns
              your range of motion. It’s saved on this device only.
            </p>
            <div className={styles.actions}>
              <button className={styles.primary} onClick={() => setPhase('open')} autoFocus>
                Start
              </button>
              <button className={styles.ghost} onClick={() => setCalibrating(false)}>
                {hadCalibration ? 'Cancel' : 'Skip for now'}
              </button>
            </div>
          </>
        )}
        {(phase === 'open' || phase === 'fist' || phase === 'pinch') && (
          <>
            <div className={styles.stepper} aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <span key={i} data-state={i < stepIndex ? 'done' : i === stepIndex ? 'active' : 'todo'} />
              ))}
            </div>
            <h2 id="calib-title">{STEPS[phase].title}</h2>
            <p>{STEPS[phase].hint}</p>
            <svg
              className={styles.ring}
              viewBox="0 0 120 120"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress * 100)}
              aria-label="Calibration progress"
            >
              <circle cx="60" cy="60" r={r} className={styles.track} />
              <circle
                cx="60"
                cy="60"
                r={r}
                className={styles.fill}
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - progress)}
              />
              <text x="60" y="66" textAnchor="middle" className={styles.count}>
                {Math.ceil(STEPS[phase].seconds * (1 - progress))}
              </text>
            </svg>
            <p className={styles.status} role="status">
              {handVisible ? 'Hold it…' : 'Waiting for your hand — the timer pauses until it’s in view.'}
            </p>
            <div className={styles.actions}>
              <button className={styles.ghost} onClick={() => setCalibrating(false)}>
                Cancel
              </button>
            </div>
          </>
        )}
        {phase === 'done' && (
          <>
            <h2 id="calib-title">Calibrated ✓</h2>
            <p>Your ranges are saved on this device. You can redo this any time from Settings.</p>
            <div className={styles.actions}>
              <button className={styles.primary} onClick={() => setCalibrating(false)} autoFocus>
                Start playing
              </button>
              <button className={styles.ghost} onClick={restart}>
                Redo
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
