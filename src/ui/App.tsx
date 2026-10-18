import { useApp } from '../state/store';
import { Landing } from './landing/Landing';
import { Stage } from './stage/Stage';

export function App() {
  const phase = useApp((s) => s.phase);
  return phase === 'landing' || phase === 'error' ? <Landing /> : <Stage />;
}
