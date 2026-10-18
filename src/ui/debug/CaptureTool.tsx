import { useEffect, useRef, useState } from 'react';
import { APP_NAME } from '../../config/app';
import { CaptureRecorder, type CaptureLabel } from '../../vision/capture';
import { live } from '../../state/live';
import { getStream, setCaptureRaw } from '../../state/session';
import type { HandRole } from '../../vision/types';
import { POSE_LABEL } from '../labels';
import styles from './Debug.module.css';

const KEYS: Array<[string, CaptureLabel]> = [
  ['0', 'fist'],
  ['1', 'one'],
  ['2', 'two'],
  ['3', 'three'],
  ['4', 'four'],
  ['5', 'open'],
  ['6', 'indexPinky'],
  ['7', 'thumbIndexPinky'],
  ['8', 'thumbOnly'],
  ['9', 'pinch'],
  ['t', 'transition'],
];

const labelName = (l: CaptureLabel) => (l === 'transition' ? 'Transition (ignored)' : POSE_LABEL[l]);

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * Records unfiltered landmarks plus a live pose label (set with number keys) for the accuracy corpus, and
 * optionally the camera video so the same session can drive the Playwright fake-camera e2e test.
 * Files are saved to your computer only.
 */
export function CaptureTool() {
  const [recording, setRecording] = useState(false);
  const [label, setLabel] = useState<CaptureLabel>('transition');
  const [role, setRole] = useState<HandRole | 'both'>('primary');
  const [withVideo, setWithVideo] = useState(true);
  const [stats, setStats] = useState({ frames: 0, agree: 0, judged: 0 });
  // Counted per frame in a ref; React only sees a 4 Hz snapshot (hot path stays out of React).
  const counts = useRef({ frames: 0, agree: 0, judged: 0 });
  const recorder = useRef(new CaptureRecorder());
  const media = useRef<{ rec: MediaRecorder; chunks: Blob[] } | null>(null);
  const aspect = useRef(16 / 9);

  useEffect(() => {
    recorder.current.label = label;
  }, [label]);
  useEffect(() => {
    recorder.current.labelRole = role;
  }, [role]);

  useEffect(() => {
    if (!recording) return;
    const unsubscribe = live.subscribe((msg) => {
      if (!msg.overlay) return;
      aspect.current = msg.aspect;
      const hands = msg.overlay.flatMap((o) => {
        const g = msg.frame.hands.find((h) => h.id === o.id);
        return o.raw && o.rawWorld && g && !g.coasting
          ? [
              {
                role: o.role,
                handedness: o.handedness,
                presence: g.presence,
                raw: o.raw,
                rawWorld: o.rawWorld,
              },
            ]
          : [];
      });
      recorder.current.add(msg.frame.timing.captureTime, hands);
      const cur = recorder.current.label;
      const c = counts.current;
      c.frames = recorder.current.length;
      if (cur !== 'transition') {
        for (const h of msg.frame.hands) {
          if (role !== 'both' && h.role !== role) continue;
          c.judged++;
          if (h.pose.pose === cur) c.agree++;
        }
      }
    });
    const tick = setInterval(() => setStats({ ...counts.current }), 250);
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const hit = KEYS.find(([k]) => k === e.key.toLowerCase());
      if (hit) {
        e.preventDefault();
        setLabel(hit[1]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      unsubscribe();
      clearInterval(tick);
      window.removeEventListener('keydown', onKey);
    };
  }, [recording, role]);

  const start = () => {
    setCaptureRaw(true);
    recorder.current.start(performance.timeOrigin + performance.now());
    counts.current = { frames: 0, agree: 0, judged: 0 };
    setStats({ ...counts.current });
    setLabel('transition');
    const stream = getStream();
    if (withVideo && stream && typeof MediaRecorder !== 'undefined') {
      const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find(
        (m) => MediaRecorder.isTypeSupported(m),
      );
      const rec = new MediaRecorder(
        stream,
        mimeType ? { mimeType, videoBitsPerSecond: 6_000_000 } : undefined,
      );
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.start(1000);
      media.current = { rec, chunks };
    }
    setRecording(true);
  };

  const stop = () => {
    setRecording(false);
    setCaptureRaw(false);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const base = `${APP_NAME.toLowerCase()}-capture-${stamp}`;
    const m = media.current;
    media.current = null;
    const ext = m?.rec.mimeType.includes('mp4') ? 'mp4' : 'webm';
    const file = recorder.current.finish({
      aspect: aspect.current,
      frameRate: getStream()?.getVideoTracks()[0]?.getSettings().frameRate ?? 30,
      video: m ? `${base}.${ext}` : undefined,
    });
    download(new Blob([JSON.stringify(file)], { type: 'application/json' }), `${base}.json`);
    if (m) {
      m.rec.onstop = () => download(new Blob(m.chunks, { type: m.rec.mimeType }), `${base}.${ext}`);
      m.rec.stop();
    }
  };

  const agreement = stats.judged ? Math.round((stats.agree / stats.judged) * 100) : null;

  return (
    <section className={styles.section} aria-label="Capture and label">
      <h3>Capture &amp; label</h3>
      <div className={styles.row}>
        <select
          className={styles.select}
          value={role}
          onChange={(e) => setRole(e.target.value as HandRole | 'both')}
          disabled={recording}
          aria-label="Hand being labeled"
        >
          <option value="primary">label primary hand</option>
          <option value="secondary">label secondary hand</option>
          <option value="both">label both hands</option>
        </select>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={withVideo}
            disabled={recording}
            onChange={(e) => setWithVideo(e.target.checked)}
          />{' '}
          video
        </label>
        <button className={styles.recordBtn} aria-pressed={recording} onClick={recording ? stop : start}>
          {recording ? 'Stop & save' : 'Record'}
        </button>
      </div>
      {recording && (
        <>
          <div className={styles.labelNow} aria-live="polite">
            {labelName(label)}
          </div>
          <div
            className="tabular"
            style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text-dim)' }}
          >
            {stats.frames} frames{agreement !== null ? ` · recognizer agrees ${agreement}%` : ''}
          </div>
        </>
      )}
      <div className={styles.keys}>
        {KEYS.map(([k, l]) => (
          <button
            key={k}
            aria-pressed={recording && label === l}
            onClick={() => setLabel(l)}
            disabled={!recording}
          >
            {k} · {labelName(l)}
          </button>
        ))}
      </div>
      <p className={styles.hint}>
        Hold a pose, press its key, then vary rotation and tilt. Press <b>t</b> while changing poses. Files
        are saved to your computer only — add the .json to <code>tests/fixtures/landmarks/</code>.
      </p>
    </section>
  );
}
