/**
 * WCAG 2.1 AAA Accessibility & Focus Trapping Test Suite
 *
 * Validates:
 * - Tab containment on last element (wraps to first)
 * - Shift+Tab wrapping on first element (wraps to last)
 * - Escape key dismissal with focus restoration to trigger element
 * - Automatic ARIA wiring (`aria-modal`, `role="dialog"` / `role="alertdialog"`, `aria-labelledby`, `aria-describedby`)
 * - Screen reader announcements for async actions (compilation, deployment, simulation)
 * - WCAG AAA 7:1 contrast token verification
 */

import React, { useRef, useState } from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import {
  useModalAccessibility,
  UseModalAccessibilityOptions,
} from "@/accessibility/useModalAccessibility";
import {
  ScreenReaderAnnouncer,
  useAnnouncer,
} from "@/accessibility/ScreenReaderAnnouncer";
import {
  createFocusTrap,
  cycleFocus,
  announceAsyncStatus,
  HIGH_CONTRAST_TOKENS,
  getContrastRatio,
  meetsWcagAaa,
  getHexLuminance,
} from "@/lib/accessibility";

describe("WCAG 2.1 AAA Focus Trapping & Modal Semantics", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  interface TestModalProps {
    defaultOpen?: boolean;
    options?: Partial<UseModalAccessibilityOptions>;
    customInitialFocus?: boolean;
    customReturnFocus?: boolean;
  }

  function ModalFixture({
    defaultOpen = false,
    options = {},
    customInitialFocus = false,
    customReturnFocus = false,
  }: TestModalProps) {
    const [open, setOpen] = useState(defaultOpen);
    const dialogRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const middleInputRef = useRef<HTMLInputElement>(null);

    useModalAccessibility(dialogRef, open, {
      onClose: () => setOpen(false),
      role: options.role,
      ariaLabelledBy: options.ariaLabelledBy,
      ariaDescribedBy: options.ariaDescribedBy,
      ariaLabel: options.ariaLabel,
      closeOnEscape: options.closeOnEscape,
      initialFocusRef: customInitialFocus ? middleInputRef : undefined,
      returnFocusRef: customReturnFocus ? triggerRef : undefined,
    });

    return (
      <div>
        <button
          ref={triggerRef}
          id="trigger-btn"
          onClick={() => setOpen(true)}
        >
          Open Modal
        </button>

        {open && (
          <div ref={dialogRef} data-testid="modal-container">
            <h2 id="modal-heading">Modal Title</h2>
            <p id="modal-desc">Modal description for screen readers</p>
            <button id="first-btn">First Button</button>
            <input
              ref={middleInputRef}
              id="middle-input"
              type="text"
              placeholder="Search..."
            />
            <button id="last-btn">Last Button</button>
          </div>
        )}
      </div>
    );
  }

  describe("Focus Trap Containment", () => {
    it("automatically focuses the first focusable element when modal opens", () => {
      render(<ModalFixture />);
      const trigger = screen.getByRole("button", { name: "Open Modal" });
      trigger.focus();
      expect(document.activeElement).toBe(trigger);

      fireEvent.click(trigger);

      const firstBtn = screen.getByRole("button", { name: "First Button" });
      expect(document.activeElement).toBe(firstBtn);
    });

    it("respects initialFocusRef when provided", () => {
      render(<ModalFixture customInitialFocus />);
      const trigger = screen.getByRole("button", { name: "Open Modal" });
      fireEvent.click(trigger);

      const middleInput = screen.getByPlaceholderText("Search...");
      expect(document.activeElement).toBe(middleInput);
    });

    it("wraps focus from last element to first element when pressing Tab", () => {
      render(<ModalFixture defaultOpen />);
      const firstBtn = screen.getByRole("button", { name: "First Button" });
      const lastBtn = screen.getByRole("button", { name: "Last Button" });

      lastBtn.focus();
      expect(document.activeElement).toBe(lastBtn);

      // Press Tab on the last element
      fireEvent.keyDown(lastBtn, { key: "Tab", shiftKey: false });

      // Focus should wrap back to the first focusable element
      expect(document.activeElement).toBe(firstBtn);
    });

    it("wraps focus from first element to last element when pressing Shift+Tab", () => {
      render(<ModalFixture defaultOpen />);
      const firstBtn = screen.getByRole("button", { name: "First Button" });
      const lastBtn = screen.getByRole("button", { name: "Last Button" });

      firstBtn.focus();
      expect(document.activeElement).toBe(firstBtn);

      // Press Shift+Tab on the first element
      fireEvent.keyDown(firstBtn, { key: "Tab", shiftKey: true });

      // Focus should wrap back to the last focusable element
      expect(document.activeElement).toBe(lastBtn);
    });

    it("pulls focus back into modal when an outside element receives focusin", () => {
      render(
        <div>
          <button id="outside-btn">Outside Control</button>
          <ModalFixture defaultOpen />
        </div>,
      );

      const outsideBtn = document.getElementById("outside-btn")!;
      const firstBtn = screen.getByRole("button", { name: "First Button" });

      // Attempt to focus outside element
      fireEvent.focusIn(outsideBtn);

      // Focus must be contained within the modal
      expect(document.activeElement).toBe(firstBtn);
    });

    it("cycles through elements sequentially with cycleFocus helper", () => {
      const container = document.createElement("div");
      container.innerHTML = `
        <button id="b1">Button 1</button>
        <button id="b2">Button 2</button>
        <button id="b3">Button 3</button>
      `;
      document.body.appendChild(container);

      const b1 = document.getElementById("b1")!;
      const b2 = document.getElementById("b2")!;
      const b3 = document.getElementById("b3")!;

      b1.focus();
      expect(document.activeElement).toBe(b1);

      // Cycle forward
      cycleFocus(container, false);
      expect(document.activeElement).toBe(b2);

      cycleFocus(container, false);
      expect(document.activeElement).toBe(b3);

      // Wrap forward to b1
      cycleFocus(container, false);
      expect(document.activeElement).toBe(b1);

      // Cycle backward
      cycleFocus(container, true);
      expect(document.activeElement).toBe(b3);
    });
  });

  describe("Escape Key Handler & Focus Restoration", () => {
    it("closes modal on Escape key press and restores focus to the trigger element", () => {
      render(<ModalFixture />);
      const trigger = screen.getByRole("button", { name: "Open Modal" });
      trigger.focus();
      expect(document.activeElement).toBe(trigger);

      fireEvent.click(trigger);
      expect(screen.getByTestId("modal-container")).toBeInTheDocument();

      // Press Escape while focused inside the modal
      fireEvent.keyDown(document.activeElement!, { key: "Escape" });

      // Modal should be closed
      expect(screen.queryByTestId("modal-container")).toBeNull();

      // Focus must return to the original trigger button
      expect(document.activeElement).toBe(trigger);
    });

    it("restores focus to explicit returnFocusRef after close", () => {
      render(<ModalFixture customReturnFocus />);
      const trigger = screen.getByRole("button", { name: "Open Modal" });
      fireEvent.click(trigger);

      fireEvent.keyDown(document.activeElement!, { key: "Escape" });
      expect(document.activeElement).toBe(trigger);
    });

    it("prevents modal dismissal when closeOnEscape is false", () => {
      render(<ModalFixture defaultOpen options={{ closeOnEscape: false }} />);
      const modal = screen.getByTestId("modal-container");
      expect(modal).toBeInTheDocument();

      fireEvent.keyDown(document.activeElement!, { key: "Escape" });
      expect(screen.getByTestId("modal-container")).toBeInTheDocument();
    });
  });

  describe("ARIA Semantics & Accessibility Attributes", () => {
    it("wires aria-modal='true', role='dialog', and labelledby/describedby attributes", () => {
      render(
        <ModalFixture
          defaultOpen
          options={{
            role: "dialog",
            ariaLabelledBy: "modal-heading",
            ariaDescribedBy: "modal-desc",
          }}
        />,
      );

      const modal = screen.getByTestId("modal-container");
      expect(modal).toHaveAttribute("role", "dialog");
      expect(modal).toHaveAttribute("aria-modal", "true");
      expect(modal).toHaveAttribute("aria-labelledby", "modal-heading");
      expect(modal).toHaveAttribute("aria-describedby", "modal-desc");
    });

    it("supports role='alertdialog' for confirmation and urgent prompts", () => {
      render(
        <ModalFixture
          defaultOpen
          options={{
            role: "alertdialog",
            ariaLabel: "Urgent Confirmation",
          }}
        />,
      );

      const modal = screen.getByTestId("modal-container");
      expect(modal).toHaveAttribute("role", "alertdialog");
      expect(modal).toHaveAttribute("aria-modal", "true");
      expect(modal).toHaveAttribute("aria-label", "Urgent Confirmation");
    });
  });

  describe("Screen Reader Announcements for Asynchronous Actions", () => {
    it("announces compilation lifecycle into polite and assertive live regions", () => {
      render(<ScreenReaderAnnouncer />);
      const politeRegion = document.getElementById("a11y-live-region")!;
      const assertiveRegion = document.getElementById("a11y-live-region-assertive")!;

      // 1. Pending compilation
      act(() => {
        announceAsyncStatus("compile", "pending");
        jest.advanceTimersByTime(60);
      });
      expect(politeRegion).toHaveTextContent("Compiling Soroban smart contract...");

      // 2. Compilation success
      act(() => {
        jest.advanceTimersByTime(1100);
        announceAsyncStatus("compile", "success", "12 functions exported, size: 24KB");
        jest.advanceTimersByTime(60);
      });
      expect(politeRegion).toHaveTextContent("Compilation succeeded: 12 functions exported, size: 24KB");

      // 3. Compilation error (assertive)
      act(() => {
        jest.advanceTimersByTime(1100);
        announceAsyncStatus("compile", "error", "mismatched types in contract entrypoint");
        jest.advanceTimersByTime(60);
      });
      expect(assertiveRegion).toHaveTextContent("Compilation failed: mismatched types in contract entrypoint");
    });

    it("announces contract deployment lifecycle correctly", () => {
      render(<ScreenReaderAnnouncer />);
      const politeRegion = document.getElementById("a11y-live-region")!;
      const assertiveRegion = document.getElementById("a11y-live-region-assertive")!;

      act(() => {
        announceAsyncStatus("deploy", "pending", "Testnet");
        jest.advanceTimersByTime(60);
      });
      expect(politeRegion).toHaveTextContent("Deploying contract to Testnet...");

      act(() => {
        jest.advanceTimersByTime(1100);
        announceAsyncStatus("deploy", "success", "CA7Q...4XYZ");
        jest.advanceTimersByTime(60);
      });
      expect(politeRegion).toHaveTextContent("Contract deployed successfully. Contract ID: CA7Q...4XYZ");

      act(() => {
        jest.advanceTimersByTime(1100);
        announceAsyncStatus("deploy", "error", "Insufficient balance for transaction fee");
        jest.advanceTimersByTime(60);
      });
      expect(assertiveRegion).toHaveTextContent("Deployment failed: Insufficient balance for transaction fee");
    });

    it("announces contract simulation status correctly", () => {
      render(<ScreenReaderAnnouncer />);
      const politeRegion = document.getElementById("a11y-live-region")!;

      act(() => {
        announceAsyncStatus("simulate", "pending", "transfer_tokens");
        jest.advanceTimersByTime(60);
      });
      expect(politeRegion).toHaveTextContent("Simulating transfer_tokens on-chain...");

      act(() => {
        jest.advanceTimersByTime(1100);
        announceAsyncStatus("simulate", "success", "Return value: ok, CPU: 42k instructions");
        jest.advanceTimersByTime(60);
      });
      expect(politeRegion).toHaveTextContent("Simulation succeeded: Return value: ok, CPU: 42k instructions");
    });

    it("provides ergonomic announcements via useAnnouncer hook", () => {
      function AnnouncerComponent() {
        const { announcePolite, announceAssertive } = useAnnouncer();
        return (
          <div>
            <button onClick={() => announcePolite("Polite status update")}>
              Polite Action
            </button>
            <button onClick={() => announceAssertive("Critical alert update")}>
              Alert Action
            </button>
          </div>
        );
      }

      render(
        <>
          <ScreenReaderAnnouncer />
          <AnnouncerComponent />
        </>,
      );

      const politeRegion = document.getElementById("a11y-live-region")!;
      const assertiveRegion = document.getElementById("a11y-live-region-assertive")!;

      act(() => {
        fireEvent.click(screen.getByRole("button", { name: "Polite Action" }));
        jest.advanceTimersByTime(60);
      });
      expect(politeRegion).toHaveTextContent("Polite status update");

      act(() => {
        fireEvent.click(screen.getByRole("button", { name: "Alert Action" }));
        jest.advanceTimersByTime(60);
      });
      expect(assertiveRegion).toHaveTextContent("Critical alert update");
    });
  });

  describe("High-Contrast Ratio Compliance (WCAG 2.1 AAA >= 7:1)", () => {
    it("verifies relative luminance and contrast ratio calculations match WCAG formulas", () => {
      // Pure white (#ffffff) on pure black (#000000) is 21:1
      expect(getContrastRatio("#ffffff", "#000000")).toBe(21);
      // Pure black on pure white is 21:1
      expect(getContrastRatio("#000000", "#ffffff")).toBe(21);
      // Identical colors have ratio 1:1
      expect(getContrastRatio("#ffffff", "#ffffff")).toBe(1);

      // Relative luminance
      expect(getHexLuminance("#ffffff")).toBeCloseTo(1.0, 2);
      expect(getHexLuminance("#000000")).toBeCloseTo(0.0, 2);
    });

    it("confirms dark mode text and control tokens reach WCAG AAA (7:1) contrast", () => {
      const dark = HIGH_CONTRAST_TOKENS.dark;

      // Primary text against dark surface
      expect(getContrastRatio(dark.textPrimary, dark.background)).toBeGreaterThanOrEqual(7.0);
      expect(meetsWcagAaa(dark.textPrimary, dark.background)).toBe(true);

      // Secondary text against dark surface
      expect(getContrastRatio(dark.textSecondary, dark.background)).toBeGreaterThanOrEqual(7.0);
      expect(meetsWcagAaa(dark.textSecondary, dark.background)).toBe(true);

      // Muted text against dark surface
      expect(getContrastRatio(dark.textMuted, dark.background)).toBeGreaterThanOrEqual(7.0);
      expect(meetsWcagAaa(dark.textMuted, dark.background)).toBe(true);

      // Interactive control buttons
      expect(getContrastRatio(dark.buttonPrimaryFg, dark.buttonPrimaryBg)).toBeGreaterThanOrEqual(7.0);
      expect(getContrastRatio(dark.buttonDangerFg, dark.buttonDangerBg)).toBeGreaterThanOrEqual(7.0);
    });

    it("confirms light mode text and control tokens reach WCAG AAA (7:1) contrast", () => {
      const light = HIGH_CONTRAST_TOKENS.light;

      // Primary text against light surface
      expect(getContrastRatio(light.textPrimary, light.background)).toBeGreaterThanOrEqual(7.0);
      expect(meetsWcagAaa(light.textPrimary, light.background)).toBe(true);

      // Secondary text against light surface
      expect(getContrastRatio(light.textSecondary, light.background)).toBeGreaterThanOrEqual(7.0);
      expect(meetsWcagAaa(light.textSecondary, light.background)).toBe(true);

      // Muted text against light surface
      expect(getContrastRatio(light.textMuted, light.background)).toBeGreaterThanOrEqual(7.0);
      expect(meetsWcagAaa(light.textMuted, light.background)).toBe(true);

      // Interactive control buttons
      expect(getContrastRatio(light.buttonPrimaryFg, light.buttonPrimaryBg)).toBeGreaterThanOrEqual(7.0);
      expect(getContrastRatio(light.buttonDangerFg, light.buttonDangerBg)).toBeGreaterThanOrEqual(7.0);
    });
  });
});
