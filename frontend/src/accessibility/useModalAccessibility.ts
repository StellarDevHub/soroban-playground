"use client";

import { useEffect, useRef, type RefObject } from "react";
import { createFocusTrap, FocusTrapOptions } from "@/lib/accessibility";

export interface UseModalAccessibilityOptions {
  onClose?: () => void;
  role?: "dialog" | "alertdialog";
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  ariaLabel?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
  closeOnEscape?: boolean;
}

/**
 * Enterprise WCAG 2.1 AAA Modal Accessibility Hook.
 *
 * Provides:
 * 1. Complete focus trapping inside modal dialogs (Tab cycles through focusable elements, Shift+Tab cycles backward).
 * 2. Background inert isolation of siblings to prevent keyboard and screen reader leaks.
 * 3. Escape key dismissal with focus restoration to the trigger element (`previousActiveElement` or `returnFocusRef`).
 * 4. Automatic ARIA attributes wiring (`aria-modal="true"`, `role="dialog"` / `role="alertdialog"`, `aria-labelledby`, `aria-describedby`).
 * 5. Full restoration of previous tabindex and cleanup on unmount.
 */
export function useModalAccessibility(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  onCloseOrOptions?: (() => void) | UseModalAccessibilityOptions,
) {
  const options: UseModalAccessibilityOptions =
    typeof onCloseOrOptions === "function"
      ? { onClose: onCloseOrOptions }
      : (onCloseOrOptions ?? {});

  const close = useRef(options.onClose);
  close.current = options.onClose;

  const role = options.role ?? "dialog";
  const ariaLabelledBy = options.ariaLabelledBy;
  const ariaDescribedBy = options.ariaDescribedBy;
  const ariaLabel = options.ariaLabel;
  const closeOnEscape = options.closeOnEscape !== false;
  const initialFocusRef = options.initialFocusRef;
  const returnFocusRef = options.returnFocusRef;

  useEffect(() => {
    const container = ref.current;
    if (!open || !container) return;

    // 1. Accessibility attributes wiring
    const previousAttributes = {
      role: container.getAttribute("role"),
      ariaModal: container.getAttribute("aria-modal"),
      ariaLabelledBy: container.getAttribute("aria-labelledby"),
      ariaDescribedBy: container.getAttribute("aria-describedby"),
      ariaLabel: container.getAttribute("aria-label"),
    };

    if (!container.hasAttribute("role")) {
      container.setAttribute("role", role);
    }
    if (!container.hasAttribute("aria-modal")) {
      container.setAttribute("aria-modal", "true");
    }
    if (ariaLabelledBy && !container.hasAttribute("aria-labelledby")) {
      container.setAttribute("aria-labelledby", ariaLabelledBy);
    }
    if (ariaDescribedBy && !container.hasAttribute("aria-describedby")) {
      container.setAttribute("aria-describedby", ariaDescribedBy);
    }
    if (ariaLabel && !container.hasAttribute("aria-label")) {
      container.setAttribute("aria-label", ariaLabel);
    }

    // 2. Initialize Focus Trap with options
    const trapOptions: FocusTrapOptions = {
      initialFocus: initialFocusRef?.current,
      returnFocus: returnFocusRef?.current,
    };
    const trap = createFocusTrap(container, trapOptions);

    // 3. Escape key listener for keyboard dismissal
    const escape = (event: KeyboardEvent) => {
      if (!closeOnEscape || event.key !== "Escape" || event.defaultPrevented) return;

      const active = document.activeElement;
      const target = event.target as Node | Window | Document | null;
      const isInside =
        target === window ||
        target === document ||
        target === document.body ||
        !target ||
        (target instanceof Node && container.contains(target)) ||
        (active && container.contains(active)) ||
        active === container ||
        active === document.body;

      if (isInside && close.current) {
        event.preventDefault();
        event.stopPropagation();
        close.current();
      }
    };

    container.addEventListener("keydown", escape);
    window.addEventListener("keydown", escape);

    return () => {
      container.removeEventListener("keydown", escape);
      window.removeEventListener("keydown", escape);

      // Clean up attributes that were set by this hook
      if (previousAttributes.role === null) container.removeAttribute("role");
      if (previousAttributes.ariaModal === null) container.removeAttribute("aria-modal");
      if (previousAttributes.ariaLabelledBy === null && ariaLabelledBy) container.removeAttribute("aria-labelledby");
      if (previousAttributes.ariaDescribedBy === null && ariaDescribedBy) container.removeAttribute("aria-describedby");
      if (previousAttributes.ariaLabel === null && ariaLabel) container.removeAttribute("aria-label");

      trap.release();
    };
  }, [
    open,
    ref,
    role,
    ariaLabelledBy,
    ariaDescribedBy,
    ariaLabel,
    closeOnEscape,
    initialFocusRef,
    returnFocusRef,
  ]);
}
