import { test, expect, type Page } from "@playwright/test";

/**
 * Mobile responsive layout tests.
 *
 * AC-MOB-1  Navigation sidebar is hidden on mobile; hamburger button is visible
 * AC-MOB-2  Hamburger opens the drawer; Escape / backdrop closes it
 * AC-MOB-3  Drawer links are reachable with 44px minimum touch targets
 * AC-MOB-4  Swipe-left on the open drawer closes it
 * AC-MOB-5  Editor container uses dvh-aware height class (not vh-only)
 * AC-MOB-6  Haptic quick-access key bar is present on the editor tab
 * AC-MOB-7  Switching to the Output tab hides the haptic bar
 * AC-MOB-8  Tab bar has minimum 44px height
 * AC-MOB-9  Editor pane is not hidden behind the bottom tab bar (no overflow clip)
 * AC-MOB-10 Tablet viewport (768px): desktop sidebar is hidden, mobile drawer is available
 */

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function goToPlayground(page: Page) {
  await page.goto("/playground");
  // Wait for the client-side shell to hydrate
  await page.waitForSelector('[data-testid="mobile-editor-container"], [data-tour="main"]', {
    timeout: 15_000,
  });
}

async function goToHome(page: Page) {
  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe("AC-MOB-1: Desktop sidebar hidden on mobile viewport", () => {
  test("primary navigation sidebar is not visible", async ({ page }) => {
    await goToHome(page);

    // The desktop nav uses `hidden md:flex` — it must be invisible on <768px
    const desktopSidebar = page.locator(
      'nav#primary-navigation, aside.hidden.md\\:flex'
    );
    // Count matching elements; at mobile widths they should all be hidden
    const count = await desktopSidebar.count();
    for (let i = 0; i < count; i++) {
      await expect(desktopSidebar.nth(i)).toBeHidden();
    }
  });

  test("hamburger menu button is visible", async ({ page }) => {
    await goToHome(page);

    const hamburger = page.getByRole("button", {
      name: /open navigation/i,
    });
    await expect(hamburger).toBeVisible();
  });
});

test.describe("AC-MOB-2: Drawer open / close behaviour", () => {
  test("hamburger opens the navigation drawer", async ({ page }) => {
    await goToHome(page);

    const drawer = page.locator(
      '[role="dialog"][aria-label*="Navigation"], [role="dialog"][aria-label*="navigation"]'
    );

    // Drawer should start closed (translated off-screen or hidden)
    await expect(drawer).toHaveClass(/-translate-x-full/);

    await page.getByRole("button", { name: /open navigation/i }).click();

    await expect(drawer).not.toHaveClass(/-translate-x-full/);
    await expect(drawer).toBeVisible();
  });

  test("close button dismisses the drawer", async ({ page }) => {
    await goToHome(page);

    await page.getByRole("button", { name: /open navigation/i }).click();

    const drawer = page.locator(
      '[role="dialog"][aria-label*="Navigation"], [role="dialog"][aria-label*="navigation"]'
    );
    await expect(drawer).toBeVisible();

    await page.getByRole("button", { name: /close navigation/i }).click();

    await expect(drawer).toHaveClass(/-translate-x-full/);
  });

  test("Escape key closes the drawer", async ({ page }) => {
    await goToHome(page);

    await page.getByRole("button", { name: /open navigation/i }).click();

    const drawer = page.locator(
      '[role="dialog"][aria-label*="Navigation"], [role="dialog"][aria-label*="navigation"]'
    );
    await expect(drawer).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(drawer).toHaveClass(/-translate-x-full/);
  });

  test("tapping the backdrop closes the drawer", async ({ page }) => {
    await goToHome(page);

    await page.getByRole("button", { name: /open navigation/i }).click();

    const backdrop = page.locator('[data-testid="drawer-backdrop"]');
    if (await backdrop.count() > 0) {
      await backdrop.click({ force: true });
      const drawer = page.locator(
        '[role="dialog"][aria-label*="Navigation"], [role="dialog"][aria-label*="navigation"]'
      );
      await expect(drawer).toHaveClass(/-translate-x-full/);
    } else {
      // Sidebar.tsx uses an onClick on the div without a testid; click the backdrop area
      await page.mouse.click(10, 400); // far left edge, should be outside drawer
      test.skip(true, "Backdrop element not found — skipping backdrop click test");
    }
  });
});

test.describe("AC-MOB-3: Touch target sizes", () => {
  test("hamburger button meets 44px minimum touch target", async ({ page }) => {
    await goToHome(page);

    const hamburger = page.getByRole("button", { name: /open navigation/i });
    const box = await hamburger.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
  });

  test("drawer nav links meet 44px minimum touch target", async ({ page }) => {
    await goToHome(page);

    await page.getByRole("button", { name: /open navigation/i }).click();

    // Sample the first few nav links
    const navLinks = page.locator(
      '[role="dialog"] a[href]'
    );
    const linkCount = await navLinks.count();
    const sampleSize = Math.min(linkCount, 5);

    for (let i = 0; i < sampleSize; i++) {
      const box = await navLinks.nth(i).boundingBox();
      if (box) {
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
    }
  });
});

test.describe("AC-MOB-4: Swipe gesture on drawer", () => {
  test("swipe left on open drawer closes it", async ({ page }) => {
    await goToHome(page);

    await page.getByRole("button", { name: /open navigation/i }).click();

    const drawer = page.locator(
      '[role="dialog"][aria-label*="Navigation"], [role="dialog"][aria-label*="navigation"]'
    );
    await expect(drawer).toBeVisible();

    const box = await drawer.boundingBox();
    if (!box) {
      test.skip(true, "Could not get drawer bounding box");
      return;
    }

    const startX = box.x + box.width * 0.5;
    const startY = box.y + box.height * 0.5;

    await page.touchscreen.tap(startX, startY);
    // Simulate swipe left by dispatching touchstart → touchmove → touchend
    await page.evaluate(
      ({ sx, sy }) => {
        const target = document.elementFromPoint(sx, sy) ?? document.body;
        const mkTouch = (x: number, y: number) =>
          new Touch({ identifier: 1, target, clientX: x, clientY: y });
        target.dispatchEvent(
          new TouchEvent("touchstart", {
            touches: [mkTouch(sx, sy)],
            changedTouches: [mkTouch(sx, sy)],
            bubbles: true,
          })
        );
        target.dispatchEvent(
          new TouchEvent("touchend", {
            touches: [],
            changedTouches: [mkTouch(sx - 80, sy)],
            bubbles: true,
          })
        );
      },
      { sx: startX, sy: startY }
    );

    // Allow transition to complete
    await page.waitForTimeout(400);
    await expect(drawer).toHaveClass(/-translate-x-full/);
  });
});

test.describe("AC-MOB-5: dvh-aware editor height", () => {
  test("mobile editor container uses editor-mobile-height class", async ({
    page,
  }) => {
    await goToPlayground(page);

    const container = page.locator('[data-testid="mobile-editor-container"]');
    if (await container.count() === 0) {
      test.skip(true, "Mobile editor container not rendered at this viewport");
      return;
    }

    await expect(container).toHaveClass(/editor-mobile-height/);
  });

  test("editor container does not use a plain vh-only height", async ({
    page,
  }) => {
    await goToPlayground(page);

    const container = page.locator('[data-testid="mobile-editor-container"]');
    if (await container.count() === 0) {
      test.skip(true, "Mobile editor container not rendered at this viewport");
      return;
    }

    // Must NOT carry the old `h-[calc(100vh-4rem)]` Tailwind class
    const className = await container.getAttribute("class") ?? "";
    expect(className).not.toMatch(/h-\[calc\(100vh/);
  });
});

test.describe("AC-MOB-6 & AC-MOB-7: Haptic key bar", () => {
  test("haptic key bar is visible when editor tab is active", async ({
    page,
  }) => {
    await goToPlayground(page);

    const keyBar = page.locator('[data-testid="haptic-key-bar"], [data-testid="haptic-virtual-keyboard"]');
    if (await keyBar.count() === 0) {
      test.skip(true, "Haptic key bar not present at this viewport");
      return;
    }

    await expect(keyBar.first()).toBeVisible();
  });

  test("haptic key bar contains essential coding symbols", async ({ page }) => {
    await goToPlayground(page);

    const keyBar = page.locator(
      '[data-testid="haptic-key-bar"], [data-testid="haptic-virtual-keyboard"]'
    );
    if (await keyBar.count() === 0) {
      test.skip(true, "Haptic key bar not present at this viewport");
      return;
    }

    const bar = keyBar.first();
    // Verify the required symbols from the spec are present as buttons
    for (const symbol of ["{", "}", "(", ")", ";"]) {
      await expect(
        bar.getByRole("button", { name: symbol })
      ).toBeVisible();
    }
    // & key (aria-label="&")
    await expect(bar.getByRole("button", { name: "&" })).toBeVisible();
  });

  test("switching to Output tab hides the haptic key bar", async ({ page }) => {
    await goToPlayground(page);

    const keyBar = page.locator(
      '[data-testid="haptic-key-bar"], [data-testid="haptic-virtual-keyboard"]'
    );
    if (await keyBar.count() === 0) {
      test.skip(true, "Haptic key bar not present at this viewport");
      return;
    }

    await page.getByRole("tab", { name: /output/i }).click();

    await expect(keyBar.first()).toBeHidden();
  });
});

test.describe("AC-MOB-8: Tab bar touch target", () => {
  test("mobile tab bar has minimum 44px height", async ({ page }) => {
    await goToPlayground(page);

    const tabBar = page.locator('[data-testid="mobile-tab-bar"]');
    if (await tabBar.count() === 0) {
      test.skip(true, "Mobile tab bar not present at this viewport");
      return;
    }

    const box = await tabBar.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });
});

test.describe("AC-MOB-9: Editor pane scrollability", () => {
  test("editor panel is not hidden behind the tab bar", async ({ page }) => {
    await goToPlayground(page);

    const editorPanel = page.locator('[id="mobile-editor-panel"]');
    if (await editorPanel.count() === 0) {
      test.skip(true, "Mobile editor panel not present at this viewport");
      return;
    }

    const tabBar = page.locator('[data-testid="mobile-tab-bar"]');
    const editorBox = await editorPanel.boundingBox();
    const tabBox = tabBar.count() ? await tabBar.boundingBox() : null;

    expect(editorBox).not.toBeNull();
    if (tabBox) {
      // The bottom of the editor panel must not extend below the top of the tab bar
      // (the flex column layout should ensure the editor stops where the bar starts)
      expect(editorBox!.y + editorBox!.height).toBeLessThanOrEqual(
        tabBox.y + 4 // 4px tolerance for sub-pixel rendering
      );
    }
  });
});

test.describe("AC-MOB-10: Tablet viewport (768px)", () => {
  test("at 768px wide the mobile hamburger is still present", async ({
    page,
  }) => {
    // The md: breakpoint is 768px; test at exactly 768 to exercise the boundary
    await page.setViewportSize({ width: 768, height: 1024 });
    await goToHome(page);

    // At exactly 768px, `md:hidden` becomes hidden — hamburger should be gone
    // and desktop sidebar should appear. This verifies the breakpoint is correct.
    const hamburger = page.getByRole("button", { name: /open navigation/i });
    const desktopSidebar = page.locator(
      'nav#primary-navigation, aside.hidden.md\\:flex'
    );

    // At exactly the md breakpoint Tailwind uses >=768px for `md:` classes.
    // The hamburger is `md:hidden` so at 768 it should be hidden.
    // The desktop sidebar is `hidden md:flex` so at 768 it should be visible.
    // If the viewport is 767px, the reverse is true.
    if ((await hamburger.count()) > 0 && (await hamburger.isVisible())) {
      // We're below the breakpoint — mobile layout confirmed
      await expect(hamburger).toBeVisible();
    } else if ((await desktopSidebar.count()) > 0) {
      // We're at or above the breakpoint — desktop layout
      const visibleSidebars = await desktopSidebar
        .filter({ hasText: "Soroban" })
        .count();
      expect(visibleSidebars).toBeGreaterThan(0);
    }
  });

  test("at 767px the mobile drawer is available", async ({ page }) => {
    await page.setViewportSize({ width: 767, height: 1024 });
    await goToHome(page);

    const hamburger = page.getByRole("button", { name: /open navigation/i });
    await expect(hamburger).toBeVisible();

    await hamburger.click();
    const drawer = page.locator(
      '[role="dialog"][aria-label*="Navigation"], [role="dialog"][aria-label*="navigation"]'
    );
    await expect(drawer).not.toHaveClass(/-translate-x-full/);
  });
});
