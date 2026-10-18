import { expect, test } from '@playwright/test';

// Phase 5 acceptance: "offline render equals live playback". A live performance is rendered through the
// engine, recorded by the looper, and the loop rendered again through the export path. Two renders of the
// SAME live events already differ by float rounding (resonant filters amplify it to about −76 dB), so the
// bar is: the loop matches the performance as closely as the engine matches itself.
test.describe('looper audio (offline renders)', () => {
  test.setTimeout(240_000);

  test('a loop renders like the live performance it was recorded from', async ({ page }) => {
    await page.goto('/audio-harness.html');
    await expect(page.locator('body[data-ready="true"]')).toBeAttached();
    const loop = await page.evaluate(() => window.handwaveHarness.runLoopEquivalence());
    const self = await page.evaluate(() => window.handwaveHarness.runLoopEquivalence(undefined, true, true));
    const line = `loop vs live: residual ${loop.residualDb.toFixed(1)} dB, max diff ${loop.maxDiff.toExponential(2)} · live vs live: residual ${self.residualDb.toFixed(1)} dB · ${loop.tracks.join(', ')}`;
    console.log(line);
    test.info().annotations.push({ type: 'equivalence', description: line });
    expect(loop.tracks).toHaveLength(4);
    expect(loop.nonFinite).toBe(0);
    expect(loop.rmsDb).toBeGreaterThan(-40); // it actually played something
    expect(loop.residualDb).toBeLessThan(-60);
    expect(loop.residualDb).toBeLessThan(self.residualDb + 6);
    expect(loop.maxDiff).toBeLessThan(5e-4);
  });

  test('drums (no resonant filters) are sample-exact when dry', async ({ page }) => {
    await page.goto('/audio-harness.html');
    await expect(page.locator('body[data-ready="true"]')).toBeAttached();
    const r = await page.evaluate(() => window.handwaveHarness.runLoopEquivalence('drums', false));
    expect(r.rmsDb).toBeGreaterThan(-40);
    expect(r.residualDb).toBeLessThan(-130);
  });
});
