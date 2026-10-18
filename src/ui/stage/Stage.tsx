import { useEffect, useRef } from 'react';
import { APP_NAME } from '../../config/app';
import { useLiveSnapshot } from '../../state/live';
import { startCamera, stopSession } from '../../state/session';
import { useApp } from '../../state/store';
import { DebugPanel } from '../debug/DebugPanel';
import { attachOverlay } from './drawOverlay';
import { HandHud } from './HandHud';
import styles from './Stage.module.css';

function useOverlayCanvas(canvas: React.RefObject<HTMLCanvasElement | null>, enabled: boolean) {
  useEffect(() => (canvas.current ? attachOverlay(canvas.current, enabled) : undefined), [canvas, enabled]);
}

function TopBar() {
  const source = useApp((s) => s.source);
  const vision = useApp((s) => s.vision);
  const debugOpen = useApp((s) => s.debugOpen);
  const toggleDebug = useApp((s) => s.toggleDebug);
  const { fps, latencyP50 } = useLiveSnapshot(4);
  return (
    <header className={styles.topbar}>
      <span className={styles.brand}>{APP_NAME}</span>
      <span className={styles.privacyChip} title="Processing happens entirely on this device">
        ● on-device only
      </span>
      <span className={styles.chip}>
        <strong className="tabular">{fps}</strong> fps
      </span>
      {source === 'camera' && (
        <span className={styles.chip} title="Camera capture → gesture recognized (main thread)">
          <strong className="tabular">{latencyP50.toFixed(0)}</strong> ms tracking
        </span>
      )}
      {source === 'demo' && <span className={styles.chip}>demo · synthetic hands</span>}
      {vision?.delegate && (
        <span className={styles.chip}>
          {vision.delegate} · tier {vision.tier ?? '…'}
        </span>
      )}
      <span className={styles.spacer} />
      <button className={styles.btn} aria-pressed={debugOpen} onClick={toggleDebug}>
        Debug
      </button>
      <button className={styles.btn} onClick={stopSession}>
        Stop
      </button>
    </header>
  );
}

function LowLightBanner() {
  const { latest } = useLiveSnapshot(2);
  if (!latest?.frame.quality.lowLight) return null;
  return (
    <div className={styles.banner} role="status">
      Low light — tracking may be unreliable. Try facing a lamp or window.
    </div>
  );
}

export function Stage() {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const source = useApp((s) => s.source);
  const phase = useApp((s) => s.phase);
  const debugOpen = useApp((s) => s.debugOpen);
  const showOverlay = useApp((s) => s.showOverlay);

  useEffect(() => {
    if (source === 'camera' && video.current) void startCamera(video.current);
  }, [source]);
  useOverlayCanvas(canvas, showOverlay);

  return (
    <div className={styles.stage}>
      <div className={styles.view}>
        {source === 'camera' ? (
          <video
            ref={video}
            className={styles.video}
            muted
            playsInline
            autoPlay
            aria-label="Mirrored camera preview"
          />
        ) : (
          <>
            <div className={styles.demoBg} />
            <div className={styles.demoTag}>Demo · synthetic hands cycling through poses</div>
          </>
        )}
        <canvas ref={canvas} className={styles.canvas} aria-hidden="true" />
        <TopBar />
        <LowLightBanner />
        <HandHud />
        {phase === 'starting' && (
          <div className={styles.loading} role="status">
            <div>
              <div className={styles.spinner} />
              Starting camera and hand tracking…
            </div>
          </div>
        )}
      </div>
      {debugOpen && <DebugPanel />}
    </div>
  );
}
