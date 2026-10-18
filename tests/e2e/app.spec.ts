import { expect, test, type Page } from '@playwright/test';

/** Fail the test if the page talks to anything but its own origin. */
function guardNetwork(page: Page) {
  const external: string[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname) && !['data:', 'blob:'].includes(url.protocol)) {
      external.push(req.url());
    }
  });
  return external;
}

test('landing explains camera use and privacy up front', async ({ page }) => {
  const external = guardNetwork(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('HANDWAVE');
  await expect(page.getByText('Your camera stays on your device')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enable camera' })).toBeFocused();
  expect(external).toEqual([]);
});

test('demo mode recognizes synthetic poses without a camera', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Watch the demo' }).click();
  const primary = page.getByRole('region', { name: 'Primary hand' });
  await expect(primary).toBeVisible();
  // The demo cycles open → one → two …; we should see at least two different recognized poses.
  const seen = new Set<string>();
  for (let i = 0; i < 30 && seen.size < 3; i++) {
    const text = (await primary.locator('[aria-live]').textContent())?.trim();
    if (text && text !== '—') seen.add(text);
    await page.waitForTimeout(150);
  }
  expect(seen.size).toBeGreaterThanOrEqual(3);
  await page.getByRole('button', { name: 'Debug' }).click();
  await expect(page.getByLabel('Debug panel')).toBeVisible();

  // Phase 2: the gestures drive chords. The chord display shows a name and a Roman numeral in C major.
  await expect(page.getByRole('button', { name: 'Sound on' })).toBeVisible({ timeout: 10_000 });
  const romans = new Set<string>();
  for (let i = 0; i < 40 && romans.size < 3; i++) {
    const roman = (await page.locator('[class*="chordRoman"]').textContent())?.trim();
    if (roman) romans.add(roman);
    await page.waitForTimeout(150);
  }
  expect(romans.size).toBeGreaterThanOrEqual(3);
  for (const r of romans) expect(r).toMatch(/^[♭♯]?(I|II|III|IV|V|VI|VII|i|ii|iii|iv|v|vi|vii)/);
  await expect(page.getByText('C Major (Ionian)', { exact: false }).first()).toBeVisible();
});

test('camera pipeline runs in a worker without blocking the main thread @perf', async ({ page }) => {
  const external = guardNetwork(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Enable camera' }).click();
  await page.getByRole('button', { name: 'Debug' }).click();

  const panel = page.getByLabel('Debug panel');
  // MediaPipe is loaded from same-origin assets under the production CSP; GPU may fall back to CPU here.
  await expect(panel.getByText(/^(GPU|CPU) \/ [AB]$/)).toBeVisible({ timeout: 45_000 });
  // Gesture frames keep arriving (the fake camera has no hands, but every frame is processed). CI machines
  // without a GPU run MediaPipe on WASM, so only require a steady trickle here; real speed is shown in the UI.
  await expect
    .poll(
      async () => Number(await page.locator('header').getByText(/fps$/).locator('strong').textContent()),
      { timeout: 20_000 },
    )
    .toBeGreaterThanOrEqual(5);
  await page.waitForTimeout(3000);

  const handler = await panel.locator('dt:text("main handler p99") + dd').textContent();
  const p99 = parseFloat(handler ?? '99');
  const detect = await panel.locator('dt:text("detect p50 / p95") + dd').textContent();
  test
    .info()
    .annotations.push({ type: 'perf', description: `main handler p99 ${p99} ms · detect ${detect}` });
  expect(p99).toBeLessThan(8);
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});
