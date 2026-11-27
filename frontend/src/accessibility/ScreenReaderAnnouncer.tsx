"use client";

import {
  announceToScreenReader,
  announceAsyncStatus,
  type Politeness,
  type AsyncActionType,
  type AsyncActionState,
} from "@/lib/accessibility";

/**
 * React hook to dispatch live screen reader announcements into stable polite or assertive regions.
 */
export function useAnnouncer() {
  return {
    announce: (message: string, politeness: Politeness = "polite") => {
      announceToScreenReader(message, politeness);
    },
    announcePolite: (message: string) => {
      announceToScreenReader(message, "polite");
    },
    announceAssertive: (message: string) => {
      announceToScreenReader(message, "assertive");
    },
    announceAsync: (
      action: AsyncActionType,
      state: AsyncActionState,
      details?: string,
    ) => {
      announceAsyncStatus(action, state, details);
    },
  };
}

/**
 * Root Screen Reader Announcer.
 *
 * Renders stable ARIA live regions:
 * - `#a11y-live-region` with `role="status"`, `aria-live="polite"`, `aria-atomic="true"`
 * - `#a11y-live-region-assertive` with `role="alert"`, `aria-live="assertive"`, `aria-atomic="true"`
 */
export function ScreenReaderAnnouncer() {
  return (
    <>
      <div
        id="a11y-live-region"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      />
      <div
        id="a11y-live-region-assertive"
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
      />
    </>
  );
}
