import { useEffect, useRef } from 'react';
import { APP_NAME } from '../../config/app';
import { useLiveSnapshot } from '../../state/live';
import { useMusic } from '../../state/music';
import { startCamera, stopSession } from '../../state/session';
import { useApp } from '../../state/store';
import { CalibrationFlow } from '../calibration/CalibrationFlow';
import { DebugPanel } from '../debug/DebugPanel';
import { MappingEditor } from '../mapping/MappingEditor';
import { SettingsPanel } from '../settings/SettingsPanel';
import { useKeyboardInput } from '../useKeyboardInput';
import { useReducedMotion } from '../usePreferences';
import { attachOverlay } from './drawOverlay';
import { HandHud } from './HandHud';
import { ChordDisplay, SoundControls } from './SoundControls';
import styles from './Stage.module.css';
import { TouchPad } from './TouchPad';

function useOverlayCanvas(canvas: React.RefObject<HTMLCanvasElement | null>, enabled: boolean) {
  const reduceMotion = useReducedMotion();
  const highContrast = useApp((s) => s.palette === 'highContrast');
  useEffect(
    () =>
      canvas.current ? attachOverlay(canvas.current, enabled, { reduceMotion, highContrast }) : undefined,
    [canvas, enabled, reduceMotion, highContrast],
  );
}

function TopBar() {
  const source = useApp((s) => s.source);
  const vision = useApp((s) => s.vision);
  const panel = useApp((s) => s.panel);
  const togglePanel = useApp((s) => s.togglePanel);
  const { fps, latencyP50 } = useLiveSnapshot(4);
  const soundLatency = useMusic((s) => s.latencyP50);
  return (
    <header className={styles.topbar}>
      <span className={styles.brand}>{APP_NAME}</span>
      <span className={styles.privacyChip} title="Processing happens entirely on this device">
        ● on-device only
      </span>
      {source !== 'manual' && (
        <span className={styles.chip}>
          <strong className="tabular">{fps}</strong> fps
        </span>
      )}
      {source === 'camera' && (
        <span className={styles.chip} title="Camera capture → sound at the speaker (median)">
          <strong className="tabular">{(soundLatency || latencyP50).toFixed(0)}</strong> ms{' '}
          {soundLatency ? 'to sound' : 'tracking'}
        </span>
      )}
      {source === 'demo' && <span className={styles.chip}>demo · synthetic hands</span>}
      {source === 'manual' && <span className={styles.chip}>keyboard · touch</span>}
      {vision?.delegate && (
        <span className={styles.chip}>
          {vision.delegate} · tier {vision.tier ?? '…'}
        </span>
      )}
      <span className={styles.spacer} />
      <nav className={styles.nav} aria-label="Panels">
        <button
          className={styles.btn}
          aria-pressed={panel === 'mappings'}
          onClick={() => togglePanel('mappings')}
        >
          Mappings
        </button>
        <button
          className={styles.btn}
          aria-pressed={panel === 'settings'}
          onClick={() => togglePanel('settings')}
        >
          Settings
        </button>
        <button className={styles.btn} aria-pressed={panel === 'debug'} onClick={() => togglePanel('debug')}>
          Debug
        </button>
        <button className={styles.btn} onClick={stopSession}>
          Stop
        </button>
      </nav>
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
  const panel = useApp((s) => s.panel);
  const showOverlay = useApp((s) => s.showOverlay);
  const calibrating = useApp((s) => s.calibrating);
  const padOpen = useApp((s) => s.padOpen);

  useEffect(() => {
    if (source === 'camera' && video.current) void startCamera(video.current);
  }, [source]);
  useOverlayCanvas(canvas, showOverlay);
  useKeyboardInput(phase === 'running');

  return (
    <div className={styles.stage}>
      <main className={styles.view}>
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
            {source === 'demo' && (
              <div className={styles.demoTag}>Demo · synthetic hands cycling through poses</div>
            )}
          </>
        )}
        <canvas ref={canvas} className={styles.canvas} aria-hidden="true" />
        <TopBar />
        <SoundControls />
        <ChordDisplay />
        <LowLightBanner />
        {source === 'manual' ? (
          <>
            <p className={styles.manualHint}>
              Tap the pads, or use the keyboard: 1–7 chords · Q W E R shapes · Z … / melody.
            </p>
            <TouchPad />
          </>
        ) : (
          <>
            <HandHud />
            {padOpen && <TouchPad />}
          </>
        )}
        {source === 'camera' && phase === 'running' && calibrating && <CalibrationFlow />}
        {phase === 'starting' && (
          <div className={styles.loading} role="status">
            <div>
              <div className={styles.spinner} />
              Starting camera and hand tracking…
            </div>
          </div>
        )}
      </main>
      {panel === 'debug' && <DebugPanel />}
      {panel === 'mappings' && <MappingEditor />}
      {panel === 'settings' && <SettingsPanel />}
    </div>
  );
}
