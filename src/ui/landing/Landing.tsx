import { APP_NAME, APP_TAGLINE, PRIVACY_STATEMENT } from '../../config/app';
import { requestCamera, startDemo } from '../../state/session';
import { useApp } from '../../state/store';
import styles from './Landing.module.css';

export function Landing() {
  const error = useApp((s) => s.error);
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <span className={styles.badge}>Preview · hand tracking</span>
        <h1 className={styles.brand}>{APP_NAME}</h1>
        <p className={styles.tagline}>{APP_TAGLINE}</p>

        <section className={styles.privacy} aria-labelledby="privacy-title">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z"
              stroke="currentColor"
              strokeWidth="1.8"
            />
            <path d="m8.5 12 2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <div>
            <h2 id="privacy-title">Your camera stays on your device</h2>
            <p>
              {PRIVACY_STATEMENT} {APP_NAME} only looks for the 21 joint positions of each hand — no video is
              recorded or uploaded, and the app makes no network requests while you play.
            </p>
          </div>
        </section>

        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}

        <div className={styles.actions}>
          <button className={styles.primaryBtn} onClick={requestCamera} autoFocus>
            Enable camera
          </button>
          <button className={styles.ghostBtn} onClick={startDemo}>
            Try the demo (no camera)
          </button>
        </div>

        <ul className={styles.steps}>
          <li>Your browser will ask for camera permission. Nothing starts until you allow it.</li>
          <li>Best with good front lighting and both hands visible, about an arm’s length away.</li>
        </ul>
      </div>
    </main>
  );
}
