import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the LCS console.
 *
 * The console is served at /_lcs/ui/ (see vite.config.ts — the prefix is load-bearing
 * because path-style S3 would otherwise let a bucket shadow the app), so `baseURL`
 * carries that prefix and specs navigate with app-relative paths like "./services".
 *
 * Tests run against the Vite dev server with the LCS-native endpoints stubbed in the
 * browser (see e2e/fixtures.ts). That keeps these specs about console behaviour and
 * makes them runnable with no emulator, no Java build, and no Docker. The plan's
 * Phase 3a target — the same flows against a real LCS container — is a superset that
 * reuses these specs; only the fixture's stubbing changes.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  // Vite serves unbundled ESM in dev, so a cold first navigation pulls ~250 Cloudscape
  // modules through the dependency optimizer and the `load` event lands well past a
  // 30s budget. Warm runs are far quicker; these timeouts cover the cold case so the
  // first run of a fresh checkout is not a spurious failure.
  timeout: 90_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: "http://localhost:5173/_lcs/ui/",
    navigationTimeout: 60_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173/_lcs/ui/",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
