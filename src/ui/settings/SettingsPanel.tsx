import { PRIVACY_STATEMENT } from '../../config/app';
import { KEYBOARD_HELP } from '../../input/keyboard';
import { midi, useMidi } from '../../state/midi';
import { applyCalibration } from '../../state/session';
import { useApp, type MotionPref, type Palette } from '../../state/store';
import styles from './Settings.module.css';

function MidiSection() {
  const m = useMidi();
  if (!m.supported) {
    return (
      <section className={styles.section}>
        <h3>MIDI out</h3>
        <p className={styles.text}>
          This browser has no Web MIDI (Safari, for example). You can still export loops as .mid files.
        </p>
      </section>
    );
  }
  const on = m.status === 'on';
  return (
    <section className={styles.section}>
      <h3>MIDI out</h3>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={on || m.status === 'requesting'}
          onChange={(e) => (e.target.checked ? void midi.enable() : midi.disable())}
        />{' '}
        Send what you play to a MIDI port (a DAW or hardware synth)
      </label>
      {m.status === 'denied' && (
        <p className={styles.hint} role="alert">
          MIDI access was refused{m.error ? ` (${m.error})` : ''}. Allow MIDI for this site and try again.
        </p>
      )}
      {on && (
        <>
          <label className={styles.field}>
            <span>Port</span>
            <select
              value={m.portId ?? ''}
              onChange={(e) => midi.selectPort(e.target.value)}
              disabled={!m.ports.length}
            >
              {m.ports.length === 0 && <option value="">No MIDI outputs found</option>}
              {m.ports.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Channels</span>
            <select
              value={m.layout === 'split' ? 'split' : String(m.channel)}
              onChange={(e) =>
                e.target.value === 'split'
                  ? midi.setLayout('split')
                  : midi.setLayout('single', Number(e.target.value))
              }
            >
              <option value="split">Per part: chords 1 · melody 2 · bass 3 · loops 4–9, 11–12</option>
              {Array.from({ length: 16 }, (_, c) => c)
                .filter((c) => c !== 9)
                .map((c) => (
                  <option key={c} value={c}>
                    Everything on channel {c + 1}
                  </option>
                ))}
            </select>
          </label>
          <p className={styles.hint}>
            Drums always go on channel 10 (General MIDI kit); brightness is sent as CC 74, glides as pitch
            bend (±12). {m.sent > 0 && `${m.sent} messages sent.`}
          </p>
          <div className={styles.row}>
            <button className={styles.btn} onClick={midi.panic}>
              All notes off
            </button>
          </div>
        </>
      )}
    </section>
  );
}

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

      <MidiSection />

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
          {PRIVACY_STATEMENT} Presets, calibration and loops are stored in this browser only.
        </p>
      </section>
    </aside>
  );
}
