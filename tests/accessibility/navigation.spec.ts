import { expect, test, type Page, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import routes from "./routes.json";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("render_warning_seen", "true");
    localStorage.setItem("sp:theme", "dark");
    localStorage.setItem(
      "soroban.playground.onboarding.v1",
      JSON.stringify({ completed: true, dismissed: true, step: 0 }),
    );
  });
  // No build/deploy/wallet operation in these tests reaches a real backend.
  await page.route("https://soroban-playground.onrender.com/**", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "Offline accessibility fixture" }),
    }),
  );
});
async function scan(page: Page, info: TestInfo) {
  await expect(page.locator("#main-content")).toBeAttached();
  // Polling network panels never become network-idle; wait for rendered content.
  await expect(page.locator("#main-content")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const result = await new AxeBuilder({ page }).analyze();
  await info.attach("axe-results", {
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  });
  expect(
    result.violations.map(({ id, nodes }) => ({
      id,
      targets: nodes.map((node) => node.target),
    })),
  ).toEqual([]);
}
for (const route of routes) {
  test(`axe full-page audit ${route}`, async ({ page }, info) => {
    await page.goto(route);
    await scan(page, info);
  });
}
test("skip links move focus and keyboard focus remains visible", async ({
  page,
}) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const first = page.getByRole("link", {
    name: "Skip to main content",
    exact: true,
  });
  await expect(first).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
  const focus = await page.locator("#main-content").evaluate((element) => ({
    width: getComputedStyle(element).outlineWidth,
    style: getComputedStyle(element).outlineStyle,
  }));
  expect(parseFloat(focus.width)).toBeGreaterThanOrEqual(3);
  expect(focus.style).toBe("solid");
});
test("warming dialog contains Tab and Shift+Tab and closes with Escape", async ({
  page,
}, info) => {
  await page.addInitScript(() =>
    sessionStorage.removeItem("render_warning_seen"),
  );
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "Backend Warming Up" });
  await expect(dialog).toBeVisible();
  const buttons = dialog.getByRole("button");
  await buttons.last().focus();
  await page.keyboard.press("Tab");
  await expect(buttons.first()).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(buttons.last()).toBeFocused();
  await scan(page, info);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
// Issue #1725 — Cmd/Ctrl+K now opens the Spotlight palette; the classic
// #1527 "command search" palette moved to bare "/" (covered below).
test("spotlight palette contains focus and restores its previous control", async ({
  page,
}, info) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Compile", exact: true });
  await trigger.focus();
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", {
    name: "Spotlight command palette",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  const input = dialog.getByRole("combobox");
  await expect(input).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  expect(
    await dialog.evaluate((element) =>
      element.contains(document.activeElement),
    ),
  ).toBe(true);
  // Arrow-key navigation walks the painted order, mouse-free.
  await page.keyboard.press("ArrowDown");
  await expect(input).toHaveAttribute(
    "aria-activedescendant",
    /spotlight-option-/,
  );
  await scan(page, info);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});
test("classic command search still opens on slash and traps focus", async ({
  page,
}) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Compile", exact: true });
  await trigger.focus();
  await page.keyboard.press("/");
  const dialog = page.getByRole("dialog", {
    name: "Command palette",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("combobox")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});
test("mobile navigation has a trapped keyboard cycle and restores its opener", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  const trigger = page.getByRole("button", {
    name: "Open navigation menu",
    exact: true,
  });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Navigation menu" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Shift+Tab");
  expect(
    await dialog.evaluate((element) =>
      element.contains(document.activeElement),
    ),
  ).toBe(true);
  await scan(page, info);
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});
test("build and deployment outcomes reach live regions without moving keyboard focus", async ({
  page,
}) => {
  await page.route("**/api/compile", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        message: "Compiled",
        artifact: { name: "contract.wasm", sizeBytes: 1024 },
        logs: [],
      }),
    }),
  );
  await page.route("**/api/deploy", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        message: "Deployed",
        contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
        network: "testnet",
        deployedAt: new Date().toISOString(),
      }),
    }),
  );
  await page.route("**/api/deploy/preflight", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ready: true,
        sourceAccount: "deploy",
        deployer: "GTEST",
        contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
        wasmHash: "a".repeat(64),
        codeStatus: "live",
        checkedAt: Date.now(),
        elapsedMs: 10,
        funding: {
          reserveStroops: "10000000",
          availableStroops: "100000000",
          feeStroops: "100",
        },
        checks: [{ id: "network", label: "Network verified", passed: true }],
        warnings: [],
      }),
    }),
  );
  await page.goto("/");
  const compile = page.getByRole("button", { name: "Compile", exact: true });
  await compile.click();
  await expect(page.locator("#a11y-live-region")).toContainText(
    "Compilation succeeded",
  );
  const deploy = page.getByRole("button", {
    name: /^Deploy to /,
  });
  await page
    .getByRole("button", { name: "Generate salt", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Run pre-flight checks", exact: true })
    .click();
  await expect(deploy).toHaveAttribute("aria-disabled", "false");
  await deploy.click();
  await expect(page.locator("#a11y-live-region")).toContainText(
    "Deployment succeeded on testnet",
  );
  await expect(deploy).toBeFocused();
  await page.route("**/api/compile", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ message: "Compile fixture failure" }),
    }),
  );
  await compile.click();
  await expect(page.locator("#a11y-live-region-assertive")).toContainText(
    "Compilation failed",
  );
});
for (const route of ["/", "/template-library", "/wallet-management"]) {
  test(`light theme accessibility ${route}`, async ({ page }, info) => {
    await page.addInitScript(() => localStorage.setItem("sp:theme", "light"));
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(route);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await scan(page, info);
  });
}
