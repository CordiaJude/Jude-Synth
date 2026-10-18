// Touch / mouse fallback: degree pads, chord shapes, and a melody strip. Same Actions as the hands.

import { useRef, useState } from 'react';
import { useLooper } from '../../state/looper';
import { conductorSnapshot, perform, useGroove, useMusic } from '../../state/music';
import { diatonicChords, type Degree, type Extension } from '../../theory/chords';
import type { ChordQuality } from '../../theory/chords';
import styles from './TouchPad.module.css';

const SHAPES: Array<{ label: string; extension: Extension; quality: ChordQuality | 'diatonic' }> = [
  { label: 'Triad', extension: 'triad', quality: 'diatonic' },
  { label: '7th', extension: 'seventh', quality: 'diatonic' },
  { label: '9th', extension: 'ninth', quality: 'diatonic' },
  { label: 'sus4', extension: 'triad', quality: 'sus4' },
];

export function TouchPad() {
  const { tonic, mode, chord, latched, performanceMode } = useMusic();
  const [borrow, setBorrow] = useState(false);
  const [shape, setShape] = useState(0);
  const strip = useRef<HTMLDivElement>(null);
  const [stripY, setStripY] = useState<number | null>(null);
  const chords = diatonicChords({ tonic, mode });
  const current = conductorSnapshot().degree;
  const groove = useGroove();
  const loopRec = useLooper((s) => s.rec);
  const loopPlaying = useLooper((s) => s.playing);
  const hasLoop = useLooper((s) => s.project.tracks.length > 0);

  const play = (degree: Degree) =>
    perform(
      [
        { type: 'chord.parallel', value: borrow },
        { type: 'chord.degree', degree },
      ],
      [],
    );
  const stripValue = (e: React.PointerEvent) => {
    const r = strip.current!.getBoundingClientRect();
    const v = 1 - Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    setStripY(1 - v);
    return v;
  };

  return (
    <div className={styles.pad} role="group" aria-label="Touch controls">
      {performanceMode !== 'theremin' && (
        <div className={styles.chords}>
          <div className={styles.degrees}>
            {chords.map((c, i) => {
              const degree = (i + 1) as Degree;
              return (
                <button
                  key={degree}
                  className={styles.degree}
                  aria-pressed={current === degree && !!chord}
                  aria-label={`Chord ${c.roman} (${c.name})`}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    play(degree);
                  }}
                  onKeyDown={(e) =>
                    (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), play(degree))
                  }
                >
                  <span className={styles.roman}>{c.roman}</span>
                  <span className={styles.name}>{c.name}</span>
                </button>
              );
            })}
          </div>
          <div className={styles.row}>
            {SHAPES.map((sh, i) => (
              <button
                key={sh.label}
                className={styles.small}
                aria-pressed={shape === i}
                onClick={() => {
                  setShape(i);
                  perform([{ type: 'chord.shape', extension: sh.extension, quality: sh.quality }], []);
                }}
              >
                {sh.label}
              </button>
            ))}
            <button
              className={styles.small}
              aria-pressed={borrow}
              onClick={() => setBorrow(!borrow)}
              title="Borrow chords from the parallel mode"
            >
              Borrow
            </button>
            <button
              className={styles.small}
              aria-pressed={latched}
              onClick={() => perform([{ type: 'latch.toggle' }], [])}
            >
              Latch
            </button>
            <button className={styles.small} onClick={() => perform([{ type: 'chord.release' }], [])}>
              Release
            </button>
          </div>
          <div className={styles.row} role="group" aria-label="Groove">
            <button
              className={styles.small}
              aria-pressed={groove.arp.enabled}
              onClick={() => perform([{ type: 'arp.toggle' }], [])}
            >
              Arp
            </button>
            <button
              className={styles.small}
              onClick={() => perform([{ type: 'strum.strum', direction: 'down' }], [])}
            >
              Strum ↓
            </button>
            <button
              className={styles.small}
              aria-pressed={groove.drums}
              onClick={() => perform([{ type: 'drums.toggle' }], [])}
            >
              Drums
            </button>
            <button
              className={styles.small}
              onClick={() => perform([{ type: 'drums.fill' }], [])}
              disabled={!groove.drums}
            >
              Fill
            </button>
            <button
              className={styles.small}
              onClick={() => perform([{ type: 'drums.nextGenre' }], [])}
              disabled={!groove.drums}
            >
              Style
            </button>
          </div>
          <div className={styles.row} role="group" aria-label="Looper">
            <button
              className={styles.small}
              aria-pressed={loopRec !== 'off'}
              onClick={() => perform([{ type: 'looper.recordToggle' }], [])}
            >
              {loopRec === 'off' ? '● Rec' : loopRec === 'countIn' ? '● Count-in…' : '● Recording'}
            </button>
            <button
              className={styles.small}
              aria-pressed={loopPlaying}
              disabled={!hasLoop && loopRec === 'off'}
              onClick={() => perform([{ type: 'looper.playToggle' }], [])}
            >
              {loopPlaying ? '■ Stop loop' : '▶ Play loop'}
            </button>
          </div>
        </div>
      )}
      {performanceMode !== 'chords' && (
        <div
          ref={strip}
          className={styles.strip}
          role="slider"
          aria-label="Melody strip: press and slide to play"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={stripY === null ? 0 : Math.round((1 - stripY) * 100)}
          tabIndex={0}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            perform(
              [{ type: 'melody.gate', on: true }],
              [{ target: 'melody.pitch', value: stripValue(e), rampMs: 20, mappingId: 'touch' }],
            );
          }}
          onPointerMove={(e) => {
            if (stripY === null) return;
            perform([], [{ target: 'melody.pitch', value: stripValue(e), rampMs: 20, mappingId: 'touch' }]);
          }}
          onPointerUp={() => {
            setStripY(null);
            perform([{ type: 'melody.gate', on: false }], []);
          }}
          onPointerCancel={() => {
            setStripY(null);
            perform([{ type: 'melody.gate', on: false }], []);
          }}
        >
          <span className={styles.stripLabel}>melody</span>
          {stripY !== null && <div className={styles.stripThumb} style={{ top: `${stripY * 100}%` }} />}
        </div>
      )}
    </div>
  );
}
