import { expect, test, type Page } from '@playwright/test';

async function startManual(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play with keyboard / touch' }).click();
  await expect(page.getByRole('button', { name: 'Sound on' })).toBeVisible({ timeout: 10_000 });
}
const chip = (page: Page) => page.locator('header').getByTitle('Tempo and bar.beat');

test('drums run on the transport: D starts them and the bar position advances', async ({ page }) => {
  await startManual(page);
  await page.keyboard.press('Digit1');
  await page.keyboard.press('KeyD');
  await expect(chip(page)).toContainText('drums');
  const first = await chip(page).textContent();
  await page.waitForTimeout(1500);
  expect(await chip(page).textContent()).not.toBe(first);
  await page.keyboard.press('KeyD');
  await expect(chip(page)).not.toContainText('drums');
});

test('arpeggiator and strum take over the chord without changing it', async ({ page }) => {
  await startManual(page);
  await page.keyboard.press('Digit6');
  await page.keyboard.press('KeyA');
  await expect(chip(page)).toContainText('arp');
  await expect(page.locator('[class*="chordName"]')).toHaveText('Am');
  await page.keyboard.press('Digit4');
  await expect(page.locator('[class*="chordName"]')).toHaveText('F');
  await page.keyboard.press('KeyS'); // a keyboard strum works any time
  await expect(page.locator('[class*="chordName"]')).toHaveText('F');
});

test('groove panel: tempo, tap, quantize, styles', async ({ page }) => {
  await startManual(page);
  await page.getByRole('button', { name: 'Groove' }).click();
  const panel = page.getByLabel('Groove', { exact: true });
  await panel.getByLabel('Tempo in BPM').fill('120');
  await expect(chip(page)).toContainText('120');
  await panel.getByRole('checkbox', { name: 'Drums' }).check();
  await panel.getByLabel('Style').selectOption('house');
  await expect(chip(page)).toContainText('124'); // a style brings its own tempo
  await panel.getByLabel('Quantize what you trigger').selectOption('1/16');
  await expect(panel.getByText('Strength')).toBeVisible();
  await page.locator('body').click({ position: { x: 5, y: 400 } }); // focus away from the form controls
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('KeyT');
    await page.waitForTimeout(280);
  }
  // ~280 ms apart (plus a little key-press overhead) ≈ 190–210 bpm: clearly not the house tempo any more.
  const bpm = Number((await chip(page).locator('strong').textContent()) ?? 0);
  expect(bpm).toBeGreaterThan(170);
  expect(bpm).toBeLessThanOrEqual(220);
});

test('the Arp & Groove preset switches its groove on', async ({ page }) => {
  await startManual(page);
  await page
    .getByRole('group', { name: 'Sound settings' })
    .getByLabel('Preset')
    .selectOption({ label: 'Arp & Groove' });
  await expect(chip(page)).toContainText('drums · arp');
  await page
    .getByRole('group', { name: 'Sound settings' })
    .getByLabel('Preset')
    .selectOption({ label: 'Classic Two-Hand' });
  await expect(chip(page)).not.toContainText('drums');
});

test('latency breakdown appears per stage when gestures trigger sound', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Watch the demo' }).click();
  await page.getByRole('button', { name: 'Debug' }).click();
  const list = page.getByRole('list', { name: 'Latency by stage (median)' });
  await expect(list).toBeVisible({ timeout: 15_000 });
  for (const stage of ['hand detection', 'scheduling lookahead', 'audio output'])
    await expect(list).toContainText(stage);
});

test('stopping resets the groove to the preset defaults', async ({ page }) => {
  await startManual(page);
  await page.keyboard.press('KeyA');
  await page.keyboard.press('KeyD');
  await expect(chip(page)).toContainText('drums · arp');
  await page.getByRole('button', { name: 'Stop' }).click();
  await page.getByRole('button', { name: 'Play with keyboard / touch' }).click();
  await expect(chip(page)).not.toContainText('arp');
  await expect(chip(page)).not.toContainText('drums');
});
