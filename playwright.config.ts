import { defineConfig, devices } from '@playwright/test';

// Tests run against the production build (vite preview), so the real CSP and self-hosted assets are exercised.
// FAKE_VIDEO=path/to/hands.y4m feeds a recorded clip as the webcam instead of Chromium's test pattern.
const fakeVideo = process.env.FAKE_VIDEO;
const chromiumArgs = [
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
  '--enable-unsafe-swiftshader',
  ...(fakeVideo ? [`--use-file-for-fake-video-capture=${fakeVideo}`] : []),
];

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: true,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    permissions: ['camera'],
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'HANDWAVE_HARNESS=1 pnpm build && pnpm preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: chromiumArgs,
          // Use a preinstalled Chromium when the bundled one isn't downloaded (e.g. sandboxed CI images).
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
        },
      },
    },
  ],
});
