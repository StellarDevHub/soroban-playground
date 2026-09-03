import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end test configuration for the Soroban Playground (issue #1348).
 *
 * These tests validate the full lifecycle against a live Soroban RPC
 * (a `stellar/quickstart` Standalone container in CI):
 *   backend health -> compile -> deploy -> invoke.
 *
 * The RPC URL and a Funded account secret for the Friendbot-funded test wallet
 * are supplied via env (set by `.github/workflows/e2e.yml`).
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: process.env.E2E_FRONTEND_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
});