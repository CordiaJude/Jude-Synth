// Piano roll for one loop track. Drag a note to move it (snapped), drag its right edge to change its length,
// double-click to add one. Fully keyboard-operable: [ ] select, arrows move, Shift+arrows resize / octave,
// Delete removes. Every drag or key press is one undo step.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { DrumVoice } from '../../events/types';
import { noteSegments } from '../../export/midiFile';
import * as edit from '../../looper/edit';
import {
  DRUM_NOTE,
  drumVoiceOf,
  loopTicks,
  PPQ,
  wrapTick,
  type LoopProject,
  type LoopTrack,
  type NoteEvent,
} from '../../looper/model';
import type { Grid } from '../../performance/transport';
import { looper, useLooper } from '../../state/looper';
import { noteName } from '../../theory/notes';
import styles from './PianoRoll.module.css';

const DRUM_ROWS: DrumVoice[] = ['crash', 'openHat', 'hat', 'tom', 'clap', 'snare', 'rim', 'kick'];
const DRUM_LABEL: Record<DrumVoice, string> = {
  crash: 'Crash',
  openHat: 'Open hat',
  hat: 'Hat',
  tom: 'Tom',
  clap: 'Clap',
  snare: 'Snare',
  rim: 'Rim',
  kick: 'Kick',
};
const SNAPS: Array<Exclude<Grid, 'off'>> = ['1/4', '1/8', '1/16', '1/16T', '1/32'];
const LABEL_W = 56;
const HEIGHT = 210;
const EDGE_PX = 7;

type Drag = {
  mode: 'move' | 'resize';
  base: LoopProject;
  indices: number[];
  x0: number;
  y0: number;
  moved: boolean;
  last: LoopProject | null;
};

function rowsFor(track: LoopTrack): number[] {
  if (track.part === 'drums') return DRUM_ROWS.map((v) => DRUM_NOTE[v]);
  const notes = track.notes.map((n) => Math.round(n.note));
  let lo = notes.length ? Math.min(...notes) - 3 : 55;
  let hi = notes.length ? Math.max(...notes) + 3 : 79;
  while (hi - lo < 24) {
    hi++;
    if (hi - lo < 24) lo--;
  }
  lo = Math.max(0, lo);
  hi = Math.min(127, hi);
  return Array.from({ length: hi - lo + 1 }, (_, i) => hi - i);
}

function describe(n: NoteEvent, track: LoopTrack): string {
  const beat = n.tick / PPQ;
  const where = `bar ${Math.floor(beat / 4) + 1} beat ${((Math.floor(beat) % 4) + 1).toString()}${beat % 1 ? ` +${Math.round((beat % 1) * PPQ)} ticks` : ''}`;
  const what =
    track.part === 'drums' ? DRUM_LABEL[drumVoiceOf(n.note) ?? 'kick'] : noteName(Math.round(n.note));
  return `${what}, ${where}, ${(n.duration / PPQ).toFixed(2)} beats, velocity ${Math.round(n.velocity * 100)}%`;
}

function Playhead({ width }: { width: number }) {
  const phase = useLooper((s) => s.phase);
  const playing = useLooper((s) => s.playing);
  if (!playing) return null;
  return (
    <div className={styles.playhead} style={{ transform: `translateX(${LABEL_W + phase * width}px)` }} />
  );
}

export function PianoRoll() {
  const open = useLooper((s) => s.rollOpen);
  const project = useLooper((s) => s.project);
  const selectedId = useLooper((s) => s.selected);
  const track = project.tracks.find((t) => t.id === selectedId);
  if (!open) return null;
  return (
    <section className={styles.drawer} aria-label="Piano roll">
      {track && project.bars > 0 ? (
        <Roll key={track.id} track={track} project={project} />
      ) : (
        <div className={styles.header}>
          <span>No track to edit yet — record something first.</span>
          <button className={styles.btn} onClick={() => looper.openRoll(null, false)}>
            Close
          </button>
        </div>
      )}
    </section>
  );
}

function Roll({ track, project }: { track: LoopTrack; project: LoopProject }) {
  const L = loopTicks(project);
  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(600);
  const [snap, setSnap] = useState<Exclude<Grid, 'off'>>('1/16');
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const drag = useRef<Drag | null>(null);
  const velBase = useRef<LoopProject | null>(null);
  const g = edit.gridTicks(snap);
  const drums = track.part === 'drums';
  const rows = useMemo(() => rowsFor(track), [track]);
  const rowH = Math.max(7, HEIGHT / rows.length);
  const height = rowH * rows.length;
  const x = (tick: number) => (tick / L) * width;
  const rowOf = (note: number) => rows.indexOf(Math.round(note));
  const selectedIdx = track.notes.flatMap((n, i) => (selection.has(edit.noteKey(n)) ? [i] : []));
  const first = selectedIdx.length ? track.notes[selectedIdx[0]!] : undefined;

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(200, el.clientWidth - LABEL_W)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** Move notes by (ticks, rows); returns the new project and the moved notes' new keys. */
  function moved(base: LoopProject, indices: number[], dTick: number, dRow: number) {
    const t = base.tracks.find((x) => x.id === track.id)!;
    const target = (n: NoteEvent): NoteEvent => {
      const tick = wrapTick(n.tick + dTick, L);
      if (drums) {
        const r = Math.max(0, Math.min(rows.length - 1, rowOf(n.note) + dRow));
        return { ...n, tick, note: rows[r]! };
      }
      return { ...n, tick, note: Math.max(0, Math.min(127, n.note - dRow)) };
    };
    const keys = new Set(indices.map((i) => edit.noteKey(target(t.notes[i]!))));
    const next = drums
      ? edit.mapNotes(base, track.id, indices, target)
      : edit.moveNotes(base, track.id, indices, dTick, -dRow);
    return { next, keys };
  }

  function apply(fn: (p: LoopProject) => { next: LoopProject; keys?: Set<string> }) {
    const r = fn(looper.snapshot());
    looper.edit(() => r.next);
    if (r.keys) setSelection(r.keys);
  }

  const point = (e: { clientX: number; clientY: number }) => {
    const r = svg.current!.getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top };
  };

  const onNoteDown = (e: React.PointerEvent, i: number, segX: number, segW: number) => {
    e.stopPropagation();
    (e.currentTarget as Element).closest('svg')?.setPointerCapture(e.pointerId);
    const n = track.notes[i]!;
    const key = edit.noteKey(n);
    let indices: number[];
    if (e.shiftKey) {
      const next = new Set(selection);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      setSelection(next);
      indices = track.notes.flatMap((m, j) => (next.has(edit.noteKey(m)) ? [j] : []));
    } else if (selection.has(key)) {
      indices = selectedIdx;
    } else {
      setSelection(new Set([key]));
      indices = [i];
    }
    const { px, py } = point(e);
    const resize = px > segX + segW - EDGE_PX && segW > EDGE_PX * 2;
    drag.current = {
      mode: resize ? 'resize' : 'move',
      base: looper.snapshot(),
      indices,
      x0: px,
      y0: py,
      moved: false,
      last: null,
    };
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const { px, py } = point(e);
    const dTick = Math.round((((px - d.x0) / width) * L) / g) * g;
    const dRow = Math.round((py - d.y0) / rowH);
    if (!dTick && !dRow && !d.moved) return;
    d.moved = true;
    if (d.mode === 'resize') {
      d.last = edit.resizeNotes(d.base, track.id, d.indices, (dur) => Math.max(g, dur + dTick));
    } else {
      const r = moved(d.base, d.indices, dTick, dRow);
      d.last = r.next;
      setSelection(r.keys);
    }
    looper.preview(d.last);
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.moved && d.last) {
      const last = d.last;
      looper.edit(() => last, d.base);
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const { px, py } = point(e);
    if (px < 0) return;
    const tick = wrapTick(Math.floor(((px / width) * L) / g) * g, L);
    const note = rows[Math.max(0, Math.min(rows.length - 1, Math.floor(py / rowH)))]!;
    const n = { tick, duration: drums ? PPQ / 4 : g, note, velocity: 0.8 };
    looper.edit((p) => edit.addNote(p, track.id, n));
    setSelection(new Set([edit.noteKey(n)]));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const notes = track.notes;
    const has = selectedIdx.length > 0;
    const step = (dir: 1 | -1) => {
      if (!notes.length) return;
      const cur = has ? selectedIdx[dir > 0 ? selectedIdx.length - 1 : 0]! : dir > 0 ? -1 : notes.length;
      const nextI = Math.max(0, Math.min(notes.length - 1, cur + dir));
      setSelection(new Set([edit.noteKey(notes[nextI]!)]));
    };
    let handled = true;
    switch (e.key) {
      case ']':
        step(1);
        break;
      case '[':
        step(-1);
        break;
      case 'Escape':
        setSelection(new Set());
        break;
      case 'Delete':
      case 'Backspace':
        if (has) {
          looper.edit((p) => edit.deleteNotes(p, track.id, selectedIdx));
          setSelection(new Set());
        }
        break;
      case 'ArrowLeft':
      case 'ArrowRight': {
        if (!has) break;
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        if (e.shiftKey)
          looper.edit((p) => edit.resizeNotes(p, track.id, selectedIdx, (d) => Math.max(g, d + dir * g)));
        else apply((p) => moved(p, selectedIdx, dir * g, 0));
        break;
      }
      case 'ArrowUp':
      case 'ArrowDown': {
        if (!has) break;
        const dRow = (e.key === 'ArrowUp' ? -1 : 1) * (e.shiftKey && !drums ? 12 : 1);
        apply((p) => moved(p, selectedIdx, 0, dRow));
        break;
      }
      default:
        handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const beats = L / PPQ;
  const snapLines = width / (L / g) >= 6 ? Math.round(L / g) : 0;
  const status = first
    ? describe(first, track) + (selectedIdx.length > 1 ? ` (+${selectedIdx.length - 1} more)` : '')
    : 'No note selected';

  return (
    <>
      <div className={styles.header}>
        <strong>{track.name}</strong>
        <label className={styles.inline}>
          Snap
          <select value={snap} onChange={(e) => setSnap(e.target.value as Exclude<Grid, 'off'>)}>
            {SNAPS.map((s) => (
              <option key={s} value={s}>
                {s === '1/16T' ? '1/16 triplets' : s}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.inline}>
          Velocity
          <input
            type="range"
            min={0.05}
            max={1}
            step={0.01}
            disabled={!first}
            value={first?.velocity ?? 0.8}
            onPointerDown={() => (velBase.current ??= looper.snapshot())}
            onKeyDown={() => (velBase.current ??= looper.snapshot())}
            onChange={(e) => {
              const base = (velBase.current ??= looper.snapshot());
              looper.preview(edit.setVelocity(base, track.id, selectedIdx, Number(e.target.value)));
            }}
            onPointerUp={() => {
              if (velBase.current) looper.edit((p) => p, velBase.current);
              velBase.current = null;
            }}
            onKeyUp={() => {
              if (velBase.current) looper.edit((p) => p, velBase.current);
              velBase.current = null;
            }}
          />
        </label>
        <button
          className={styles.btn}
          disabled={!first}
          onClick={() => {
            looper.edit((p) => edit.deleteNotes(p, track.id, selectedIdx));
            setSelection(new Set());
          }}
        >
          Delete
        </button>
        <span className={styles.hint}>
          Double-click adds · drag the right edge to resize · [ ] select · arrows move
        </span>
        <button className={styles.btn} onClick={() => looper.openRoll(null, false)}>
          Close
        </button>
      </div>
      <div
        ref={wrap}
        className={styles.grid}
        tabIndex={0}
        role="application"
        aria-roledescription="piano roll"
        aria-label={`Notes of ${track.name}`}
        aria-describedby="pianoroll-status"
        data-local-keys
        onKeyDown={onKeyDown}
      >
        <p id="pianoroll-status" className={styles.status} aria-live="polite">
          {status}
        </p>
        <div className={styles.body}>
          <div className={styles.labels} style={{ width: LABEL_W }}>
            {rows.map((r) => (
              <div key={r} className={styles.label} style={{ height: rowH }}>
                {drums ? DRUM_LABEL[drumVoiceOf(r)!] : r % 12 === 0 || rows.length < 16 ? noteName(r) : ''}
              </div>
            ))}
          </div>
          <svg
            ref={svg}
            width={width}
            height={height}
            className={styles.svg}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) setSelection(new Set());
            }}
            onDoubleClick={onDoubleClick}
          >
            {rows.map((r, i) =>
              !drums && [1, 3, 6, 8, 10].includes(r % 12) ? (
                <rect key={r} x={0} y={i * rowH} width={width} height={rowH} className={styles.blackKey} />
              ) : null,
            )}
            {snapLines > 0 &&
              Array.from({ length: snapLines }, (_, k) => (
                <line
                  key={`s${k}`}
                  x1={x(k * g)}
                  x2={x(k * g)}
                  y1={0}
                  y2={height}
                  className={styles.snapLine}
                />
              ))}
            {Array.from({ length: beats }, (_, b) => (
              <line
                key={`b${b}`}
                x1={x(b * PPQ)}
                x2={x(b * PPQ)}
                y1={0}
                y2={height}
                className={b % 4 === 0 ? styles.barLine : styles.beatLine}
              />
            ))}
            {track.notes.map((n, i) => {
              const row = rowOf(n.note);
              if (row < 0) return null;
              const sel = selection.has(edit.noteKey(n));
              return noteSegments(n, L).map((seg, k) => {
                const sx = x(seg.tick);
                const sw = Math.max(3, x(seg.duration));
                return (
                  <rect
                    key={`${i}-${k}`}
                    x={sx}
                    y={row * rowH + 1}
                    width={sw}
                    height={Math.max(4, rowH - 2)}
                    rx={2}
                    className={`${styles.note} ${n.chord ? styles.chordNote : ''} ${sel ? styles.selectedNote : ''}`}
                    data-part={track.part}
                    style={{ opacity: 0.45 + 0.55 * n.velocity }}
                    onPointerDown={(e) => onNoteDown(e, i, sx, sw)}
                  />
                );
              });
            })}
          </svg>
          <Playhead width={width} />
        </div>
      </div>
      <p className={styles.footer}>
        {project.bars} bar{project.bars > 1 ? 's' : ''} · snap {snap} · Ctrl/⌘ + Z undoes any edit
      </p>
    </>
  );
}
