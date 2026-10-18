import { useEffect } from 'react';
import { handleKey, type KeyboardContext } from '../input/keyboard';
import { looper } from '../state/looper';
import { conductorSnapshot, getPreset, perform, useMusic } from '../state/music';

/** Global keyboard fallback while a session runs. Ignores keys typed into form controls. */
export function useKeyboardInput(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const held = new Set<string>();
    // Octave and inversion come from the conductor, so keys and gestures never disagree about them.
    const context = (): KeyboardContext => {
      const m = useMusic.getState();
      const c = conductorSnapshot();
      return {
        key: { tonic: m.tonic, mode: m.mode },
        melody: getPreset().melody,
        octave: c.octave,
        inversionBias: c.inversionBias,
      };
    };
    const onKey = (type: 'down' | 'up') => (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, select, textarea, [contenteditable="true"]')) return;
      // Looper undo / redo: the usual shortcuts, also inside the piano roll.
      if (
        type === 'down' &&
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        (e.code === 'KeyZ' || e.code === 'KeyY')
      ) {
        e.preventDefault();
        if (e.code === 'KeyY' || e.shiftKey) looper.redo();
        else looper.undo();
        return;
      }
      // Widgets with their own keys (the piano roll), and Space on a focused button.
      if (t && (t.closest('[data-local-keys]') || (t.tagName === 'BUTTON' && e.code === 'Space'))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const r = handleKey({ code: e.code, shiftKey: e.shiftKey, repeat: e.repeat, type }, context(), held);
      if (!r) return;
      e.preventDefault();
      if (r.actions.length || r.params.length) perform(r.actions, r.params);
    };
    const down = onKey('down');
    const up = onKey('up');
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [enabled]);
}
