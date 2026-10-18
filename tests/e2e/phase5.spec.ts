import ToneMidi from '@tonejs/midi';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const { Midi } = ToneMidi as unknown as typeof import('@tonejs/midi');

async function startManual(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play with keyboard / touch' }).click();
  await expect(page.getByRole('button', { name: 'Sound on' })).toBeVisible({ timeout: 10_000 });
}
const panel = (page: Page) => page.getByLabel('Looper', { exact: true });
const tracks = (page: Page) => panel(page).getByRole('list', { name: 'Loop tracks' }).getByRole('listitem');
/** Move focus off form controls so the instrument keys reach the app. */
const focusStage = (page: Page) => page.locator('main').click({ position: { x: 300, y: 300 } });

/** Record a one-bar loop (no count-in) of two chords from the keyboard. */
async function recordOneBar(page: Page) {
  await page.getByRole('button', { name: 'Looper' }).click();
  await panel(page).getByLabel('Count-in').selectOption('0');
  await panel(page).getByLabel('Loop length').selectOption('1');
  await focusStage(page);
  await page.keyboard.press('KeyO');
  await page.keyboard.press('Digit1');
  await page.waitForTimeout(1200);
  await page.keyboard.press('Digit5');
  // One bar at 96 BPM is 2.5 s; the loop closes itself and starts playing.
  await expect(panel(page).getByRole('status').first()).toContainText('Playing', { timeout: 6000 });
  await page.keyboard.press('Space'); // let go of the live chord: the loop keeps it
}

test('record a loop from the keyboard: it closes on the bar and plays back', async ({ page }) => {
  await startManual(page);
  await recordOneBar(page);
  await expect(tracks(page).first()).toContainText('Chords');
  await expect(page.locator('header').getByTitle('Looper')).toContainText('loop');
  // The loop position advances while it plays.
  const pos = panel(page).getByLabel('Loop position');
  const a = await pos.textContent();
  await page.waitForTimeout(800);
  expect(await pos.textContent()).not.toBe(a);
  await page.keyboard.press('KeyP');
  await expect(panel(page).getByRole('status').first()).toContainText('Stopped');
});

test('undo / redo, mute and solo, overdub into a new track', async ({ page }) => {
  await startManual(page);
  await recordOneBar(page);
  const count = await tracks(page).count();
  expect(count).toBeGreaterThanOrEqual(1);
  await panel(page).getByRole('button', { name: 'Undo' }).click();
  await expect(tracks(page)).toHaveCount(0);
  await focusStage(page);
  await page.keyboard.press('Control+Shift+KeyZ');
  await expect(tracks(page)).toHaveCount(count);

  const mute = panel(page).getByRole('button', { name: 'Mute Chords' });
  await mute.click();
  await expect(mute).toHaveAttribute('aria-pressed', 'true');
  await mute.click();
  await panel(page).getByRole('button', { name: 'Solo Chords' }).click();
  await expect(panel(page).getByRole('button', { name: 'Solo Chords' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // Overdub: one pass round the loop, starting on the next bar.
  await page.keyboard.press('KeyP'); // make sure it is playing
  await expect(panel(page).getByRole('status').first()).toContainText(/Playing|Stopped/);
  if ((await panel(page).getByRole('status').first().textContent())?.includes('Stopped'))
    await page.keyboard.press('KeyP');
  await focusStage(page);
  await page.keyboard.press('KeyO');
  await page.waitForTimeout(400);
  await page.keyboard.press('Digit4');
  await expect(tracks(page).filter({ hasText: 'Chords 2' })).toHaveCount(1, { timeout: 9000 });
});

test('piano roll: keyboard editing is one undo step per key', async ({ page }) => {
  await startManual(page);
  await recordOneBar(page);
  await panel(page).getByRole('button', { name: 'Edit notes of Chords' }).click();
  const roll = page.getByRole('application', { name: 'Notes of Chords' });
  await expect(roll).toBeVisible();
  await roll.focus();
  await page.keyboard.press(']');
  const status = page.locator('#pianoroll-status');
  await expect(status).toContainText('bar 1 beat 1');
  // Ticks after the beat (the take starts wherever the key was actually pressed).
  const ticks = async () => Number(/\+(\d+) ticks/.exec((await status.textContent()) ?? '')?.[1] ?? 0);
  const t0 = await ticks();
  await page.keyboard.press('ArrowRight'); // one 1/16 later
  await expect.poll(ticks).toBe(t0 + 120);
  await page.keyboard.press('Control+KeyZ'); // undo works inside the piano roll too
  await page.keyboard.press(']');
  await page.keyboard.press('[');
  await expect.poll(ticks).toBe(t0);
  await page.getByRole('region', { name: 'Piano roll' }).getByRole('button', { name: 'Close' }).click();
  await expect(roll).toBeHidden();
});

test('exports: .mid parses back with the recorded notes; WAV and stems are valid files', async ({ page }) => {
  test.setTimeout(90_000);
  await startManual(page);
  await recordOneBar(page);
  const exp = panel(page);

  const [mid] = await Promise.all([
    page.waitForEvent('download'),
    exp.getByRole('button', { name: 'MIDI (.mid)' }).click(),
  ]);
  expect(mid.suggestedFilename()).toMatch(/^handwave-loop-.*\.mid$/);
  const midi = new Midi(readFileSync((await mid.path())!));
  expect(midi.header.tempos[0]!.bpm).toBeCloseTo(96, 0);
  const chords = midi.tracks.find((t) => t.name === 'Chords')!;
  expect(chords.notes.length).toBeGreaterThanOrEqual(3);
  expect(Math.min(...chords.notes.map((n) => n.ticks))).toBeLessThan(240); // started at the top of the loop

  await exp.getByLabel('WAV format').selectOption('16');
  const [wav] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    exp.getByRole('button', { name: 'Mix (.wav)' }).click(),
  ]);
  const w = readFileSync((await wav.path())!);
  expect(w.subarray(0, 4).toString()).toBe('RIFF');
  expect(w.readUInt16LE(34)).toBe(16);
  const seconds = w.readUInt32LE(40) / w.readUInt32LE(28);
  expect(seconds).toBeGreaterThan(5); // one bar (2.5 s) + 3 s of tail
  let peak = 0;
  for (let i = 44; i < w.length - 1; i += 2) peak = Math.max(peak, Math.abs(w.readInt16LE(i)));
  expect(peak).toBeGreaterThan(1000); // not silent

  const [zip] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    exp.getByRole('button', { name: 'Stems (.zip)' }).click(),
  ]);
  const z = readFileSync((await zip.path())!);
  expect(z.subarray(0, 2).toString()).toBe('PK');
  const names = z.toString('latin1');
  expect(names).toContain('/mix.wav');
  expect(names).toContain('/Chords.wav');
});

test('the loop is saved in the browser and comes back after a reload', async ({ page }) => {
  await startManual(page);
  await recordOneBar(page);
  const n = await tracks(page).count();
  await page.waitForTimeout(600); // autosave
  await page.reload();
  await page.getByRole('button', { name: 'Play with keyboard / touch' }).click();
  await page.getByRole('button', { name: 'Looper' }).click();
  await expect(tracks(page)).toHaveCount(n);
  await expect(panel(page).getByRole('status').first()).toContainText('Stopped');
});

test('MIDI out sends what you play to the chosen port', async ({ page }) => {
  // A fake Web MIDI output that records what it is sent.
  await page.addInitScript(() => {
    const sent: number[][] = [];
    (window as unknown as { __midiSent: number[][] }).__midiSent = sent;
    const output = { id: 'fake-1', name: 'Fake Synth', send: (d: number[]) => sent.push([...d]) };
    const access = {
      outputs: new Map([[output.id, output]]),
      inputs: new Map(),
      onstatechange: null,
      sysexEnabled: false,
    };
    Object.defineProperty(navigator, 'requestMIDIAccess', { value: async () => access, configurable: true });
  });
  await startManual(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByLabel('Settings', { exact: true });
  await settings.getByRole('checkbox', { name: /Send what you play/ }).check();
  await expect(settings.getByRole('combobox', { name: 'Port' })).toHaveValue('fake-1');
  await focusStage(page);
  await page.keyboard.press('Digit1');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __midiSent: number[][] }).__midiSent.filter((m) => (m[0]! & 0xf0) === 0x90)
            .length,
      ),
    )
    .toBeGreaterThanOrEqual(3);
  await page.keyboard.press('Space');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __midiSent: number[][] }).__midiSent.filter((m) => (m[0]! & 0xf0) === 0x80)
            .length,
      ),
    )
    .toBeGreaterThanOrEqual(3);
});
