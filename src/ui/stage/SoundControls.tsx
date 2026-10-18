import { CHORD_INSTRUMENTS, MELODY_INSTRUMENTS } from '../../audio/instruments/patches';
import type { InstrumentId } from '../../audio/instruments/types';
import { getPreset, useMusic } from '../../state/music';
import { allPresets, usePresets } from '../../state/presets';
import { MODE_LABEL, MODES, prefersFlats, type Mode } from '../../theory/modes';
import { pitchName, type PitchClass } from '../../theory/notes';
import styles from './Stage.module.css';

const TONICS = Array.from({ length: 12 }, (_, i) => i as PitchClass);

export function SoundControls() {
  const m = useMusic();
  const { userPresets, activeId, select } = usePresets();
  const flats = prefersFlats({ tonic: m.tonic, mode: m.mode });
  const usesMelody = m.performanceMode !== 'chords';
  const usesChords = m.performanceMode !== 'theremin';
  const statusLabel =
    m.status === 'on'
      ? m.muted
        ? 'Sound off'
        : 'Sound on'
      : m.status === 'starting'
        ? 'Starting…'
        : m.status === 'error'
          ? 'Audio error'
          : 'Sound off';
  return (
    <div className={styles.soundControls} role="group" aria-label="Sound settings">
      <select
        aria-label="Preset"
        className={styles.select}
        value={activeId}
        onChange={(e) => select(e.target.value)}
        title={getPreset().description}
      >
        {allPresets(userPresets).map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Key"
        className={styles.select}
        value={m.tonic}
        onChange={(e) => m.setKey(Number(e.target.value) as PitchClass, m.mode)}
      >
        {TONICS.map((t) => (
          <option key={t} value={t}>
            {pitchName(t, flats)}
          </option>
        ))}
      </select>
      <select
        aria-label="Mode"
        className={styles.select}
        value={m.mode}
        onChange={(e) => m.setKey(m.tonic, e.target.value as Mode)}
      >
        {MODES.map((mode) => (
          <option key={mode} value={mode}>
            {MODE_LABEL[mode]}
          </option>
        ))}
      </select>
      {usesChords && (
        <select
          aria-label="Chord instrument"
          className={styles.select}
          value={m.chordInstrument}
          onChange={(e) => m.setChordInstrument(e.target.value as InstrumentId)}
        >
          {CHORD_INSTRUMENTS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      {usesMelody && (
        <select
          aria-label="Melody instrument"
          className={styles.select}
          value={m.melodyInstrument}
          onChange={(e) => m.setMelodyInstrument(e.target.value as InstrumentId)}
        >
          {MELODY_INSTRUMENTS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      <button className={styles.btn} aria-pressed={m.bass} onClick={() => m.setBass(!m.bass)}>
        Bass
      </button>
      <button
        className={styles.btn}
        aria-pressed={!m.muted && m.status === 'on'}
        onClick={() => m.setMuted(!m.muted)}
        disabled={m.status !== 'on'}
        title={m.status === 'error' ? (m.error ?? '') : undefined}
      >
        {statusLabel}
      </button>
    </div>
  );
}

export function ChordDisplay() {
  const { chord, tonic, mode, melodyNote, latched, performanceMode } = useMusic();
  const keyName = `${pitchName(tonic, prefersFlats({ tonic, mode }))} ${MODE_LABEL[mode]}`;
  const showChord = performanceMode !== 'theremin';
  return (
    <div className={styles.chord} aria-live="polite" aria-atomic="true">
      {showChord ? (
        <>
          <div className={styles.chordName} data-empty={!chord}>
            {chord?.name ?? '—'}
          </div>
          <div className={styles.chordRoman}>{chord?.roman ?? ' '}</div>
        </>
      ) : (
        <div className={styles.chordName} data-empty={!melodyNote}>
          {melodyNote ?? '—'}
        </div>
      )}
      <div className={styles.chordKey}>
        {keyName}
        {latched && <span className={styles.latch}> · LATCHED</span>}
        {showChord && performanceMode === 'melody' && melodyNote && <span> · melody {melodyNote}</span>}
      </div>
    </div>
  );
}
