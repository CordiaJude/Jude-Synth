import { expect, test } from '@playwright/test';

// Acceptance bar: zero audible clicks on chord changes, verified on offline renders of the real engine.
test.describe('audio quality (offline renders)', () => {
  test.setTimeout(240_000);

  test('detectors catch naive synthesis (positive control)', async ({ page }) => {
    await page.goto('/audio-harness.html');
    await expect(page.locator('body[data-ready="true"]')).toBeAttached();
    const r = await page.evaluate(() => window.handwaveHarness.runPositiveControl());
    expect(r.sine).toBeGreaterThan(5);
    expect(r.transient).toBeGreaterThan(3);
  });

  test('detectors catch hard-cut releases on a real instrument (positive control)', async ({ page }) => {
    await page.goto('/audio-harness.html');
    await expect(page.locator('body[data-ready="true"]')).toBeAttached();
    const r = await page.evaluate(() => window.handwaveHarness.runBrokenVoiceControl());
    console.log(
      `${r.name}: clicks=${r.clicks} worst=${r.worstRatio.toFixed(2)} threshold=${r.threshold?.toFixed(2)}`,
    );
    expect(r.clicks).toBeGreaterThan(0);
  });

  test('zero clicks across voice-manager torture tests and real instruments', async ({ page }) => {
    await page.goto('/audio-harness.html');
    await expect(page.locator('body[data-ready="true"]')).toBeAttached();
    const results = await page.evaluate(() => window.handwaveHarness.runClickSuite());
    for (const r of results) {
      test.info().annotations.push({
        type: 'render',
        description: `${r.name}: ${r.clicks} clicks, worst ${r.worstRatio.toFixed(2)}, peak ${r.peakDb.toFixed(2)} dBFS, ${r.renderMs.toFixed(0)} ms`,
      });
    }
    console.log(
      results
        .map(
          (r) =>
            `${r.name}: clicks=${r.clicks} worst=${r.worstRatio.toFixed(2)}${r.threshold ? `/${r.threshold.toFixed(2)}` : ''} peak=${r.peakDb.toFixed(2)}dB ${JSON.stringify(r.firstClicks)}`,
        )
        .join('\n'),
    );
    for (const r of results) {
      expect(r.nonFinite, r.name).toBe(0);
      expect(r.peakDb, r.name).toBeLessThanOrEqual(-0.3);
      // The strict (sine) detector is the zero-click acceptance bar. The transient detector on real
      // waveforms is a gross-artifact check only (an instrument's own plucky attack can approach it).
      if (r.detector === 'sine') expect(r.clicks, `${r.name} ${JSON.stringify(r.firstClicks)}`).toBe(0);
      else expect(r.worstRatio, r.name).toBeLessThan(12);
    }
    expect(results.find((r) => r.name.startsWith('loud'))!.peakDb).toBeGreaterThan(-3); // it was actually loud
  });
});
