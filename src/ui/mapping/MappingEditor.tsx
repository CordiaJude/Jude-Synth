// Mapping editor: see what every gesture does, tune it live, learn sources by moving, and save your own
// presets (stored on this device; export/import as JSON).

import { useEffect, useRef, useState } from 'react';
import {
  ACTION_CHOICES,
  actionLabel,
  isAngleSource,
  POSE_CHOICES,
  SOURCES,
  TARGET_LABEL,
  TARGETS,
} from '../../mapping/catalog';
import { applyCurve, CURVE_PRESETS } from '../../mapping/curves';
import { mapValue, readSource } from '../../mapping/evaluate';
import type {
  ContinuousMapping,
  Curve,
  DiscreteMapping,
  FeatureSource,
  MappingPreset,
  MappingTarget,
  Trigger,
} from '../../mapping/types';
import { live } from '../../state/live';
import { getPreset } from '../../state/music';
import { allPresets, usePresets } from '../../state/presets';
import { POSE_LABEL } from '../labels';
import { learnSource } from './learn';
import styles from './MappingEditor.module.css';

const DEG = 180 / Math.PI;
const uid = () => Math.random().toString(36).slice(2, 9);

function useTick(hz: number) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set((x) => x + 1), 1000 / hz);
    return () => clearInterval(id);
  }, [hz]);
}

function CurvePreview({ curve, invert, marker }: { curve: Curve; invert: boolean; marker: number | null }) {
  const pts = Array.from({ length: 33 }, (_, i) => {
    const x = i / 32;
    let y = applyCurve(x, curve);
    if (invert) y = 1 - y;
    return `${(x * 96 + 2).toFixed(1)},${(46 - y * 44).toFixed(1)}`;
  }).join(' ');
  let my = 0;
  if (marker !== null) {
    my = applyCurve(marker, curve);
    if (invert) my = 1 - my;
  }
  return (
    <svg className={styles.curve} viewBox="0 0 100 48" aria-hidden="true">
      <rect x="2" y="2" width="96" height="44" className={styles.curveBg} />
      <polyline points={pts} className={styles.curveLine} />
      {marker !== null && <circle cx={marker * 96 + 2} cy={46 - my * 44} r="3" className={styles.curveDot} />}
    </svg>
  );
}

function NumberField({
  label,
  value,
  onChange,
  step = 0.01,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <label className={styles.num}>
      <span>{label}</span>
      <input
        type="number"
        step={step}
        value={Number(value.toFixed(3))}
        onChange={(e) => Number.isFinite(e.target.valueAsNumber) && onChange(e.target.valueAsNumber)}
      />
    </label>
  );
}

function ContinuousCard({
  m,
  onChange,
  onRemove,
}: {
  m: ContinuousMapping;
  onChange: (m: ContinuousMapping) => void;
  onRemove: () => void;
}) {
  const [learning, setLearning] = useState(false);
  const frame = live.latest?.frame;
  const v = frame ? readSource(frame, m.source) : null;
  const mapped = v === null ? null : mapValue(m, v);
  const angle = isAngleSource(m.source);
  const k = angle ? DEG : 1;
  const curveIndex = CURVE_PRESETS.findIndex((c) => JSON.stringify(c.curve) === JSON.stringify(m.curve));

  const learn = async () => {
    setLearning(true);
    const r = await learnSource();
    setLearning(false);
    if (r) onChange({ ...m, source: r.source, inRange: r.range });
  };

  return (
    <article className={styles.card} aria-label={m.label ?? m.id}>
      <header className={styles.cardHead}>
        <input
          className={styles.title}
          value={m.label ?? ''}
          placeholder="Unnamed mapping"
          onChange={(e) => onChange({ ...m, label: e.target.value })}
          aria-label="Mapping name"
        />
        <button className={styles.icon} onClick={onRemove} aria-label={`Remove ${m.label ?? 'mapping'}`}>
          ×
        </button>
      </header>
      <div className={styles.meterRow} aria-hidden="true">
        <div className={styles.meter}>
          <div style={{ width: `${(mapped?.input ?? 0) * 100}%` }} data-active={mapped !== null} />
        </div>
        <span className={styles.meterValue}>
          {mapped === null ? 'not in view' : mapped.output.toFixed(2)}
        </span>
      </div>
      <div className={styles.grid}>
        <label className={styles.field}>
          <span>From</span>
          <div className={styles.inline}>
            <select
              value={m.source}
              onChange={(e) => onChange({ ...m, source: e.target.value as FeatureSource })}
            >
              {SOURCES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <button className={styles.small} onClick={learn} disabled={learning || !frame} aria-live="polite">
              {learning ? 'Move now…' : 'Learn'}
            </button>
          </div>
        </label>
        <label className={styles.field}>
          <span>To</span>
          <select
            value={m.target}
            onChange={(e) => onChange({ ...m, target: e.target.value as MappingTarget })}
          >
            {TARGETS.map((t) => (
              <option key={t} value={t}>
                {TARGET_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.pair}>
          <NumberField
            label={`in min${angle ? ' °' : ''}`}
            value={m.inRange[0] * k}
            step={angle ? 1 : 0.01}
            onChange={(x) => onChange({ ...m, inRange: [x / k, m.inRange[1]] })}
          />
          <NumberField
            label={`in max${angle ? ' °' : ''}`}
            value={m.inRange[1] * k}
            step={angle ? 1 : 0.01}
            onChange={(x) => onChange({ ...m, inRange: [m.inRange[0], x / k] })}
          />
          <NumberField
            label="out min"
            value={m.outRange[0]}
            onChange={(x) => onChange({ ...m, outRange: [x, m.outRange[1]] })}
          />
          <NumberField
            label="out max"
            value={m.outRange[1]}
            onChange={(x) => onChange({ ...m, outRange: [m.outRange[0], x] })}
          />
        </div>
        <div className={styles.curveRow}>
          <CurvePreview curve={m.curve} invert={m.invert} marker={mapped?.input ?? null} />
          <div className={styles.curveControls}>
            <select
              aria-label="Response curve"
              value={curveIndex >= 0 ? curveIndex : 'custom'}
              onChange={(e) =>
                e.target.value !== 'custom' &&
                onChange({ ...m, curve: CURVE_PRESETS[Number(e.target.value)]!.curve })
              }
            >
              {CURVE_PRESETS.map((c, i) => (
                <option key={c.label} value={i}>
                  {c.label}
                </option>
              ))}
              {curveIndex < 0 && <option value="custom">Custom</option>}
            </select>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={m.invert}
                onChange={(e) => onChange({ ...m, invert: e.target.checked })}
              />{' '}
              Invert
            </label>
            <NumberField
              label="deadzone"
              value={m.deadzone ?? 0}
              onChange={(x) => onChange({ ...m, deadzone: Math.max(0, Math.min(0.45, x)) })}
            />
          </div>
        </div>
      </div>
    </article>
  );
}

function triggerLabel(t: Trigger): string {
  const hand = t.kind !== 'threshold' ? `${t.role === 'primary' ? 'Primary' : 'Secondary'} hand` : '';
  if (t.kind === 'pose') return `${hand}: ${POSE_LABEL[t.pose]}`;
  if (t.kind === 'event') return `${hand}: ${t.event}${t.direction ? ` ${t.direction}` : ''}`;
  const src = SOURCES.find((s) => s.value === t.source)?.label ?? t.source;
  const k = isAngleSource(t.source) ? DEG : 1;
  const unit = isAngleSource(t.source) ? '°' : '';
  return t.above !== undefined
    ? `${src} above ${(t.above * k).toFixed(0)}${unit}`
    : `${src} below ${((t.below ?? 0) * k).toFixed(0)}${unit}`;
}

function AddTrigger({ onAdd }: { onAdd: (d: DiscreteMapping) => void }) {
  const [role, setRole] = useState<'primary' | 'secondary'>('primary');
  const [kind, setKind] = useState<
    'pose' | 'pinchTap' | 'fistClench' | 'swipe-left' | 'swipe-right' | 'swipe-up' | 'swipe-down' | 'snap'
  >('pose');
  const [pose, setPose] = useState(POSE_CHOICES[0]!);
  const [action, setAction] = useState(0);
  const add = () => {
    let trigger: Trigger;
    if (kind === 'pose') trigger = { kind: 'pose', role, pose };
    else if (kind.startsWith('swipe-'))
      trigger = { kind: 'event', role, event: 'swipe', direction: kind.slice(6) as 'left' };
    else trigger = { kind: 'event', role, event: kind as 'pinchTap' };
    onAdd({ id: uid(), trigger, action: ACTION_CHOICES[action]!.action });
  };
  return (
    <div className={styles.addTrigger}>
      <select aria-label="Hand" value={role} onChange={(e) => setRole(e.target.value as 'primary')}>
        <option value="primary">Primary hand</option>
        <option value="secondary">Secondary hand</option>
      </select>
      <select aria-label="Gesture" value={kind} onChange={(e) => setKind(e.target.value as 'pose')}>
        <option value="pose">holds a pose…</option>
        <option value="pinchTap">pinch tap</option>
        <option value="fistClench">fist clench</option>
        <option value="snap">finger snap</option>
        <option value="swipe-left">swipe left</option>
        <option value="swipe-right">swipe right</option>
        <option value="swipe-up">swipe up</option>
        <option value="swipe-down">swipe down</option>
      </select>
      {kind === 'pose' && (
        <select aria-label="Pose" value={pose} onChange={(e) => setPose(e.target.value as typeof pose)}>
          {POSE_CHOICES.map((p) => (
            <option key={p} value={p}>
              {POSE_LABEL[p]}
            </option>
          ))}
        </select>
      )}
      <select aria-label="Action" value={action} onChange={(e) => setAction(Number(e.target.value))}>
        {ACTION_CHOICES.map((c, i) => (
          <option key={c.label} value={i}>
            {c.label}
          </option>
        ))}
      </select>
      <button className={styles.small} onClick={add}>
        Add
      </button>
    </div>
  );
}

export function MappingEditor() {
  useTick(8);
  const { userPresets, activeId, select, save, duplicate, remove, importJson } = usePresets();
  const preset = getPreset();
  const fileInput = useRef<HTMLInputElement>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);

  const update = (fn: (p: MappingPreset) => MappingPreset) => save(fn(structuredClone(preset)));

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ ...preset, builtIn: false }, null, 2)], {
      type: 'application/json',
    });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: `${preset.name.replace(/[^\w-]+/g, '-').toLowerCase()}.handwave.json`,
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  const onImport = async (file: File) => {
    const r = importJson(await file.text());
    setImportErrors(r.ok ? [] : r.errors);
  };

  return (
    <aside className={styles.panel} aria-label="Mapping editor">
      <section className={styles.section}>
        <h3>Preset</h3>
        <select
          className={styles.presetSelect}
          value={activeId}
          onChange={(e) => select(e.target.value)}
          aria-label="Preset"
        >
          {allPresets(userPresets).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.builtIn ? '' : ' (yours)'}
            </option>
          ))}
        </select>
        <p className={styles.desc}>{preset.description}</p>
        <dl className={styles.roles}>
          <dt>Primary</dt>
          <dd>{preset.roles.primary}</dd>
          <dt>Secondary</dt>
          <dd>{preset.roles.secondary}</dd>
        </dl>
        {preset.builtIn && (
          <p className={styles.hint}>Built-in preset: your first edit saves a copy you can keep.</p>
        )}
        {!preset.builtIn && (
          <label className={styles.field}>
            <span>Name</span>
            <input
              value={preset.name}
              onChange={(e) => update((p) => ({ ...p, name: e.target.value || 'Untitled' }))}
            />
          </label>
        )}
        <div className={styles.buttons}>
          <button className={styles.small} onClick={() => duplicate(preset.id)}>
            Duplicate
          </button>
          <button className={styles.small} onClick={exportJson}>
            Export
          </button>
          <button className={styles.small} onClick={() => fileInput.current?.click()}>
            Import…
          </button>
          {!preset.builtIn && (
            <button className={styles.small} data-danger onClick={() => remove(preset.id)}>
              Delete
            </button>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImport(f);
              e.target.value = '';
            }}
          />
        </div>
        {importErrors.length > 0 && (
          <div className={styles.errors} role="alert">
            <strong>That file isn’t a valid preset:</strong>
            <ul>
              {importErrors.slice(0, 6).map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className={styles.section}>
        <h3>Continuous controls</h3>
        {preset.continuous.map((m, i) => (
          <ContinuousCard
            key={m.id}
            m={m}
            onChange={(next) =>
              update((p) => ({ ...p, continuous: p.continuous.map((x, j) => (j === i ? next : x)) }))
            }
            onRemove={() => update((p) => ({ ...p, continuous: p.continuous.filter((_, j) => j !== i) }))}
          />
        ))}
        <button
          className={styles.add}
          onClick={() =>
            update((p) => ({
              ...p,
              continuous: [
                ...p.continuous,
                {
                  id: uid(),
                  label: 'New control',
                  source: 'secondary.palmY',
                  target: 'macro.motion',
                  inRange: [0.2, 0.8],
                  outRange: [0, 1],
                  curve: { kind: 'linear' },
                  invert: false,
                },
              ],
            }))
          }
        >
          + Add continuous control
        </button>
      </section>

      <section className={styles.section}>
        <h3>Gesture triggers</h3>
        <ul className={styles.triggers}>
          {preset.discrete.map((d, i) => (
            <li key={d.id}>
              <span className={styles.trig}>{triggerLabel(d.trigger)}</span>
              <span className={styles.arrow} aria-hidden="true">
                →
              </span>
              <span>
                {actionLabel(d.action)}
                {d.onExit ? ` (then ${actionLabel(d.onExit).toLowerCase()})` : ''}
              </span>
              <button
                className={styles.icon}
                aria-label={`Remove trigger ${triggerLabel(d.trigger)}`}
                onClick={() => update((p) => ({ ...p, discrete: p.discrete.filter((_, j) => j !== i) }))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <AddTrigger onAdd={(d) => update((p) => ({ ...p, discrete: [...p.discrete, d] }))} />
      </section>
    </aside>
  );
}
