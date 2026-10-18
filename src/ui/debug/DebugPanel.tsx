import type { HandGesture } from '../../gestures/types';
import { useLiveSnapshot } from '../../state/live';
import { DEFAULT_TRACKING, useApp } from '../../state/store';
import { FINGERS } from '../../vision/landmarks';
import { POSE_LABEL } from '../labels';
import { CaptureTool } from './CaptureTool';
import styles from './Debug.module.css';
import { Slider, Toggle } from './Slider';

const ms = (v: number) => `${v.toFixed(1)} ms`;
const deg = (r: number) => `${((r * 180) / Math.PI).toFixed(0)}°`;

function Pipeline() {
  const vision = useApp((s) => s.vision);
  const source = useApp((s) => s.source);
  const { latencyP50, latencyP95, fps, latest } = useLiveSnapshot(4);
  const w = vision?.worker;
  const mainOk = (vision?.mainHandlerP99 ?? 0) < 8;
  return (
    <section className={styles.section}>
      <h3>Pipeline</h3>
      <dl className={styles.grid}>
        <dt>source</dt>
        <dd>{source}</dd>
        {vision && (
          <>
            <dt>delegate / tier</dt>
            <dd>
              {vision.delegate ?? '…'} / {vision.tier ?? '…'}
            </dd>
            <dt>capture time</dt>
            <dd>{latest?.captureTimeSource ?? '…'}</dd>
          </>
        )}
        <dt>gesture fps</dt>
        <dd>{fps}</dd>
        {w && (
          <>
            <dt>detect p50 / p95</dt>
            <dd>
              {ms(w.detectMsP50)} / {ms(w.detectMsP95)}
            </dd>
            <dt>frames dropped</dt>
            <dd>{w.dropped}</dd>
          </>
        )}
        <dt>capture→gesture p50</dt>
        <dd>{ms(latencyP50)}</dd>
        <dt>capture→gesture p95</dt>
        <dd>{ms(latencyP95)}</dd>
        {vision && (
          <>
            <dt>main handler p99</dt>
            <dd className={mainOk ? styles.good : styles.bad}>{ms(vision.mainHandlerP99)}</dd>
            <dt>long tasks (&gt;50 ms)</dt>
            <dd>
              {vision.longTasks}
              {vision.longTasks ? ` (max ${vision.longTaskMaxMs.toFixed(0)} ms)` : ''}
            </dd>
          </>
        )}
      </dl>
    </section>
  );
}

function HandDetail({ hand }: { hand: HandGesture }) {
  const { extendEnter, extendExit } = useApp((s) => s.tracking.gestures);
  const color = hand.role === 'primary' ? 'var(--primary)' : 'var(--secondary)';
  const f = hand.features;
  return (
    <div className={styles.hand}>
      <div className={styles.handHead}>
        <span style={{ color }}>
          #{hand.id} {hand.role} · {hand.handedness}
        </span>
        <span>
          {POSE_LABEL[hand.pose.pose]} {(hand.pose.confidence * 100).toFixed(0)}%
        </span>
      </div>
      {FINGERS.map((name) => {
        const fs = hand.fingers[name];
        return (
          <div className={styles.finger} key={name}>
            <span>{name}</span>
            <div className={styles.bar}>
              <div
                className={styles.barFill}
                style={{
                  width: `${fs.extension * 100}%`,
                  background: fs.extended ? color : 'rgba(255,255,255,0.25)',
                }}
              />
              <div className={styles.threshold} style={{ left: `${extendExit * 100}%` }} />
              <div className={styles.threshold} style={{ left: `${extendEnter * 100}%` }} />
            </div>
            <span className="tabular">{fs.extension.toFixed(2)}</span>
          </div>
        );
      })}
      <div className={styles.ranked}>
        {hand.pose.ranked.map((r) => `${r.pose} ${r.score.toFixed(2)}`).join(' · ')}
      </div>
      <dl className={styles.grid} style={{ marginTop: 8 }}>
        <dt>palm x / y</dt>
        <dd>
          {f.palmX.toFixed(2)} / {f.palmY.toFixed(2)}
        </dd>
        <dt>depth</dt>
        <dd>{f.depth.toFixed(2)}</dd>
        <dt>roll / pitch / yaw</dt>
        <dd>
          {deg(f.roll)} / {deg(f.pitch)} / {deg(f.yaw)}
        </dd>
        <dt>palm facing</dt>
        <dd>{f.palmFacing.toFixed(2)}</dd>
        <dt>pinch / openness</dt>
        <dd>
          {f.pinch.toFixed(2)} / {f.openness.toFixed(2)}
        </dd>
        <dt>speed</dt>
        <dd>{f.speed.toFixed(2)} fh/s</dd>
        <dt>tremor</dt>
        <dd>{f.tremor.toFixed(2)}</dd>
      </dl>
    </div>
  );
}

function Hands() {
  const { latest } = useLiveSnapshot(12);
  const hands = latest?.frame.hands ?? [];
  const two = latest?.frame.twoHand;
  return (
    <section className={styles.section}>
      <h3>Hands {two && <span>apart {two.distance.toFixed(2)} fh</span>}</h3>
      {hands.length === 0 && <p className={styles.hint}>No hands in view.</p>}
      {[...hands]
        .sort((a, b) => (a.role < b.role ? -1 : 1))
        .map((h) => (
          <HandDetail key={h.id} hand={h} />
        ))}
    </section>
  );
}

function Events() {
  const { events } = useLiveSnapshot(6);
  return (
    <section className={styles.section}>
      <h3>Events</h3>
      <ul className={styles.events} aria-live="off">
        {[...events].reverse().map(({ event, receivedAt }, i) => (
          <li key={`${receivedAt}-${i}`}>
            {event.role.padEnd(9)} {event.type}
            {'pose' in event ? ` ${event.pose}` : ''}
            {'direction' in event ? ` ${event.direction}` : ''}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Tuning() {
  const tracking = useApp((s) => s.tracking);
  const setTracking = useApp((s) => s.setTracking);
  const reset = useApp((s) => s.resetTracking);
  const showOverlay = useApp((s) => s.showOverlay);
  const setShowOverlay = useApp((s) => s.setShowOverlay);
  const g = tracking.gestures;
  const setG = (patch: Partial<typeof g>) => setTracking({ gestures: { ...g, ...patch } });
  return (
    <section className={styles.section}>
      <h3>
        Tuning
        <button className={styles.smallBtn} onClick={reset} disabled={tracking === DEFAULT_TRACKING}>
          reset
        </button>
      </h3>
      <Slider
        label="position min cutoff (Hz)"
        min={0.1}
        max={6}
        step={0.1}
        value={tracking.imageFilter.minCutoff}
        onChange={(v) => setTracking({ imageFilter: { ...tracking.imageFilter, minCutoff: v } })}
        format={(v) => v.toFixed(1)}
      />
      <Slider
        label="position beta"
        min={0}
        max={20}
        step={0.5}
        value={tracking.imageFilter.beta}
        onChange={(v) => setTracking({ imageFilter: { ...tracking.imageFilter, beta: v } })}
        format={(v) => v.toFixed(1)}
      />
      <Slider
        label="finger min cutoff (Hz)"
        min={0.1}
        max={8}
        step={0.1}
        value={tracking.worldFilter.minCutoff}
        onChange={(v) => setTracking({ worldFilter: { ...tracking.worldFilter, minCutoff: v } })}
        format={(v) => v.toFixed(1)}
      />
      <Slider
        label="finger beta"
        min={0}
        max={60}
        step={1}
        value={tracking.worldFilter.beta}
        onChange={(v) => setTracking({ worldFilter: { ...tracking.worldFilter, beta: v } })}
        format={(v) => v.toFixed(0)}
      />
      <Slider
        label="extend enter"
        min={0.3}
        max={0.9}
        step={0.01}
        value={g.extendEnter}
        onChange={(v) => setG({ extendEnter: Math.max(v, g.extendExit + 0.02) })}
      />
      <Slider
        label="extend exit"
        min={0.1}
        max={0.8}
        step={0.01}
        value={g.extendExit}
        onChange={(v) => setG({ extendExit: Math.min(v, g.extendEnter - 0.02) })}
      />
      <Slider
        label="pose debounce"
        min={0}
        max={200}
        step={5}
        value={g.poseDebounceMs}
        onChange={(v) => setG({ poseDebounceMs: v })}
        format={(v) => `${v} ms`}
      />
      <Slider
        label="min confidence"
        min={0.1}
        max={0.9}
        step={0.01}
        value={g.minPoseConfidence}
        onChange={(v) => setG({ minPoseConfidence: v })}
      />
      <Toggle
        label="predictive onset (tentative poses)"
        checked={g.predictiveOnset}
        onChange={(v) => setG({ predictiveOnset: v })}
      />
      <Toggle
        label="swap handedness labels"
        checked={tracking.swapHandedness}
        onChange={(v) => setTracking({ swapHandedness: v })}
      />
      <Toggle
        label="prefer GPU (applies on next start)"
        checked={tracking.preferGpu}
        onChange={(v) => setTracking({ preferGpu: v })}
      />
      <Toggle label="show skeleton overlay" checked={showOverlay} onChange={setShowOverlay} />
    </section>
  );
}

export function DebugPanel() {
  const source = useApp((s) => s.source);
  return (
    <aside className={styles.panel} aria-label="Debug panel">
      <Pipeline />
      <Hands />
      <Events />
      <Tuning />
      {source === 'camera' && <CaptureTool />}
    </aside>
  );
}
