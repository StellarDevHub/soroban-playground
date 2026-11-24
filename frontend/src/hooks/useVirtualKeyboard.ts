"use client";

/**
 * useVirtualKeyboard
 *
 * Tracks whether the mobile soft keyboard is open and how much vertical space
 * it has consumed using the Visual Viewport API.
 *
 * The hook:
 *   1. Computes `keyboardHeight` as the difference between `window.innerHeight`
 *      (the layout viewport, unchanged when the keyboard appears) and
 *      `window.visualViewport.height` (which shrinks when the keyboard opens).
 *   2. Writes the value back to the CSS custom property
 *      `--keyboard-inset-height` on `document.documentElement` so CSS
 *      calc() expressions (like `.editor-mobile-height`) can consume it.
 *   3. Sets `data-keyboard-open` on `<body>` for CSS state hooks.
 *
 * Returns `{ keyboardHeight, isOpen }` where:
 *   • `keyboardHeight` — pixels consumed by the keyboard (0 when closed)
 *   • `isOpen`         — boolean convenience flag
 *
 * Falls back gracefully when the Visual Viewport API is unavailable (desktop,
 * jsdom, older browsers).
 */

import { useEffect, useRef, useState } from "react";

export interface VirtualKeyboardState {
  keyboardHeight: number;
  isOpen: boolean;
}

const KEYBOARD_THRESHOLD_PX = 150;

export function useVirtualKeyboard(): VirtualKeyboardState {
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const vvp =
      typeof window !== "undefined" ? window.visualViewport : undefined;

    if (!vvp) {
      return;
    }

    const update = () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = requestAnimationFrame(() => {
        const height = Math.max(
          0,
          window.innerHeight - (vvp.height + vvp.offsetTop),
        );
        setKeyboardHeight(height);

        // Update CSS custom property so layout can be driven from CSS.
        document.documentElement.style.setProperty(
          "--keyboard-inset-height",
          `${height}px`,
        );

        // Record the current visual viewport height for the CSS body rule.
        document.documentElement.style.setProperty(
          "--visual-vp-height",
          `${vvp.height}px`,
        );

        // Toggle body attribute for CSS state selectors.
        const isKeyboardOpen = height > KEYBOARD_THRESHOLD_PX;
        document.body.toggleAttribute("data-keyboard-open", isKeyboardOpen);
        document.body.classList.toggle("keyboard-visible", isKeyboardOpen);
      });
    };

    vvp.addEventListener("resize", update);
    // Also fire once on mount so SSR-hydrated values are correct.
    update();

    return () => {
      vvp.removeEventListener("resize", update);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      // Reset CSS state on unmount.
      document.documentElement.style.removeProperty("--keyboard-inset-height");
      document.documentElement.style.removeProperty("--visual-vp-height");
      document.body.removeAttribute("data-keyboard-open");
      document.body.classList.remove("keyboard-visible");
    };
  }, []);

  return { keyboardHeight, isOpen: keyboardHeight > KEYBOARD_THRESHOLD_PX };
}
