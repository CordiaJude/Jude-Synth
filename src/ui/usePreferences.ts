import { useEffect, useState } from 'react';
import { useApp } from '../state/store';

/** Effective reduced-motion preference (the user's choice, or the OS setting when set to "system"). */
export function useReducedMotion(): boolean {
  const motion = useApp((s) => s.motion);
  const [system, setSystem] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  );
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const on = () => setSystem(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return motion === 'reduce' || (motion === 'system' && system);
}

/** Reflect accessibility preferences on <html> so CSS can react. */
export function usePreferenceAttributes(): void {
  const reduce = useReducedMotion();
  const palette = useApp((s) => s.palette);
  useEffect(() => {
    document.documentElement.dataset.motion = reduce ? 'reduce' : 'full';
    document.documentElement.dataset.palette = palette;
  }, [reduce, palette]);
}
