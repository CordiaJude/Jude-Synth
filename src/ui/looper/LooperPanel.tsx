import { useState } from 'react';
import { PATCHES } from '../../audio/instruments/patches';
import type { InstrumentId } from '../../audio/instruments/types';
import type { BitDepth } from '../../export/wav';
import { MAX_TRACKS, type LoopTrack } from '../../looper/model';
import type { Grid } from '../../performance/transport';
import { exportAudio, exportMidi, looper, useLooper, type LengthMode } from '../../state/looper';
import { useMusic } from '../../state/music';
import styles from '../settings/Settings.module.css';
import own from './Looper.module.css';

const TRACK_INSTRUMENTS: InstrumentId[] = [
  'supersawPad',
  'warmPoly',
  'fmKeys',
  'pluck',
  'glassBell',
  'thereminLead',
  'subBass',
];
const LENGTHS: LengthMode[] = ['auto', 1, 2, 4, 8];
const QUANTIZE_GRIDS: Array<Exclude<Grid, 'off'>> = ['1/4', '1/8', '1/16', '1/16T', '1/32'];

function TransportSection() {
  const s = useLooper();
  const audioOn = useMusic((m) => m.status === 'on');
  const hasLoop = s.project.tracks.length > 0;
  const [confirmClear, setConfirmClear] = useState(false);
  const recLabel =
    s.rec === 'countIn'
      ? 'Cancel count-in'
      : s.rec === 'recording'
        ? hasLoop
          ? 'Stop overdub'
          : 'Close loop'
        : hasLoop
          ? 'Overdub'
          : 'Record';
  const status =
    s.rec === 'countIn'
      ? 'Count-in…'
      : s.rec === 'recording'
        ? hasLoop
          ? 'Overdubbing one pass'
          : 'Recording — press again to close the loop'
        : s.playing
          ? 'Playing'
          : hasLoop
            ? 'Stopped'
            : 'Empty — press Record and play';
  return (
    <section className={styles.section}>
      <h3>Loop</h3>
      <div className={own.transport}>
        <button
          className={`${own.rec} ${s.rec !== 'off' ? own.recOn : ''}`}
          onClick={looper.recordToggle}
          disabled={!audioOn}
          aria-pressed={s.rec !== 'off'}
          title="Record / overdub (O)"
        >
          ● {recLabel}
        </button>
        <button
          className={own.play}
          onClick={looper.playToggle}
          disabled={!audioOn || (!hasLoop && s.rec === 'off')}
          aria-pressed={s.playing}
          title="Play / stop the loop (P)"
        >
          {s.playing ? '■ Stop' : '▶ Play'}
        </button>
        <span className={own.position} aria-label="Loop position">
          {s.position || (s.project.bars ? `${s.project.bars} bar${s.project.bars > 1 ? 's' : ''}` : '—')}
        </span>
      </div>
      <p className={styles.text} role="status" aria-live="polite">
        {status}
        {s.project.bars > 0 &&
          ` · ${s.project.bars} bar${s.project.bars > 1 ? 's' : ''} at ${Math.round(s.project.bpm)} BPM`}
      </p>
      {s.message && (
        <p className={own.message} role="status">
          {s.message}
        </p>
      )}
      <div className={own.grid3}>
        <label className={styles.field}>
          <span>Count-in</span>
          <select
            value={s.countIn}
            onChange={(e) => looper.setSettings({ countIn: Number(e.target.value) as 0 | 1 | 2 })}
          >
            <option value={0}>None</option>
            <option value={1}>1 bar</option>
            <option value={2}>2 bars</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>Loop length</span>
          <select
            value={String(s.length)}
            onChange={(e) =>
              looper.setSettings({
                length: e.target.value === 'auto' ? 'auto' : (Number(e.target.value) as LengthMode),
              })
            }
            disabled={hasLoop}
          >
            {LENGTHS.map((l) => (
              <option key={l} value={String(l)}>
                {l === 'auto' ? 'Set by first take' : `${l} bar${l === 1 ? '' : 's'}`}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>Overdubs go to</span>
          <select
            value={s.overdub}
            onChange={(e) => looper.setSettings({ overdub: e.target.value as 'new' | 'merge' })}
          >
            <option value="new">New tracks</option>
            <option value="merge">Same tracks</option>
          </select>
        </label>
      </div>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={s.metronome}
          onChange={(e) => looper.setSettings({ metronome: e.target.checked })}
        />{' '}
        Click while recording
      </label>
      <div className={`${styles.row} ${own.spaced}`}>
        <button className={styles.btn} onClick={looper.undo} disabled={!s.canUndo} title="Ctrl/⌘ + Z">
          Undo
        </button>
        <button className={styles.btn} onClick={looper.redo} disabled={!s.canRedo} title="Ctrl/⌘ + Shift + Z">
          Redo
        </button>
        <button
          className={styles.btn}
          disabled={!hasLoop}
          onClick={() => {
            if (confirmClear) {
              looper.clear();
              setConfirmClear(false);
            } else setConfirmClear(true);
          }}
          onBlur={() => setConfirmClear(false)}
        >
          {confirmClear ? 'Clear everything?' : 'Clear'}
        </button>
      </div>
    </section>
  );
}

function TrackRow({ t, selected }: { t: LoopTrack; selected: boolean }) {
  return (
    <li className={`${own.track} ${selected ? own.selected : ''}`}>
      <div className={own.trackHead}>
        <button
          className={own.trackName}
          aria-pressed={selected}
          onClick={() => looper.select(t.id)}
          title="Select (for quantize and the piano roll)"
        >
          <span className={own.part} data-part={t.part} aria-hidden="true" />
          {t.name}
          <span className={own.count}>{t.notes.length}</span>
        </button>
        <button
          className={own.toggle}
          aria-pressed={t.mute}
          aria-label={`Mute ${t.name}`}
          onClick={() => looper.setMute(t.id, !t.mute)}
        >
          M
        </button>
        <button
          className={own.toggle}
          aria-pressed={t.solo}
          aria-label={`Solo ${t.name}`}
          onClick={() => looper.setSolo(t.id, !t.solo)}
        >
          S
        </button>
        <button
          className={own.toggle}
          aria-label={`Edit notes of ${t.name}`}
          onClick={() => looper.openRoll(t.id)}
        >
          ✎
        </button>
        <button className={own.toggle} aria-label={`Delete ${t.name}`} onClick={() => looper.remove(t.id)}>
          ×
        </button>
      </div>
      <div className={own.trackBody}>
        {t.part === 'drums' ? (
          <span className={own.fixed}>Drum kit</span>
        ) : (
          <select
            value={t.instrument}
            onChange={(e) => looper.setInstrument(t.id, e.target.value as InstrumentId)}
            aria-label={`Instrument for ${t.name}`}
          >
            {TRACK_INSTRUMENTS.map((id) => (
              <option key={id} value={id}>
                {PATCHES[id].name}
              </option>
            ))}
          </select>
        )}
        <input
          type="range"
          min={-24}
          max={6}
          step={0.5}
          value={t.gainDb}
          onChange={(e) => looper.setGain(t.id, Number(e.target.value))}
          aria-label={`Level of ${t.name}`}
        />
        <output className={own.db}>
          {t.gainDb > 0 ? '+' : ''}
          {t.gainDb.toFixed(1)} dB
        </output>
      </div>
    </li>
  );
}

function TracksSection() {
  const { project, selected } = useLooper();
  const [grid, setGrid] = useState<Exclude<Grid, 'off'>>('1/16');
  const [strength, setStrength] = useState(1);
  const track = project.tracks.find((t) => t.id === selected);
  return (
    <section className={styles.section}>
      <h3>
        Tracks{' '}
        <span className={own.dim}>
          {project.tracks.length} / {MAX_TRACKS}
        </span>
      </h3>
      {project.tracks.length === 0 ? (
        <p className={styles.hint}>
          Each part you play (chords, melody, bass, drums) becomes its own track, with its own instrument.
        </p>
      ) : (
        <ul className={own.tracks} aria-label="Loop tracks">
          {project.tracks.map((t) => (
            <TrackRow key={t.id} t={t} selected={t.id === selected} />
          ))}
        </ul>
      )}
      {track && (
        <div className={own.quantize}>
          <label className={styles.field}>
            <span>Quantize “{track.name}”</span>
            <select value={grid} onChange={(e) => setGrid(e.target.value as Exclude<Grid, 'off'>)}>
              {QUANTIZE_GRIDS.map((g) => (
                <option key={g} value={g}>
                  {g === '1/16T' ? '1/16 triplets' : g}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Strength {Math.round(strength * 100)}%</span>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={strength}
              onChange={(e) => setStrength(Number(e.target.value))}
              aria-label="Quantize strength"
            />
          </label>
          <button className={styles.btn} onClick={() => looper.quantize(track.id, grid, strength)}>
            Quantize
          </button>
        </div>
      )}
    </section>
  );
}

function ExportSection() {
  const { project, exporting } = useLooper();
  const [bitDepth, setBitDepth] = useState<BitDepth>(24);
  const [cycles, setCycles] = useState(1);
  const empty = project.tracks.length === 0;
  return (
    <section className={styles.section}>
      <h3>Export</h3>
      <div className={own.grid3}>
        <label className={styles.field}>
          <span>WAV format</span>
          <select value={bitDepth} onChange={(e) => setBitDepth(Number(e.target.value) as BitDepth)}>
            <option value={24}>24-bit</option>
            <option value={16}>16-bit (dithered)</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>Times through</span>
          <select value={cycles} onChange={(e) => setCycles(Number(e.target.value))}>
            {[1, 2, 4, 8].map((n) => (
              <option key={n} value={n}>
                {n}×
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={styles.row}>
        <button className={styles.btn} disabled={empty} onClick={() => void exportMidi()}>
          MIDI (.mid)
        </button>
        <button
          className={styles.btn}
          disabled={empty || !!exporting}
          onClick={() => void exportAudio({ stems: false, bitDepth, cycles })}
        >
          Mix (.wav)
        </button>
        <button
          className={styles.btn}
          disabled={empty || !!exporting}
          onClick={() => void exportAudio({ stems: true, bitDepth, cycles })}
        >
          Stems (.zip)
        </button>
      </div>
      <p className={styles.hint} role="status" aria-live="polite">
        {exporting ??
          'Audio is rendered on this device, faster than real time, through the same instruments and effects. Loops are saved in this browser only.'}
      </p>
    </section>
  );
}

export function LooperPanel() {
  return (
    <aside className={styles.panel} aria-label="Looper">
      <TransportSection />
      <TracksSection />
      <ExportSection />
    </aside>
  );
}
