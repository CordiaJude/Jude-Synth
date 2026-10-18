import { CHORD_INSTRUMENTS } from '../../audio/instruments/patches';
import type { InstrumentId } from '../../audio/instruments/types';
import { useMusic } from '../../state/music';
import { MODE_LABEL, MODES, prefersFlats, type Mode } from '../../theory/modes';
import { pitchName, type PitchClass } from '../../theory/notes';
import styles from './Stage.module.css';

const TONICS = Array.from({ length: 12 }, (_, i) => i as PitchClass);

export function SoundControls() {
  const { status, muted, tonic, mode, instrument, bass, setKey, setInstrument, setBass, setMuted } =
    useMusic();
  const flats = prefersFlats({ tonic, mode });
  return (
    <div className={styles.soundControls} role="group" aria-label="Sound settings">
      <button
        className={styles.btn}
        aria-pressed={!muted && status === 'on'}
        onClick={() => setMuted(!muted)}
        disabled={status !== 'on'}
        title={status === 'error' ? (useMusic.getState().error ?? '') : undefined}
      >
        {status === 'on'
          ? muted
            ? 'Sound off'
            : 'Sound on'
          : status === 'starting'
            ? 'Starting…'
            : status === 'error'
              ? 'Audio error'
              : 'Sound off'}
      </button>
      <label className={styles.selectWrap}>
        <span className="sr-only">Key</span>
        <select
          className={styles.select}
          value={tonic}
          onChange={(e) => setKey(Number(e.target.value) as PitchClass, mode)}
        >
          {TONICS.map((t) => (
            <option key={t} value={t}>
              {pitchName(t, flats)}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.selectWrap}>
        <span className="sr-only">Mode</span>
        <select
          className={styles.select}
          value={mode}
          onChange={(e) => setKey(tonic, e.target.value as Mode)}
        >
          {MODES.map((m) => (
            <option key={m} value={m}>
              {MODE_LABEL[m]}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.selectWrap}>
        <span className="sr-only">Instrument</span>
        <select
          className={styles.select}
          value={instrument}
          onChange={(e) => setInstrument(e.target.value as InstrumentId)}
        >
          {CHORD_INSTRUMENTS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <button className={styles.btn} aria-pressed={bass} onClick={() => setBass(!bass)}>
        Bass
      </button>
    </div>
  );
}

export function ChordDisplay() {
  const chord = useMusic((s) => s.chord);
  const tonic = useMusic((s) => s.tonic);
  const mode = useMusic((s) => s.mode);
  const keyName = `${pitchName(tonic, prefersFlats({ tonic, mode }))} ${MODE_LABEL[mode]}`;
  return (
    <div className={styles.chord} aria-live="polite" aria-atomic="true">
      <div className={styles.chordName} data-empty={!chord}>
        {chord?.name ?? '—'}
      </div>
      <div className={styles.chordRoman}>{chord?.roman ?? ' '}</div>
      <div className={styles.chordKey}>{keyName}</div>
    </div>
  );
}
