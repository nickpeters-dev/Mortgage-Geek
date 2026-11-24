// Playwright end-to-end suite. See QA_STRATEGY.md for how it fits with the
// node:test unit suites (tests/*.test.mjs), which this config never touches.
import { defineConfig, devices } from "@playwright/test";

const PORT = 4321;
const HTTP_SPECS = /.*\.http\.spec\.ts/;

export default defineConfig({
  // Only tests/e2e, and only *.spec.ts. Playwright's default pattern would also
  // match the node:test files (tests/*.test.mjs), so both are pinned.
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  outputDir: "./test-results",

  fullyParallel: true,
  // A stray test.only would silently skip the rest of the suite in CI.
  forbidOnly: !!process.env.CI,
  // No retries locally, so flakiness is visible while you work. In CI a test
  // that fails then passes is reported as "flaky", not hidden.
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }], ["github"]]
    : [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: `http://localhost:${PORT}`,
    // Failure diagnostics: a full trace (DOM snapshots, network, console, a
    // filmstrip) and a screenshot, kept only for failing tests.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // The site registers a service worker. Requests it answers bypass
    // page.route(), which would let a test reach the real /api/rates.
    serviceWorkers: "block",
    // Pinned so number and date formatting are the same on every machine.
    locale: "en-US",
    timezoneId: "America/Chicago",
  },

  projects: [
    // Raw HTTP checks (status codes, redirects, served HTML). No browser.
    { name: "http", testMatch: HTTP_SPECS },
    // >= 1100px wide: the calculator's desktop "cockpit" layout.
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: HTTP_SPECS },
    // iPhone 13 on WebKit (Safari's engine): the mobile layout and touch.
    { name: "mobile-webkit", use: { ...devices["iPhone 13"] }, testIgnore: HTTP_SPECS },
  ],

  // Playwright starts this before the tests and stops it after. It builds the
  // app first, so a run always tests the current code, then serves the build
  // the way Vercel does (see scripts/serveBuild.mjs).
  webServer: {
    command: "npm run build && node scripts/serveBuild.mjs",
    url: `http://localhost:${PORT}/`,
    env: { PORT: String(PORT) },
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
