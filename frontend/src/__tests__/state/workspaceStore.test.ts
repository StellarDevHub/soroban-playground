import {
  useWorkspaceEditorStore,
  getInMemoryModel,
  setInMemoryModel,
  deleteInMemoryModel,
  clearAllInMemoryModels,
  EMERGENCY_DUMP_STORAGE_KEY,
} from "../../state/workspaceStore";

describe("useWorkspaceEditorStore", () => {
  beforeEach(() => {
    useWorkspaceEditorStore.getState().reset();
    localStorage.clear();
    clearAllInMemoryModels();
  });

  describe("Initial State", () => {
    it("should initialize with default lib.rs tab and active tab", () => {
      const state = useWorkspaceEditorStore.getState();
      expect(state.tabs).toHaveLength(1);
      expect(state.tabs[0].id).toBe("src/lib.rs");
      expect(state.tabs[0].filename).toBe("lib.rs");
      expect(state.activeTabId).toBe("src/lib.rs");
      expect(state.tabs[0].isDirty).toBe(false);
    });
  });

  describe("Tab Management (open, close, switch)", () => {
    it("should open a new tab and set it as active", () => {
      useWorkspaceEditorStore.getState().openTab({
        id: "src/token.rs",
        filename: "token.rs",
        language: "rust",
        content: "// Token contract",
      });

      const state = useWorkspaceEditorStore.getState();
      expect(state.tabs).toHaveLength(2);
      expect(state.tabs[1].id).toBe("src/token.rs");
      expect(state.activeTabId).toBe("src/token.rs");
    });

    it("should not duplicate tab if opened again, but switch active tab", () => {
      useWorkspaceEditorStore.getState().openTab({
        id: "src/token.rs",
        filename: "token.rs",
      });
      useWorkspaceEditorStore.getState().setActiveTab("src/lib.rs");

      useWorkspaceEditorStore.getState().openTab({
        id: "src/token.rs",
        filename: "token.rs",
      });

      const state = useWorkspaceEditorStore.getState();
      expect(state.tabs).toHaveLength(2);
      expect(state.activeTabId).toBe("src/token.rs");
    });

    it("should close tab and activate another remaining tab", () => {
      useWorkspaceEditorStore.getState().openTab({
        id: "src/token.rs",
        filename: "token.rs",
      });
      expect(useWorkspaceEditorStore.getState().activeTabId).toBe("src/token.rs");

      useWorkspaceEditorStore.getState().closeTab("src/token.rs");

      const state = useWorkspaceEditorStore.getState();
      expect(state.tabs).toHaveLength(1);
      expect(state.tabs[0].id).toBe("src/lib.rs");
      expect(state.activeTabId).toBe("src/lib.rs");
    });

    it("should delete cached in-memory model when closing a tab", () => {
      setInMemoryModel("src/token.rs", { dummyModel: true });
      expect(getInMemoryModel("src/token.rs")).toBeDefined();

      useWorkspaceEditorStore.getState().closeTab("src/token.rs");
      expect(getInMemoryModel("src/token.rs")).toBeUndefined();
    });
  });

  describe("Content, ViewState and Cursor Preservation", () => {
    it("should update tab content and flag as dirty", () => {
      useWorkspaceEditorStore.getState().updateTabContent("src/lib.rs", "pub fn test() {}");
      const tab = useWorkspaceEditorStore.getState().tabs.find((t) => t.id === "src/lib.rs");
      expect(tab?.content).toBe("pub fn test() {}");
      expect(tab?.isDirty).toBe(true);
    });

    it("should save and preserve cursor and scroll coordinates across tab switching", () => {
      useWorkspaceEditorStore.getState().openTab({
        id: "src/token.rs",
        filename: "token.rs",
      });

      // Save coordinates for lib.rs
      useWorkspaceEditorStore.getState().saveTabViewState("src/lib.rs", {
        cursorPosition: { lineNumber: 42, column: 15 },
        scrollPosition: { scrollTop: 350, scrollLeft: 20 },
      });

      // Switch to token.rs
      useWorkspaceEditorStore.getState().setActiveTab("src/token.rs");
      expect(useWorkspaceEditorStore.getState().activeTabId).toBe("src/token.rs");

      // Switch back to lib.rs and verify coordinates are retained
      useWorkspaceEditorStore.getState().setActiveTab("src/lib.rs");
      const libTab = useWorkspaceEditorStore.getState().tabs.find((t) => t.id === "src/lib.rs");
      expect(libTab?.cursorPosition).toEqual({ lineNumber: 42, column: 15 });
      expect(libTab?.scrollPosition).toEqual({ scrollTop: 350, scrollLeft: 20 });
    });
  });

  describe("Undo / Redo History Stack Preservation", () => {
    it("should maintain independent undo/redo history stacks across tab navigation", () => {
      // 1. Tab 1 edits
      useWorkspaceEditorStore.getState().pushUndoState("src/lib.rs", "version 0");
      useWorkspaceEditorStore.getState().updateTabContent("src/lib.rs", "version 1");
      useWorkspaceEditorStore.getState().pushUndoState("src/lib.rs", "version 1");
      useWorkspaceEditorStore.getState().updateTabContent("src/lib.rs", "version 2");

      // 2. Open Tab 2 and make edits
      useWorkspaceEditorStore.getState().openTab({
        id: "src/aux.rs",
        filename: "aux.rs",
        content: "aux v0",
      });
      useWorkspaceEditorStore.getState().pushUndoState("src/aux.rs", "aux v0");
      useWorkspaceEditorStore.getState().updateTabContent("src/aux.rs", "aux v1");

      // 3. Switch back to Tab 1
      useWorkspaceEditorStore.getState().setActiveTab("src/lib.rs");

      // 4. Undo on Tab 1
      const undoneContent = useWorkspaceEditorStore.getState().undo("src/lib.rs");
      expect(undoneContent).toBe("version 1");
      let tab1 = useWorkspaceEditorStore.getState().tabs.find((t) => t.id === "src/lib.rs");
      expect(tab1?.content).toBe("version 1");

      // 5. Redo on Tab 1
      const redoneContent = useWorkspaceEditorStore.getState().redo("src/lib.rs");
      expect(redoneContent).toBe("version 2");
      tab1 = useWorkspaceEditorStore.getState().tabs.find((t) => t.id === "src/lib.rs");
      expect(tab1?.content).toBe("version 2");

      // 6. Verify Tab 2's history stack remains completely untouched
      const tab2 = useWorkspaceEditorStore.getState().tabs.find((t) => t.id === "src/aux.rs");
      expect(tab2?.undoStack).toEqual(["aux v0"]);
    });

    it("should return null when undo or redo is impossible", () => {
      expect(useWorkspaceEditorStore.getState().undo("src/lib.rs")).toBeNull();
      expect(useWorkspaceEditorStore.getState().redo("src/lib.rs")).toBeNull();
    });
  });

  describe("LocalStorage Emergency Dump & Restoration", () => {
    it("should serialize open tabs to localStorage during emergency dump", () => {
      useWorkspaceEditorStore.getState().updateTabContent("src/lib.rs", "emergency unsaved code");
      useWorkspaceEditorStore.getState().emergencyDumpToLocalStorage();

      const dumpRaw = localStorage.getItem(EMERGENCY_DUMP_STORAGE_KEY);
      expect(dumpRaw).not.toBeNull();

      const dump = JSON.parse(dumpRaw!);
      expect(dump.tabs[0].content).toBe("emergency unsaved code");
      expect(dump.tabs[0].isDirty).toBe(true);
      expect(useWorkspaceEditorStore.getState().isEmergencyDumpAvailable).toBe(true);
    });

    it("should restore tabs from emergency dump successfully", () => {
      const dumpPayload = {
        timestamp: Date.now(),
        activeTabId: "src/recovered.rs",
        tabs: [
          {
            id: "src/recovered.rs",
            filename: "recovered.rs",
            language: "rust",
            content: "pub fn recovered() {}",
            isDirty: true,
          },
        ],
      };
      localStorage.setItem(EMERGENCY_DUMP_STORAGE_KEY, JSON.stringify(dumpPayload));

      const success = useWorkspaceEditorStore.getState().restoreFromEmergencyDump();
      expect(success).toBe(true);

      const state = useWorkspaceEditorStore.getState();
      expect(state.tabs).toHaveLength(1);
      expect(state.tabs[0].id).toBe("src/recovered.rs");
      expect(state.tabs[0].content).toBe("pub fn recovered() {}");
      expect(state.activeTabId).toBe("src/recovered.rs");
    });

    it("should clear emergency dump", () => {
      localStorage.setItem(EMERGENCY_DUMP_STORAGE_KEY, "{}");
      useWorkspaceEditorStore.getState().clearEmergencyDump();

      expect(localStorage.getItem(EMERGENCY_DUMP_STORAGE_KEY)).toBeNull();
      expect(useWorkspaceEditorStore.getState().isEmergencyDumpAvailable).toBe(false);
    });
  });

  describe("In-Memory Model Registry", () => {
    it("should register, retrieve and clear Monaco model references", () => {
      const mockModel = { id: "model-1", getValue: () => "code" };
      setInMemoryModel("test-key", mockModel);

      expect(getInMemoryModel("test-key")).toBe(mockModel);

      deleteInMemoryModel("test-key");
      expect(getInMemoryModel("test-key")).toBeUndefined();
    });
  });
});
