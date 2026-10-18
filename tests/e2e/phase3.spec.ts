import { expect, test, type Page } from '@playwright/test';

const chordName = (page: Page) => page.locator('[class*="chordName"]');
const chordRoman = (page: Page) => page.locator('[class*="chordRoman"]');

async function startManual(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play with keyboard / touch' }).click();
  await expect(page.getByRole('button', { name: 'Sound on' })).toBeVisible({ timeout: 10_000 });
}

test('keyboard plays chords without a camera', async ({ page }) => {
  await startManual(page);
  await page.keyboard.press('Digit1');
  await expect(chordName(page)).toHaveText('C');
  await page.keyboard.press('Digit6');
  await expect(chordRoman(page)).toHaveText('vi');
  await page.keyboard.press('KeyW');
  await expect(chordName(page)).toHaveText('Am7');
  await page.keyboard.down('Shift');
  await page.keyboard.press('Digit4');
  await page.keyboard.up('Shift');
  await expect(chordRoman(page)).toHaveText('iv7');
  await page.keyboard.press('Space');
  await expect(chordName(page)).toHaveText('—');
});

test('touch pad plays chords and latch holds them', async ({ page }) => {
  await startManual(page);
  const pad = page.getByRole('group', { name: 'Touch controls' });
  await pad.getByRole('button', { name: /Chord V \(G\)/ }).dispatchEvent('pointerdown');
  await expect(chordName(page)).toHaveText('G');
  await pad.getByRole('button', { name: '9th' }).click();
  await expect(chordName(page)).toHaveText('G9');
  await pad.getByRole('button', { name: 'Latch' }).click();
  await expect(page.getByText('LATCHED')).toBeVisible();
  await page.keyboard.press('Space'); // release is ignored while latched
  await expect(chordName(page)).toHaveText('G9');
});

test('key and mode change re-voice the held chord', async ({ page }) => {
  await startManual(page);
  await page.keyboard.press('Digit2');
  await expect(chordName(page)).toHaveText('Dm');
  await page
    .getByRole('group', { name: 'Sound settings' })
    .getByLabel('Mode', { exact: true })
    .selectOption('dorian');
  await expect(chordName(page)).toHaveText('Dm'); // ii in C dorian is Dm too
  await page
    .getByRole('group', { name: 'Sound settings' })
    .getByLabel('Key', { exact: true })
    .selectOption('2');
  await expect(chordName(page)).toHaveText('Em');
});

test('presets switch, and the theremin preset shows the melody strip', async ({ page }) => {
  await startManual(page);
  const bar = page.getByRole('group', { name: 'Sound settings' });
  await bar.getByLabel('Preset').selectOption({ label: 'Theremin Pro' });
  const strip = page.getByRole('slider', { name: /Melody strip/ });
  await expect(strip).toBeVisible();
  const box = (await strip.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.3);
  await page.mouse.down();
  await expect(chordName(page)).toHaveText(/^[A-G][♯♭]?\d$/);
  await page.mouse.up();
  await expect(chordName(page)).toHaveText('—');
});

test('mapping editor: editing a built-in saves a copy, export and import validate', async ({ page }) => {
  await startManual(page);
  await page.getByRole('button', { name: 'Mappings' }).click();
  const editor = page.getByLabel('Mapping editor');
  await expect(editor.getByLabel('Mapping name').first()).toHaveValue('Height → volume');
  await expect(editor.getByText('Primary hand: One')).toBeVisible();
  await expect(editor.getByText(/first edit saves a copy/)).toBeVisible();
  await editor.getByLabel('Mapping name').first().fill('My volume');
  await expect(editor.getByLabel('Preset')).toHaveValue(/^user-/);
  await expect(editor.getByLabel('Mapping name').first()).toHaveValue('My volume');

  // Persisted across reloads.
  await page.reload();
  await page.getByRole('button', { name: 'Play with keyboard / touch' }).click();
  await page.getByRole('button', { name: 'Mappings' }).click();
  await expect(page.getByLabel('Mapping editor').getByLabel('Mapping name').first()).toHaveValue('My volume');

  // Importing garbage shows validation errors.
  const chooser = page.waitForEvent('filechooser');
  await page.getByLabel('Mapping editor').getByRole('button', { name: 'Import…' }).click();
  await (
    await chooser
  ).setFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"version":2}') });
  await expect(page.getByRole('alert')).toContainText('isn’t a valid preset');
});

test('settings: reduced motion and high contrast apply to the page', async ({ page }) => {
  await startManual(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByLabel('Settings');
  await settings.getByLabel('Motion').selectOption('reduce');
  await settings.getByLabel('Colours').selectOption('highContrast');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduce');
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'highContrast');
  await expect(settings.getByText('Calibration needs the camera.')).toBeVisible();
});

test('first camera run offers calibration; a saved calibration persists and skips it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Enable camera' }).click();
  const dialog = page.getByRole('dialog', { name: /Quick calibration/ });
  await expect(dialog).toBeVisible({ timeout: 45_000 });
  await dialog.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByText(/Waiting for your hand/)).toBeVisible(); // fake camera has no hands: timer paused
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Seed a saved calibration (as if the user completed it) and restart: no prompt, settings show it.
  await page.evaluate(() => {
    const key = 'handwave.settings.v1';
    const saved = JSON.parse(localStorage.getItem(key) ?? '{"state":{},"version":0}');
    const f = { curled: 0.1, open: 0.8 };
    saved.state.calibration = {
      version: 1,
      fingerExtension: { thumb: f, index: f, middle: f, ring: f, pinky: f },
      palmSize: { near: 6, far: 1.2 },
      pinch: { closed: 0.15, open: 1 },
      createdAt: Date.now(),
    };
    localStorage.setItem(key, JSON.stringify(saved));
  });
  await page.reload();
  await page.getByRole('button', { name: 'Enable camera' }).click();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByLabel('Settings').getByText(/^Calibrated/)).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
