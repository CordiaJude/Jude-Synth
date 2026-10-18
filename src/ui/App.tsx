import { useApp } from '../state/store';
import { Landing } from './landing/Landing';
import { Stage } from './stage/Stage';
import { usePreferenceAttributes } from './usePreferences';

export function App() {
  usePreferenceAttributes();
  const phase = useApp((s) => s.phase);
  return phase === 'landing' || phase === 'error' ? <Landing /> : <Stage />;
}
