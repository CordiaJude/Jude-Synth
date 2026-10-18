import { PRIVACY_STATEMENT } from '../../config/app';
import { KEYBOARD_HELP } from '../../input/keyboard';
import { applyCalibration } from '../../state/session';
import { useApp, type MotionPref, type Palette } from '../../state/store';
import styles from './Settings.module.css';

export function SettingsPanel() {
  const { motion, palette, setMotion, setPalette, calibration, setCalibrating, source, padOpen, setPadOpen } =
    useApp();
  return (
    <aside className={styles.panel} aria-label="Settings">
      <section className={styles.section}>
        <h3>Hand calibration</h3>
        <p className={styles.text}>
          {calibration
            ? `Calibrated ${new Date(calibration.createdAt).toLocaleDateString()} — your personal finger, pinch and distance ranges are in use.`
            : 'Not calibrated — using default ranges. Calibrating takes 10 seconds and improves accuracy.'}
        </p>
        <div className={styles.row}>
          <button className={styles.btn} onClick={() => setCalibrating(true)} disabled={source !== 'camera'}>
            {calibration ? 'Recalibrate' : 'Calibrate now'}
          </button>
          {calibration && (
            <button className={styles.btn} onClick={() => applyCalibration(null)}>
              Reset to defaults
            </button>
          )}
        </div>
        {source !== 'camera' && <p className={styles.hint}>Calibration needs the camera.</p>}
      </section>

      <section className={styles.section}>
        <h3>Accessibility</h3>
        <label className={styles.field}>
          <span>Motion</span>
          <select value={motion} onChange={(e) => setMotion(e.target.value as MotionPref)}>
            <option value="system">Follow system setting</option>
            <option value="reduce">Reduced motion</option>
            <option value="full">Full motion</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>Colours</span>
          <select value={palette} onChange={(e) => setPalette(e.target.value as Palette)}>
            <option value="default">Blue / orange (colour-blind safe)</option>
            <option value="highContrast">High contrast (cyan / yellow, thicker lines)</option>
          </select>
        </label>
        <label className={styles.check}>
          <input type="checkbox" checked={padOpen} onChange={(e) => setPadOpen(e.target.checked)} /> Show the
          touch pad over the camera
        </label>
      </section>

      <section className={styles.section}>
        <h3>Keyboard</h3>
        <dl className={styles.keys}>
          {KEYBOARD_HELP.map(([k, v]) => (
            <div key={k}>
              <dt>
                <kbd>{k}</kbd>
              </dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className={styles.section}>
        <h3>Privacy</h3>
        <p className={styles.text}>
          {PRIVACY_STATEMENT} Presets and calibration are stored in this browser only.
        </p>
      </section>
    </aside>
  );
}
