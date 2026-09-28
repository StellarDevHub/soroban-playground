// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Layout transitions and content cross-fades (issue #1529).
 *
 * A panel swapping from a skeleton to real content, or one route replacing
 * another, is the most jarring moment in a data-heavy UI: the block jumps, the
 * eye loses its anchor. `LayoutTransition` wraps that swap so the incoming
 * block animates into place with a short, GPU-friendly transform/opacity pair.
 *
 * Implemented with CSS custom properties rather than an animation library so:
 *  - there is no extra dependency to install or keep in sync;
 *  - the animations live next to the design tokens in `globals.css`;
 *  - `prefers-reduced-motion` disables them wholesale.
 */

import React, { useEffect, useRef, useState } from "react";

export type TransitionVariant =
  /** Fade + 4px rise. The default for content arriving in place. */
  | "enter"
  /** Fade + slight scale-up. For modals and the command palette. */
  | "pop"
  /** Opacity only. For lists whose height must not shift. */
  | "fade"
  /** Staggered rise for each direct child. For card grids. */
  | "stagger";

export interface LayoutTransitionProps {
  variant?: TransitionVariant;
  /** Re-key the animation when this changes (e.g. the loaded payload). */
  transitionKey?: string | number;
  className?: string;
  children: React.ReactNode;
  as?: "div" | "section" | "article" | "aside" | "ul";
}

const VARIANT_CLASS: Record<TransitionVariant, string> = {
  enter: "layout-enter",
  pop: "layout-pop",
  fade: "layout-fade",
  stagger: "layout-stagger",
};

/**
 * Animates its children whenever `transitionKey` changes, and on mount.
 *
 * The "entering" flag is cleared on the next animation frame rather than on
 * `animationend`, so a child that is `display: none` (or never animates because
 * the user asked for reduced motion) cannot strand the wrapper in its
 * pre-animation state.
 */
export function LayoutTransition({
  variant = "enter",
  transitionKey,
  className = "",
  children,
  as = "div",
}: LayoutTransitionProps) {
  const [active, setActive] = useState(true);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    setActive(false);
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      setActive(true);
    });
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [transitionKey]);

  const Element = as;

  return (
    <Element
      data-layout-transition={variant}
      data-animating={active ? "true" : "false"}
      className={[VARIANT_CLASS[variant], className].filter(Boolean).join(" ")}
    >
      {children}
    </Element>
  );
}

export default LayoutTransition;
