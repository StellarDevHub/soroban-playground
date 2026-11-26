"use client";

import React, { useEffect, useState, useCallback } from "react";

// ============================================================================
// Font Scaling & Gesture Constants and Utilities
// ============================================================================

export const DEFAULT_EDITOR_FONT_SIZE = 14;
export const MIN_EDITOR_FONT_SIZE = 10;
export const MAX_EDITOR_FONT_SIZE = 28;

export function clampEditorFontSize(fontSize: number): number {
  if (!Number.isFinite(fontSize)) return DEFAULT_EDITOR_FONT_SIZE;
  return Math.min(MAX_EDITOR_FONT_SIZE, Math.max(MIN_EDITOR_FONT_SIZE, fontSize));
}

export function calculatePinchFontSize(
  initialFontSize: number,
  initialDistance: number,
  currentDistance: number,
): number {
  if (initialDistance <= 0 || currentDistance <= 0) {
    return clampEditorFontSize(initialFontSize);
  }

  return clampEditorFontSize(
    Math.round((initialFontSize * currentDistance) / initialDistance),
  );
}

// ============================================================================
// Visual Viewport & Virtual Mobile Keyboard Optimization
// ============================================================================

export interface VisualViewportState {
  viewportHeight: number;
  viewportWidth: number;
  offsetTop: number;
  offsetLeft: number;
  scale: number;
  isKeyboardOpen: boolean;
  keyboardHeight: number;
  containerHeight: string;
  style: React.CSSProperties;
}

export interface UseVisualViewportOptions {
  /** Height difference in px to consider virtual keyboard visible (default 150) */
  keyboardThreshold?: number;
  /** Bottom offset in px (e.g. for toolbars or bottom navigation) */
  bottomOffset?: number;
  /** Whether to sync CSS variables (--visual-viewport-height, --keyboard-height) */
  applyCssVariable?: boolean;
  /** Minimum container height in px (default 160) */
  minHeight?: number;
}

/**
 * Custom React hook that monitors `window.visualViewport` resize and scroll events.
 * Dynamically computes adjusted heights and CSS styles when the virtual keyboard
 * opens or closes on mobile devices (<768px), preventing editor occlusion.
 */
export function useVisualViewport(
  options: UseVisualViewportOptions = {},
): VisualViewportState {
  const {
    keyboardThreshold = 150,
    bottomOffset = 0,
    applyCssVariable = true,
    minHeight = 160,
  } = options;

  const calculateState = useCallback((): VisualViewportState => {
    if (typeof window === "undefined") {
      return {
        viewportHeight: 0,
        viewportWidth: 0,
        offsetTop: 0,
        offsetLeft: 0,
        scale: 1,
        isKeyboardOpen: false,
        keyboardHeight: 0,
        containerHeight: "100dvh",
        style: { height: "100dvh" },
      };
    }

    const vv = window.visualViewport;
    const winHeight = window.innerHeight;
    const winWidth = window.innerWidth;
    const vpHeight = vv ? vv.height : winHeight;
    const vpWidth = vv ? vv.width : winWidth;
    const offsetTop = vv ? vv.offsetTop : 0;
    const offsetLeft = vv ? vv.offsetLeft : 0;
    const scale = vv ? vv.scale : 1;

    const keyboardHeight = Math.max(0, winHeight - vpHeight);
    const isKeyboardOpen = keyboardHeight >= keyboardThreshold;
    const effectiveHeight = Math.max(
      minHeight,
      isKeyboardOpen ? vpHeight - bottomOffset : vpHeight,
    );
    const containerHeight = isKeyboardOpen ? `${effectiveHeight}px` : "100dvh";

    return {
      viewportHeight: vpHeight,
      viewportWidth: vpWidth,
      offsetTop,
      offsetLeft,
      scale,
      isKeyboardOpen,
      keyboardHeight,
      containerHeight,
      style: {
        height: containerHeight,
        maxHeight: isKeyboardOpen ? `${effectiveHeight}px` : undefined,
      },
    };
  }, [keyboardThreshold, bottomOffset, minHeight]);

  const [state, setState] = useState<VisualViewportState>(calculateState);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const updateState = () => {
      const next = calculateState();
      if (applyCssVariable && typeof document !== "undefined") {
        document.documentElement.style.setProperty(
          "--visual-viewport-height",
          `${next.viewportHeight}px`,
        );
        document.documentElement.style.setProperty(
          "--keyboard-height",
          `${next.keyboardHeight}px`,
        );
        document.documentElement.style.setProperty(
          "--is-keyboard-open",
          next.isKeyboardOpen ? "1" : "0",
        );
      }
      setState(next);
    };

    updateState();

    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener("resize", updateState);
      vv.addEventListener("scroll", updateState);
    }
    window.addEventListener("resize", updateState);

    return () => {
      if (vv) {
        vv.removeEventListener("resize", updateState);
        vv.removeEventListener("scroll", updateState);
      }
      window.removeEventListener("resize", updateState);
    };
  }, [calculateState, applyCssVariable]);

  return state;
}

// ============================================================================
// Mobile Quick-Access Coding Toolbar & Symbol Insertion
// ============================================================================

export const MOBILE_TOOLBAR_SYMBOLS = [
  "{",
  "}",
  "(",
  ")",
  ";",
  "&",
  "->",
  "::",
  "=>",
  "|",
] as const;

export type MobileToolbarSymbol = (typeof MOBILE_TOOLBAR_SYMBOLS)[number];

export interface MonacoEditorLike {
  getPosition?: () => { lineNumber: number; column: number } | null;
  getSelection?: () => unknown;
  executeEdits: (
    source: string,
    edits: Array<{ range: unknown; text: string; forceMoveMarkers?: boolean }>,
  ) => void;
  pushUndoStop?: () => void;
  focus?: () => void;
}

export interface CustomInsertable {
  insertText: (text: string) => void;
  focus?: () => void;
}

let activeEditorInstance: unknown = null;

/**
 * Registers an active editor instance (Monaco or custom) for global symbol insertion.
 */
export function setActiveEditorInstance(editor: unknown): void {
  activeEditorInstance = editor;
}

/**
 * Returns currently registered active editor instance.
 */
export function getActiveEditorInstance(): unknown {
  return activeEditorInstance;
}

/**
 * Inserts a programming symbol directly at the cursor position (or replaces selection)
 * in the target editor instance (Monaco, HTMLTextAreaElement, HTMLInputElement, or custom callback).
 */
export function insertSymbolAtCursor(target: unknown, symbol: string): boolean {
  const editor = target ?? activeEditorInstance;

  // 1. Monaco Editor instance
  if (
    editor &&
    typeof (editor as MonacoEditorLike).executeEdits === "function"
  ) {
    try {
      const monacoEditor = editor as MonacoEditorLike;
      const selection = monacoEditor.getSelection?.();
      const position = monacoEditor.getPosition?.();
      const range =
        selection ??
        (position
          ? {
              startLineNumber: position.lineNumber,
              startColumn: position.column,
              endLineNumber: position.lineNumber,
              endColumn: position.column,
            }
          : {
              startLineNumber: 1,
              startColumn: 1,
              endLineNumber: 1,
              endColumn: 1,
            });

      monacoEditor.executeEdits("mobile-coding-toolbar", [
        {
          range,
          text: symbol,
          forceMoveMarkers: true,
        },
      ]);
      monacoEditor.pushUndoStop?.();
      monacoEditor.focus?.();
      return true;
    } catch {
      // Fall through if Monaco executeEdits fails
    }
  }

  // 2. Standard HTMLTextAreaElement or HTMLInputElement
  const resolvedElement =
    editor instanceof HTMLElement
      ? editor
      : typeof document !== "undefined"
      ? (document.activeElement as HTMLElement)
      : null;

  if (
    resolvedElement &&
    (resolvedElement instanceof HTMLTextAreaElement ||
      resolvedElement instanceof HTMLInputElement ||
      ("setRangeText" in resolvedElement && "selectionStart" in resolvedElement))
  ) {
    const input = resolvedElement as HTMLInputElement | HTMLTextAreaElement;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;

    if (typeof input.setRangeText === "function") {
      input.setRangeText(symbol, start, end, "end");
    } else {
      const val = input.value;
      input.value = val.substring(0, start) + symbol + val.substring(end);
      const newPos = start + symbol.length;
      if (typeof input.setSelectionRange === "function") {
        input.setSelectionRange(newPos, newPos);
      }
    }

    try {
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } catch {}

    input.focus?.();
    return true;
  }

  // 3. Custom target with insertText method
  if (
    editor &&
    typeof (editor as CustomInsertable).insertText === "function"
  ) {
    const custom = editor as CustomInsertable;
    custom.insertText(symbol);
    custom.focus?.();
    return true;
  }

  // 4. Custom callback function
  if (typeof editor === "function") {
    (editor as (sym: string) => void)(symbol);
    return true;
  }

  return false;
}

// ============================================================================
// Mobile Quick-Access Coding Toolbar Component
// ============================================================================

export interface MobileCodingToolbarProps {
  /** Target editor instance or callback */
  editor?: unknown;
  /** Explicit symbol insertion handler override */
  onInsertSymbol?: (symbol: string) => void;
  /** Custom list of symbols (defaults to MOBILE_TOOLBAR_SYMBOLS) */
  symbols?: readonly string[];
  /** Optional container CSS class */
  className?: string;
  /** ARIA label for the toolbar */
  ariaLabel?: string;
  /** Whether the toolbar is visible */
  visible?: boolean;
  /** Test identifier */
  dataTestId?: string;
}

/**
 * Mobile Quick-Access Coding Toolbar providing touch-friendly buttons
 * for common programming symbols (`{`, `}`, `(`, `)`, `;`, `&`, `->`, `::`, `=>`, `|`).
 *
 * Keeps editor focus on tap via `preventDefault()` on `mouseDown`/`touchStart`.
 */
export function MobileCodingToolbar({
  editor,
  onInsertSymbol,
  symbols = MOBILE_TOOLBAR_SYMBOLS,
  className = "",
  ariaLabel = "Quick-access coding symbols",
  visible = true,
  dataTestId = "mobile-coding-toolbar",
}: MobileCodingToolbarProps): React.ReactElement | null {
  if (!visible) return null;

  const handleInsert = (symbol: string) => {
    if (onInsertSymbol) {
      onInsertSymbol(symbol);
    } else {
      insertSymbolAtCursor(editor, symbol);
    }
  };

  const buttons = symbols.map((symbol) =>
    React.createElement(
      "button",
      {
        key: symbol,
        type: "button",
        "aria-label": `Insert ${symbol}`,
        "data-symbol": symbol,
        className:
          "inline-flex items-center justify-center min-w-[36px] min-h-[36px] px-2.5 py-1 text-xs font-mono font-bold rounded-lg bg-slate-900 border border-slate-700/80 text-teal-300 hover:text-teal-200 hover:bg-slate-800 active:bg-slate-700 shadow-sm transition-colors select-none shrink-0",
        onMouseDown: (e: React.MouseEvent) => {
          // Prevent losing focus / selection from the code editor
          e.preventDefault();
        },
        onClick: () => handleInsert(symbol),
      },
      symbol,
    ),
  );

  return React.createElement(
    "div",
    {
      role: "toolbar",
      "aria-label": ariaLabel,
      "data-testid": dataTestId,
      className: `flex items-center gap-1.5 overflow-x-auto px-2 py-1.5 bg-slate-950/95 border-t border-slate-800/80 backdrop-blur-md scrollbar-none select-none z-10 ${className}`,
    },
    buttons,
  );
}

/**
 * Unified hook combining visual viewport adaptation with symbol insertion.
 */
export function useMobileEditorControls(
  options: UseVisualViewportOptions & { editor?: unknown } = {},
) {
  const { editor, ...viewportOptions } = options;
  const viewport = useVisualViewport(viewportOptions);

  const insertSymbol = useCallback(
    (symbol: string) => insertSymbolAtCursor(editor, symbol),
    [editor],
  );

  return {
    ...viewport,
    insertSymbol,
    symbols: MOBILE_TOOLBAR_SYMBOLS,
    setActiveEditor: setActiveEditorInstance,
  };
}
