import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import EditorTabs from "../../components/EditorTabs";
import {
  useWorkspaceEditorStore,
  EMERGENCY_DUMP_STORAGE_KEY,
} from "../../state/workspaceStore";

describe("EditorTabs Component", () => {
  beforeEach(() => {
    useWorkspaceEditorStore.getState().reset();
    localStorage.clear();
  });

  it("renders the default lib.rs tab and sets it active", () => {
    render(<EditorTabs />);

    const libTab = screen.getByTestId("editor-tab-src/lib.rs");
    expect(libTab).toBeInTheDocument();
    expect(libTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("lib.rs")).toBeInTheDocument();
  });

  it("opens a new tab when clicking the new tab button", () => {
    render(<EditorTabs />);

    const newTabBtn = screen.getByTestId("new-tab-btn");
    fireEvent.click(newTabBtn);

    const tabs = useWorkspaceEditorStore.getState().tabs;
    expect(tabs).toHaveLength(2);
    expect(screen.getByTestId(`editor-tab-${tabs[1].id}`)).toBeInTheDocument();
  });

  it("allows switching active tabs", () => {
    useWorkspaceEditorStore.getState().openTab({
      id: "src/token.rs",
      filename: "token.rs",
    });

    render(<EditorTabs />);

    const libTab = screen.getByTestId("editor-tab-src/lib.rs");
    const tokenTab = screen.getByTestId("editor-tab-src/token.rs");

    // Click on lib.rs to switch
    fireEvent.click(libTab);
    expect(useWorkspaceEditorStore.getState().activeTabId).toBe("src/lib.rs");
    expect(libTab).toHaveAttribute("aria-selected", "true");

    // Click on token.rs
    fireEvent.click(tokenTab);
    expect(useWorkspaceEditorStore.getState().activeTabId).toBe("src/token.rs");
    expect(tokenTab).toHaveAttribute("aria-selected", "true");
  });

  it("allows closing a tab", () => {
    useWorkspaceEditorStore.getState().openTab({
      id: "src/token.rs",
      filename: "token.rs",
    });

    render(<EditorTabs />);

    const closeBtn = screen.getByTestId("close-tab-src/token.rs");
    fireEvent.click(closeBtn);

    expect(useWorkspaceEditorStore.getState().tabs).toHaveLength(1);
    expect(screen.queryByTestId("editor-tab-src/token.rs")).not.toBeInTheDocument();
  });

  it("shows dirty indicator when a tab has unsaved changes", () => {
    useWorkspaceEditorStore.getState().updateTabContent("src/lib.rs", "new unsaved code");

    render(<EditorTabs />);

    const dirtyIndicator = screen.getByTestId("dirty-indicator-src/lib.rs");
    expect(dirtyIndicator).toBeInTheDocument();
  });

  it("executes undo and redo actions via tab bar controls", () => {
    // Record history
    useWorkspaceEditorStore.getState().pushUndoState("src/lib.rs", "step 0");
    useWorkspaceEditorStore.getState().updateTabContent("src/lib.rs", "step 1");

    render(<EditorTabs />);

    const undoBtn = screen.getByTestId("tab-undo-btn");
    expect(undoBtn).not.toBeDisabled();

    fireEvent.click(undoBtn);
    const activeTab = useWorkspaceEditorStore.getState().tabs.find((t) => t.id === "src/lib.rs");
    expect(activeTab?.content).toBe("step 0");

    const redoBtn = screen.getByTestId("tab-redo-btn");
    expect(redoBtn).not.toBeDisabled();

    fireEvent.click(redoBtn);
    const redoneTab = useWorkspaceEditorStore.getState().tabs.find((t) => t.id === "src/lib.rs");
    expect(redoneTab?.content).toBe("step 1");
  });

  it("displays emergency recovery banner when dump exists in localStorage and restores it", () => {
    const dump = {
      timestamp: Date.now(),
      activeTabId: "src/backup.rs",
      tabs: [
        {
          id: "src/backup.rs",
          filename: "backup.rs",
          language: "rust",
          content: "restored content",
          isDirty: true,
        },
      ],
    };
    localStorage.setItem(EMERGENCY_DUMP_STORAGE_KEY, JSON.stringify(dump));

    render(<EditorTabs />);

    const banner = screen.getByTestId("emergency-dump-banner");
    expect(banner).toBeInTheDocument();

    const restoreBtn = screen.getByTestId("restore-emergency-dump-btn");
    fireEvent.click(restoreBtn);

    const state = useWorkspaceEditorStore.getState();
    expect(state.tabs[0].filename).toBe("backup.rs");
    expect(state.tabs[0].content).toBe("restored content");
  });

  it("dismisses emergency recovery banner when dismissed", () => {
    localStorage.setItem(EMERGENCY_DUMP_STORAGE_KEY, JSON.stringify({ tabs: [] }));

    render(<EditorTabs />);

    const dismissBtn = screen.getByTestId("dismiss-emergency-dump-btn");
    fireEvent.click(dismissBtn);

    expect(screen.queryByTestId("emergency-dump-banner")).not.toBeInTheDocument();
    expect(localStorage.getItem(EMERGENCY_DUMP_STORAGE_KEY)).toBeNull();
  });
});
