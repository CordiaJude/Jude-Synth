import type { HandGesture } from '../../gestures/types';
import { useLiveSnapshot } from '../../state/live';
import type { HandRole } from '../../vision/types';
import { POSE_LABEL, ROLE_LABEL } from '../labels';
import styles from './Stage.module.css';

function HandCard({ role, hand }: { role: HandRole; hand: HandGesture | undefined }) {
  const color = role === 'primary' ? 'var(--primary)' : 'var(--secondary)';
  const conf = hand?.pose.confidence ?? 0;
  return (
    <section
      className={styles.handCard}
      data-empty={!hand}
      aria-label={`${ROLE_LABEL[role]} hand`}
      style={{ borderColor: hand ? color : undefined }}
    >
      <div className={styles.handRole}>
        <span style={{ color }}>{ROLE_LABEL[role]} hand</span>
        <span>{hand ? `${hand.handedness}${hand.coasting ? ' · lost' : ''}` : 'not seen'}</span>
      </div>
      <div className={styles.poseName} aria-live="polite">
        {hand ? POSE_LABEL[hand.pose.pose] : '—'}
      </div>
      <div
        className={styles.meter}
        role="meter"
        aria-label="Pose confidence"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(conf * 100)}
      >
        <div className={styles.meterFill} style={{ width: `${conf * 100}%`, background: color }} />
      </div>
      <div className={styles.meterLabel}>
        <span>confidence</span>
        <span className="tabular">{Math.round(conf * 100)}%</span>
      </div>
    </section>
  );
}

export function HandHud() {
  const { latest } = useLiveSnapshot(15);
  const hands = latest?.frame.hands ?? [];
  return (
    <div className={styles.hud}>
      <HandCard role="primary" hand={hands.find((h) => h.role === 'primary')} />
      <HandCard role="secondary" hand={hands.find((h) => h.role === 'secondary')} />
    </div>
  );
}
