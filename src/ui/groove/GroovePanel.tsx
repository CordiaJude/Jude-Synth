import { ARP_MODES, ARP_RATES, type ArpMode, type ArpRate } from '../../performance/arp';
import { BASS_PATTERN_LABEL, BASS_PATTERNS, type BassPattern } from '../../performance/bass';
import { GENRES, PATTERNS, type Genre } from '../../performance/drums/patterns';
import type { Grid } from '../../performance/transport';
import { grooveControls as gc, useGroove } from '../../state/music';
import styles from '../settings/Settings.module.css';
import own from './Groove.module.css';

const GRIDS: Grid[] = ['off', '1/8', '1/16', '1/16T'];
const MODE_LABEL: Record<ArpMode, string> = {
  up: 'Up',
  down: 'Down',
  upDown: 'Up & down',
  random: 'Random',
  played: 'As played',
};

function Range({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
}) {
  return (
    <label className={own.range}>
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <output>{format(value)}</output>
    </label>
  );
}

export function GroovePanel() {
  const g = useGroove();
  return (
    <aside className={styles.panel} aria-label="Groove">
      <section className={styles.section}>
        <h3>Tempo</h3>
        <div className={own.tempo}>
          <label className={own.bpm}>
            <input
              type="number"
              min={40}
              max={220}
              value={Math.round(g.bpm)}
              onChange={(e) => Number.isFinite(e.target.valueAsNumber) && gc.setBpm(e.target.valueAsNumber)}
              aria-label="Tempo in BPM"
            />
            <span>BPM</span>
          </label>
          <button className={styles.btn} onClick={gc.tap}>
            Tap
          </button>
          <span className={own.position} aria-label="Bar and beat">
            {g.position}
          </span>
        </div>
        <label className={styles.field}>
          <span>Quantize what you trigger</span>
          <select value={g.quantize.grid} onChange={(e) => gc.setQuantize({ grid: e.target.value as Grid })}>
            {GRIDS.map((x) => (
              <option key={x} value={x}>
                {x === 'off' ? 'Off (play instantly)' : x === '1/16T' ? '1/16 triplets' : x}
              </option>
            ))}
          </select>
        </label>
        {g.quantize.grid !== 'off' && (
          <Range
            label="Strength"
            value={g.quantize.strength}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => gc.setQuantize({ strength: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        )}
        <Range
          label="Humanize"
          value={g.quantize.humanizeMs}
          min={0}
          max={30}
          step={1}
          onChange={(v) => gc.setQuantize({ humanizeMs: v })}
          format={(v) => `±${v} ms`}
        />
      </section>

      <section className={styles.section}>
        <h3>Arpeggiator</h3>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={g.arp.enabled}
            onChange={(e) => gc.setArp({ enabled: e.target.checked })}
          />{' '}
          Arpeggiate the chord
        </label>
        <div className={own.grid2}>
          <label className={styles.field}>
            <span>Pattern</span>
            <select value={g.arp.mode} onChange={(e) => gc.setArp({ mode: e.target.value as ArpMode })}>
              {ARP_MODES.map((m) => (
                <option key={m} value={m}>
                  {MODE_LABEL[m]}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Rate</span>
            <select value={g.arp.rate} onChange={(e) => gc.setArp({ rate: e.target.value as ArpRate })}>
              {ARP_RATES.map((r) => (
                <option key={r} value={r}>
                  {r === '1/16T' ? '1/16 triplets' : r}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Octaves</span>
            <select
              value={g.arp.octaves}
              onChange={(e) => gc.setArp({ octaves: Number(e.target.value) as 1 | 2 | 3 })}
            >
              {[1, 2, 3].map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Range
          label="Note length"
          value={g.arp.gate}
          min={0.08}
          max={1}
          step={0.02}
          onChange={(v) => gc.setArp({ gate: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
      </section>

      <section className={styles.section}>
        <h3>Strum</h3>
        <label className={styles.check}>
          <input type="checkbox" checked={g.strum} onChange={(e) => gc.setStrum(e.target.checked)} /> Strum
          mode (sweep the free hand across the strings, or press S)
        </label>
      </section>

      <section className={styles.section}>
        <h3>Drums &amp; bass</h3>
        <label className={styles.check}>
          <input type="checkbox" checked={g.drums} onChange={(e) => gc.setDrums(e.target.checked)} /> Drums
        </label>
        <div className={own.grid2}>
          <label className={styles.field}>
            <span>Style</span>
            <select value={g.genre} onChange={(e) => gc.setGenre(e.target.value as Genre)}>
              {GENRES.map((x) => (
                <option key={x} value={x}>
                  {PATTERNS[x].name} ({PATTERNS[x].bpm})
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Bass</span>
            <select value={g.bassPattern} onChange={(e) => gc.setBassPattern(e.target.value as BassPattern)}>
              {BASS_PATTERNS.map((p) => (
                <option key={p} value={p}>
                  {BASS_PATTERN_LABEL[p]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className={styles.row}>
          <button className={styles.btn} onClick={gc.fill} disabled={!g.drums}>
            Fill
          </button>
          <button className={styles.btn} onClick={gc.drop} disabled={!g.drums}>
            Drop
          </button>
        </div>
        <Range
          label="Sidechain duck"
          value={g.duck}
          min={0}
          max={1}
          step={0.05}
          onChange={gc.setDuck}
          format={(v) => `${Math.round(v * 100)}%`}
        />
      </section>
    </aside>
  );
}
