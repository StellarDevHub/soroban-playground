import React from "react";
import { render, screen, fireEvent, act, renderHook } from "@testing-library/react";
import {
  DEFAULT_EDITOR_FONT_SIZE,
  MIN_EDITOR_FONT_SIZE,
  MAX_EDITOR_FONT_SIZE,
  clampEditorFontSize,
  calculatePinchFontSize,
  MOBILE_TOOLBAR_SYMBOLS,
  useVisualViewport,
  setActiveEditorInstance,
  getActiveEditorInstance,
  insertSymbolAtCursor,
  MobileCodingToolbar,
  useMobileEditorControls,
} from "./mobileEditorControls";
import ResponsiveNav from "./ResponsiveNav";

// Mock next/navigation
jest.mock("next/navigation", () => ({
  usePathname: () => "/playground",
  useRouter: () => ({ push: jest.fn() }),
}));

// Mock next/link using require inside factory with explicit displayName
jest.mock("next/link", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const MockReact = require("react");
  const MockLink = ({
    children,
    href,
    ...props
  }: {
    children: unknown;
    href: string;
  }) => MockReact.createElement("a", { href, ...props }, children);
  MockLink.displayName = "MockNextLink";
  return MockLink;
});

// Mock Freighter wallet hook
jest.mock("../hooks/useFreighterWallet", () => ({
  useFreighterWallet: () => ({
    status: "disconnected",
    address: null,
    network: "testnet",
    connect: jest.fn(),
    disconnect: jest.fn(),
  }),
}));

// Mock matchMedia
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: jest.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});

interface MockVisualViewportShape {
  height: number;
  width: number;
  offsetTop: number;
  offsetLeft: number;
  scale: number;
  addEventListener: jest.Mock;
  removeEventListener: jest.Mock;
  _trigger: (event: string) => void;
}

describe("mobileEditorControls", () => {
  beforeEach(() => {
    setActiveEditorInstance(null);
    document.body.style.overflow = "";
  });

  // ==========================================================================
  // 1. Gesture & Font Size Scaling
  // ==========================================================================
  describe("Gesture & Font Size Scaling", () => {
    it("has correct font size bounds", () => {
      expect(DEFAULT_EDITOR_FONT_SIZE).toBe(14);
      expect(MIN_EDITOR_FONT_SIZE).toBe(10);
      expect(MAX_EDITOR_FONT_SIZE).toBe(28);
    });

    it("clamps font size between min and max", () => {
      expect(clampEditorFontSize(8)).toBe(10);
      expect(clampEditorFontSize(32)).toBe(28);
      expect(clampEditorFontSize(18)).toBe(18);
      expect(clampEditorFontSize(Number.NaN)).toBe(14);
      expect(clampEditorFontSize(Number.POSITIVE_INFINITY)).toBe(14);
    });

    it("calculates proportional pinch font size", () => {
      expect(calculatePinchFontSize(14, 100, 150)).toBe(21);
      expect(calculatePinchFontSize(14, 100, 50)).toBe(10);
      expect(calculatePinchFontSize(24, 100, 200)).toBe(28);
      expect(calculatePinchFontSize(16, 0, 120)).toBe(16);
      expect(calculatePinchFontSize(16, 100, -10)).toBe(16);
    });
  });

  // ==========================================================================
  // 2. Visual Viewport & Keyboard Adaptation (useVisualViewport)
  // ==========================================================================
  describe("useVisualViewport - Virtual Keyboard Optimization", () => {
    let mockVisualViewport: MockVisualViewportShape;
    const originalVisualViewport = window.visualViewport;

    beforeEach(() => {
      Object.defineProperty(window, "innerHeight", {
        writable: true,
        configurable: true,
        value: 800,
      });
      Object.defineProperty(window, "innerWidth", {
        writable: true,
        configurable: true,
        value: 390,
      });

      const listeners: Record<string, (() => void)[]> = {};
      mockVisualViewport = {
        height: 800,
        width: 390,
        offsetTop: 0,
        offsetLeft: 0,
        scale: 1,
        addEventListener: jest.fn((event: string, cb: () => void) => {
          listeners[event] = listeners[event] || [];
          listeners[event].push(cb);
        }),
        removeEventListener: jest.fn((event: string, cb: () => void) => {
          listeners[event] = (listeners[event] || []).filter((fn) => fn !== cb);
        }),
        _trigger(event: string) {
          (listeners[event] || []).forEach((cb) => cb());
        },
      };

      Object.defineProperty(window, "visualViewport", {
        writable: true,
        configurable: true,
        value: mockVisualViewport,
      });
    });

    afterEach(() => {
      Object.defineProperty(window, "visualViewport", {
        writable: true,
        configurable: true,
        value: originalVisualViewport,
      });
    });

    it("initializes with current viewport measurements", () => {
      const { result } = renderHook(() => useVisualViewport());
      expect(result.current.viewportHeight).toBe(800);
      expect(result.current.viewportWidth).toBe(390);
      expect(result.current.isKeyboardOpen).toBe(false);
      expect(result.current.keyboardHeight).toBe(0);
      expect(result.current.containerHeight).toBe("100dvh");
    });

    it("handles keyboard open: calculates keyboard height and adjusts container", () => {
      const { result } = renderHook(() =>
        useVisualViewport({ keyboardThreshold: 150, bottomOffset: 48 }),
      );

      // Simulate virtual keyboard opening: viewport shrinks from 800 to 450
      act(() => {
        mockVisualViewport.height = 450;
        mockVisualViewport._trigger("resize");
      });

      expect(result.current.viewportHeight).toBe(450);
      expect(result.current.isKeyboardOpen).toBe(true);
      expect(result.current.keyboardHeight).toBe(350);
      // Effective height = 450 - 48 = 402px
      expect(result.current.containerHeight).toBe("402px");
      expect(result.current.style.height).toBe("402px");
      expect(result.current.style.maxHeight).toBe("402px");

      // Verify CSS custom properties are set
      expect(
        document.documentElement.style.getPropertyValue(
          "--visual-viewport-height",
        ),
      ).toBe("450px");
      expect(
        document.documentElement.style.getPropertyValue("--keyboard-height"),
      ).toBe("350px");
      expect(
        document.documentElement.style.getPropertyValue("--is-keyboard-open"),
      ).toBe("1");
    });

    it("handles keyboard close: restores viewport measurements and 100dvh", () => {
      const { result } = renderHook(() => useVisualViewport());

      act(() => {
        mockVisualViewport.height = 400;
        mockVisualViewport._trigger("resize");
      });
      expect(result.current.isKeyboardOpen).toBe(true);

      act(() => {
        mockVisualViewport.height = 800;
        mockVisualViewport._trigger("resize");
      });

      expect(result.current.isKeyboardOpen).toBe(false);
      expect(result.current.keyboardHeight).toBe(0);
      expect(result.current.containerHeight).toBe("100dvh");
      expect(
        document.documentElement.style.getPropertyValue("--is-keyboard-open"),
      ).toBe("0");
    });

    it("updates offset coordinates on visualViewport scroll", () => {
      const { result } = renderHook(() => useVisualViewport());

      act(() => {
        mockVisualViewport.offsetTop = 42;
        mockVisualViewport.offsetLeft = 10;
        mockVisualViewport._trigger("scroll");
      });

      expect(result.current.offsetTop).toBe(42);
      expect(result.current.offsetLeft).toBe(10);
    });

    it("falls back gracefully when window.visualViewport is undefined", () => {
      Object.defineProperty(window, "visualViewport", {
        writable: true,
        configurable: true,
        value: undefined,
      });

      const { result } = renderHook(() => useVisualViewport());
      expect(result.current.viewportHeight).toBe(800);
      expect(result.current.viewportWidth).toBe(390);
      expect(result.current.isKeyboardOpen).toBe(false);
    });

    it("cleans up event listeners on unmount", () => {
      const { unmount } = renderHook(() => useVisualViewport());
      unmount();
      expect(mockVisualViewport.removeEventListener).toHaveBeenCalledWith(
        "resize",
        expect.any(Function),
      );
      expect(mockVisualViewport.removeEventListener).toHaveBeenCalledWith(
        "scroll",
        expect.any(Function),
      );
    });
  });

  // ==========================================================================
  // 3. Symbol Insertion Handler (insertSymbolAtCursor)
  // ==========================================================================
  describe("insertSymbolAtCursor - Cursor Symbol Insertion", () => {
    it("contains all 10 essential mobile coding symbols", () => {
      expect(MOBILE_TOOLBAR_SYMBOLS).toEqual([
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
      ]);
    });

    it("inserts symbol into Monaco editor instance at cursor position", () => {
      const mockExecuteEdits = jest.fn();
      const mockPushUndoStop = jest.fn();
      const mockFocus = jest.fn();

      const mockMonaco = {
        getPosition: () => ({ lineNumber: 3, column: 7 }),
        getSelection: () => null,
        executeEdits: mockExecuteEdits,
        pushUndoStop: mockPushUndoStop,
        focus: mockFocus,
      };

      const success = insertSymbolAtCursor(mockMonaco, "->");
      expect(success).toBe(true);
      expect(mockExecuteEdits).toHaveBeenCalledWith("mobile-coding-toolbar", [
        {
          range: {
            startLineNumber: 3,
            startColumn: 7,
            endLineNumber: 3,
            endColumn: 7,
          },
          text: "->",
          forceMoveMarkers: true,
        },
      ]);
      expect(mockPushUndoStop).toHaveBeenCalled();
      expect(mockFocus).toHaveBeenCalled();
    });

    it("replaces active selection in Monaco editor instance", () => {
      const mockExecuteEdits = jest.fn();
      const selection = {
        startLineNumber: 2,
        startColumn: 4,
        endLineNumber: 2,
        endColumn: 9,
      };

      const mockMonaco = {
        getPosition: () => ({ lineNumber: 2, column: 4 }),
        getSelection: () => selection,
        executeEdits: mockExecuteEdits,
        pushUndoStop: jest.fn(),
        focus: jest.fn(),
      };

      const success = insertSymbolAtCursor(mockMonaco, "{");
      expect(success).toBe(true);
      expect(mockExecuteEdits).toHaveBeenCalledWith("mobile-coding-toolbar", [
        {
          range: selection,
          text: "{",
          forceMoveMarkers: true,
        },
      ]);
    });

    it("inserts symbol into HTMLTextAreaElement at cursor", () => {
      const textarea = document.createElement("textarea");
      textarea.value = "let x = 10";
      document.body.appendChild(textarea);
      textarea.selectionStart = 10;
      textarea.selectionEnd = 10;

      const success = insertSymbolAtCursor(textarea, ";");
      expect(success).toBe(true);
      expect(textarea.value).toBe("let x = 10;");
      expect(textarea.selectionStart).toBe(11);
      expect(textarea.selectionEnd).toBe(11);
      document.body.removeChild(textarea);
    });

    it("replaces selected text in HTMLTextAreaElement", () => {
      const textarea = document.createElement("textarea");
      textarea.value = "fn foo() {}";
      document.body.appendChild(textarea);
      textarea.selectionStart = 3;
      textarea.selectionEnd = 6; // selects "foo"

      const success = insertSymbolAtCursor(textarea, "bar");
      expect(success).toBe(true);
      expect(textarea.value).toBe("fn bar() {}");
      document.body.removeChild(textarea);
    });

    it("inserts symbol via custom callback function", () => {
      const callback = jest.fn();
      const success = insertSymbolAtCursor(callback, "::");
      expect(success).toBe(true);
      expect(callback).toHaveBeenCalledWith("::");
    });

    it("inserts symbol via target with insertText method", () => {
      const mockTarget = {
        insertText: jest.fn(),
        focus: jest.fn(),
      };
      const success = insertSymbolAtCursor(mockTarget, "=>");
      expect(success).toBe(true);
      expect(mockTarget.insertText).toHaveBeenCalledWith("=>");
      expect(mockTarget.focus).toHaveBeenCalled();
    });

    it("uses globally registered active editor when target is null", () => {
      const mockExecuteEdits = jest.fn();
      const mockMonaco = {
        getPosition: () => ({ lineNumber: 1, column: 1 }),
        executeEdits: mockExecuteEdits,
        pushUndoStop: jest.fn(),
        focus: jest.fn(),
      };

      setActiveEditorInstance(mockMonaco);
      expect(getActiveEditorInstance()).toBe(mockMonaco);

      const success = insertSymbolAtCursor(null, "|");
      expect(success).toBe(true);
      expect(mockExecuteEdits).toHaveBeenCalledWith("mobile-coding-toolbar", [
        expect.objectContaining({ text: "|" }),
      ]);
    });

    it("returns false when no target or active editor is present", () => {
      setActiveEditorInstance(null);
      const success = insertSymbolAtCursor(null, "&");
      expect(success).toBe(false);
    });
  });

  // ==========================================================================
  // 4. Mobile Quick-Access Coding Toolbar Component
  // ==========================================================================
  describe("MobileCodingToolbar Component", () => {
    it("renders toolbar with role='toolbar' and aria-label", () => {
      render(React.createElement(MobileCodingToolbar));
      const toolbar = screen.getByRole("toolbar");
      expect(toolbar).toBeInTheDocument();
      expect(toolbar).toHaveAttribute(
        "aria-label",
        "Quick-access coding symbols",
      );
    });

    it("renders buttons for all 10 symbols with accessible labels", () => {
      render(React.createElement(MobileCodingToolbar));
      MOBILE_TOOLBAR_SYMBOLS.forEach((symbol) => {
        const button = screen.getByLabelText(`Insert ${symbol}`);
        expect(button).toBeInTheDocument();
        expect(button).toHaveAttribute("data-symbol", symbol);
      });
    });

    it("clicking symbol button calls onInsertSymbol", () => {
      const onInsertSymbol = jest.fn();
      render(React.createElement(MobileCodingToolbar, { onInsertSymbol }));

      const arrowButton = screen.getByLabelText("Insert ->");
      fireEvent.click(arrowButton);
      expect(onInsertSymbol).toHaveBeenCalledWith("->");

      const braceButton = screen.getByLabelText("Insert {");
      fireEvent.click(braceButton);
      expect(onInsertSymbol).toHaveBeenCalledWith("{");
    });

    it("prevents default on mouseDown to maintain editor focus", () => {
      render(React.createElement(MobileCodingToolbar));
      const colonButton = screen.getByLabelText("Insert ::");
      const event = new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
      });
      const preventDefaultSpy = jest.spyOn(event, "preventDefault");
      colonButton.dispatchEvent(event);
      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    it("does not render when visible is false", () => {
      render(React.createElement(MobileCodingToolbar, { visible: false }));
      expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
    });
  });

  // ==========================================================================
  // 5. useMobileEditorControls Hook
  // ==========================================================================
  describe("useMobileEditorControls Hook", () => {
    it("provides viewport state, symbols array, and insertSymbol helper", () => {
      const mockEditor = {
        getPosition: () => ({ lineNumber: 1, column: 1 }),
        executeEdits: jest.fn(),
      };

      const { result } = renderHook(() =>
        useMobileEditorControls({ editor: mockEditor }),
      );

      expect(result.current.symbols).toEqual(MOBILE_TOOLBAR_SYMBOLS);
      expect(typeof result.current.insertSymbol).toBe("function");

      act(() => {
        result.current.insertSymbol("&");
      });
      expect(mockEditor.executeEdits).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // 6. Responsive Drawer Open/Close & Focus Trap (ResponsiveNav)
  // ==========================================================================
  describe("ResponsiveNav - Mobile Drawer & Focus Trap", () => {
    const renderNav = () =>
      render(
        React.createElement(
          ResponsiveNav,
          null,
          React.createElement(
            "div",
            { "data-testid": "page-content" },
            "Mobile IDE Content",
          ),
        ),
      );

    it("has displayName 'ResponsiveNav'", () => {
      expect(ResponsiveNav.displayName).toBe("ResponsiveNav");
    });

    it("renders hamburger button with aria attributes on mobile", () => {
      renderNav();
      const hamburger = screen.getByLabelText("Open navigation");
      expect(hamburger).toBeInTheDocument();
      expect(hamburger).toHaveAttribute("aria-expanded", "false");
      expect(hamburger).toHaveAttribute(
        "aria-controls",
        "mobile-navigation-drawer",
      );
    });

    it("renders mobile bottom navigation bar with quick links", () => {
      renderNav();
      const bottomNav = screen.getByRole("navigation", {
        name: "Mobile bottom navigation",
      });
      expect(bottomNav).toBeInTheDocument();

      expect(screen.getByLabelText("IDE Playground")).toBeInTheDocument();
      expect(screen.getByLabelText("Compile Dashboard")).toBeInTheDocument();
      expect(screen.getByLabelText("Docs and Reference")).toBeInTheDocument();
      expect(screen.getByLabelText("Open navigation menu")).toBeInTheDocument();
    });

    it("opens drawer, locks body scroll, and sets aria-expanded true", () => {
      renderNav();
      const hamburger = screen.getByLabelText("Open navigation");
      fireEvent.click(hamburger);

      expect(hamburger).toHaveAttribute("aria-expanded", "true");
      expect(document.body.style.overflow).toBe("hidden");

      const drawer = screen.getByRole("dialog");
      expect(drawer).toHaveAttribute("id", "mobile-navigation-drawer");
      expect(drawer).toHaveAttribute("aria-modal", "true");
    });

    it("close button in drawer closes it, unlocks body scroll, and restores focus", () => {
      renderNav();
      const hamburger = screen.getByLabelText("Open navigation");
      fireEvent.click(hamburger);

      const closeButton = screen.getByLabelText("Close navigation");
      expect(closeButton).toBeInTheDocument();
      fireEvent.click(closeButton);

      expect(hamburger).toHaveAttribute("aria-expanded", "false");
      expect(document.body.style.overflow).toBe("");
    });

    it("Escape key closes the drawer and unlocks body scroll", () => {
      renderNav();
      fireEvent.click(screen.getByLabelText("Open navigation"));
      expect(document.body.style.overflow).toBe("hidden");

      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.getByLabelText("Open navigation")).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      expect(document.body.style.overflow).toBe("");
    });

    it("clicking backdrop closes drawer", () => {
      renderNav();
      fireEvent.click(screen.getByLabelText("Open navigation"));

      const backdrop = screen.getByTestId("drawer-backdrop");
      fireEvent.click(backdrop);

      expect(screen.getByLabelText("Open navigation")).toHaveAttribute(
        "aria-expanded",
        "false",
      );
    });

    it("bottom bar menu button opens the drawer", () => {
      renderNav();
      const menuButton = screen.getByLabelText("Open navigation menu");
      fireEvent.click(menuButton);

      const drawer = screen.getByRole("dialog");
      expect(drawer).toBeInTheDocument();
      expect(document.body.style.overflow).toBe("hidden");
    });

    it("focus trap: Tab wraps around focusable elements inside drawer", () => {
      renderNav();
      fireEvent.click(screen.getByLabelText("Open navigation"));

      const drawer = screen.getByRole("dialog");
      const focusableElements = drawer.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      );
      expect(focusableElements.length).toBeGreaterThan(1);

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      // Focus last element, press Tab -> should wrap to first
      lastElement.focus();
      expect(document.activeElement).toBe(lastElement);

      const tabEvent = new KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
        cancelable: true,
      });
      const tabPreventDefault = jest.spyOn(tabEvent, "preventDefault");
      document.dispatchEvent(tabEvent);

      expect(tabPreventDefault).toHaveBeenCalled();
      expect(document.activeElement).toBe(firstElement);

      // Focus first element, press Shift+Tab -> should wrap to last
      firstElement.focus();
      const shiftTabEvent = new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      const shiftTabPreventDefault = jest.spyOn(shiftTabEvent, "preventDefault");
      document.dispatchEvent(shiftTabEvent);

      expect(shiftTabPreventDefault).toHaveBeenCalled();
      expect(document.activeElement).toBe(lastElement);
    });
  });
});
