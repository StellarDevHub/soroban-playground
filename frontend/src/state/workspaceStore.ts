import { create } from "zustand";

export interface EditorCursorPosition {
  lineNumber: number;
  column: number;
}

export interface EditorScrollPosition {
  scrollTop: number;
  scrollLeft: number;
}

export interface EditorTabItem {
  id: string; // File path or unique id (e.g., "src/lib.rs")
  filename: string;
  language: string;
  content: string;
  isDirty: boolean;
  cursorPosition?: EditorCursorPosition;
  scrollPosition?: EditorScrollPosition;
  viewState?: unknown; // Monaco ICodeEditorViewState or serialized model state
  undoStack?: string[];
  redoStack?: string[];
}

export interface WorkspaceStoreState {
  tabs: EditorTabItem[];
  activeTabId: string | null;
  lastEmergencyDumpAt: number | null;
  isEmergencyDumpAvailable: boolean;

  // Tab Navigation & Management
  openTab: (tab: { id: string; filename: string; language?: string; content?: string }) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  updateTabContent: (tabId: string, content: string) => void;
  saveTabViewState: (
    tabId: string,
    viewState: {
      cursorPosition?: EditorCursorPosition;
      scrollPosition?: EditorScrollPosition;
      monacoViewState?: unknown;
    }
  ) => void;

  // Undo / Redo History Stack Management
  pushUndoState: (tabId: string, previousContent: string) => void;
  undo: (tabId: string) => string | null;
  redo: (tabId: string) => string | null;

  // LocalStorage Emergency Dump
  emergencyDumpToLocalStorage: () => void;
  restoreFromEmergencyDump: () => boolean;
  clearEmergencyDump: () => void;
  checkEmergencyDumpAvailability: () => boolean;
  reset: () => void;
}

export const EMERGENCY_DUMP_STORAGE_KEY = "soroban:editor:emergency_dump_v1";

const DEFAULT_TABS: EditorTabItem[] = [
  {
    id: "src/lib.rs",
    filename: "lib.rs",
    language: "rust",
    content: "#![no_std]\nuse soroban_sdk::{contract, contractimpl};\n\n#[contract]\npub struct Contract;\n",
    isDirty: false,
    cursorPosition: { lineNumber: 1, column: 1 },
    scrollPosition: { scrollTop: 0, scrollLeft: 0 },
    undoStack: [],
    redoStack: [],
  },
];

// In-memory model registry caching Monaco ITextModel instances across tab navigation
const inMemoryModelRegistry = new Map<string, unknown>();

export function getInMemoryModel<T = unknown>(id: string): T | undefined {
  return inMemoryModelRegistry.get(id) as T | undefined;
}

export function setInMemoryModel(id: string, model: unknown): void {
  inMemoryModelRegistry.set(id, model);
}

export function deleteInMemoryModel(id: string): void {
  inMemoryModelRegistry.delete(id);
}

export function clearAllInMemoryModels(): void {
  inMemoryModelRegistry.clear();
}

export const useWorkspaceEditorStore = create<WorkspaceStoreState>((set, get) => ({
  tabs: [...DEFAULT_TABS],
  activeTabId: "src/lib.rs",
  lastEmergencyDumpAt: null,
  isEmergencyDumpAvailable: false,

  openTab: ({ id, filename, language = "rust", content = "" }) => {
    set((state) => {
      const existing = state.tabs.find((t) => t.id === id);
      if (existing) {
        return { activeTabId: id };
      }
      const newTab: EditorTabItem = {
        id,
        filename,
        language,
        content,
        isDirty: false,
        cursorPosition: { lineNumber: 1, column: 1 },
        scrollPosition: { scrollTop: 0, scrollLeft: 0 },
        undoStack: [],
        redoStack: [],
      };
      return {
        tabs: [...state.tabs, newTab],
        activeTabId: id,
      };
    });
  },

  closeTab: (tabId: string) => {
    deleteInMemoryModel(tabId);
    set((state) => {
      const nextTabs = state.tabs.filter((t) => t.id !== tabId);
      let nextActiveId = state.activeTabId;

      if (state.activeTabId === tabId) {
        if (nextTabs.length > 0) {
          nextActiveId = nextTabs[nextTabs.length - 1].id;
        } else {
          nextActiveId = null;
        }
      }

      return {
        tabs: nextTabs,
        activeTabId: nextActiveId,
      };
    });
  },

  setActiveTab: (tabId: string) => {
    set({ activeTabId: tabId });
  },

  updateTabContent: (tabId: string, content: string) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== tabId) return tab;
        return {
          ...tab,
          content,
          isDirty: true,
        };
      }),
    }));
  },

  saveTabViewState: (tabId, { cursorPosition, scrollPosition, monacoViewState }) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== tabId) return tab;
        return {
          ...tab,
          cursorPosition: cursorPosition ?? tab.cursorPosition,
          scrollPosition: scrollPosition ?? tab.scrollPosition,
          viewState: monacoViewState ?? tab.viewState,
        };
      }),
    }));
  },

  pushUndoState: (tabId: string, previousContent: string) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== tabId) return tab;
        const stack = tab.undoStack ? [...tab.undoStack, previousContent] : [previousContent];
        return {
          ...tab,
          undoStack: stack.slice(-50), // Cap undo stack at 50 snapshots
          redoStack: [], // Clear redo on fresh input
        };
      }),
    }));
  },

  undo: (tabId: string) => {
    const state = get();
    const tab = state.tabs.find((t) => t.id === tabId);
    if (!tab || !tab.undoStack || tab.undoStack.length === 0) return null;

    const previousContent = tab.undoStack[tab.undoStack.length - 1];
    const newUndoStack = tab.undoStack.slice(0, -1);
    const newRedoStack = tab.redoStack ? [...tab.redoStack, tab.content] : [tab.content];

    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== tabId) return t;
        return {
          ...t,
          content: previousContent,
          undoStack: newUndoStack,
          redoStack: newRedoStack,
          isDirty: true,
        };
      }),
    }));

    return previousContent;
  },

  redo: (tabId: string) => {
    const state = get();
    const tab = state.tabs.find((t) => t.id === tabId);
    if (!tab || !tab.redoStack || tab.redoStack.length === 0) return null;

    const nextContent = tab.redoStack[tab.redoStack.length - 1];
    const newRedoStack = tab.redoStack.slice(0, -1);
    const newUndoStack = tab.undoStack ? [...tab.undoStack, tab.content] : [tab.content];

    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== tabId) return t;
        return {
          ...t,
          content: nextContent,
          undoStack: newUndoStack,
          redoStack: newRedoStack,
          isDirty: true,
        };
      }),
    }));

    return nextContent;
  },

  emergencyDumpToLocalStorage: () => {
    try {
      const state = get();
      if (typeof window === "undefined" || !window.localStorage) return;

      const dumpPayload = {
        timestamp: Date.now(),
        activeTabId: state.activeTabId,
        tabs: state.tabs.map((t) => ({
          id: t.id,
          filename: t.filename,
          language: t.language,
          content: t.content,
          isDirty: t.isDirty,
          cursorPosition: t.cursorPosition,
          scrollPosition: t.scrollPosition,
        })),
      };

      window.localStorage.setItem(EMERGENCY_DUMP_STORAGE_KEY, JSON.stringify(dumpPayload));
      set({ lastEmergencyDumpAt: Date.now(), isEmergencyDumpAvailable: true });
    } catch {
      // Ignore quota or disabled localStorage errors defensively
    }
  },

  restoreFromEmergencyDump: () => {
    try {
      if (typeof window === "undefined" || !window.localStorage) return false;
      const raw = window.localStorage.getItem(EMERGENCY_DUMP_STORAGE_KEY);
      if (!raw) return false;

      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.tabs) || parsed.tabs.length === 0) return false;

      set({
        tabs: parsed.tabs.map((t: EditorTabItem) => ({
          ...t,
          undoStack: [],
          redoStack: [],
        })),
        activeTabId: parsed.activeTabId || parsed.tabs[0].id,
        isEmergencyDumpAvailable: false,
      });

      return true;
    } catch {
      return false;
    }
  },

  clearEmergencyDump: () => {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.removeItem(EMERGENCY_DUMP_STORAGE_KEY);
      }
      set({ isEmergencyDumpAvailable: false, lastEmergencyDumpAt: null });
    } catch {
      // Ignore
    }
  },

  checkEmergencyDumpAvailability: () => {
    try {
      if (typeof window === "undefined" || !window.localStorage) return false;
      const raw = window.localStorage.getItem(EMERGENCY_DUMP_STORAGE_KEY);
      const available = Boolean(raw);
      set({ isEmergencyDumpAvailable: available });
      return available;
    } catch {
      return false;
    }
  },

  reset: () => {
    clearAllInMemoryModels();
    set({
      tabs: [...DEFAULT_TABS],
      activeTabId: "src/lib.rs",
      lastEmergencyDumpAt: null,
      isEmergencyDumpAvailable: false,
    });
  },
}));
