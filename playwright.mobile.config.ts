import { defineConfig, devices } from "@playwright/test";

/**
 * Mobile viewport tests for the Soroban Playground responsive layout.
 *
 * Run with:
 *   npx playwright test --config playwright.mobile.config.ts
 *
 * These tests verify:
 *   • The navigation drawer collapses / renders correctly on small viewports
 *   • The editor pane uses dvh-aware height so the soft keyboard does not obscure code
 *   • The haptic quick-access key bar is visible on mobile
 *   • Core interactions (open/close drawer, tab switching) work at 375px and 768px
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["**/mobile-layout.spec.ts"],
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.E2E_FRONTEND_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "Mobile Chrome (375px)",
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 375, height: 812 },
      },
    },
    {
      name: "Mobile Safari (390px)",
      use: {
        ...devices["iPhone 14"],
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: "Tablet (768px)",
      use: {
        ...devices["iPad Mini"],
        viewport: { width: 768, height: 1024 },
      },
    },
  ],
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : "list",
});
