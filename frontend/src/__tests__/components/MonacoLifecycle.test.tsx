import React from "react";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import * as monaco from "monaco-editor";
import { monacoLifecycle } from "@/lib/monacoLifecycle";
import { monacoViewStates } from "@/lib/monacoViewState";
import Editor from "@/components/Editor";

jest.mock("monaco-editor", () => {
  let modelId = 0;
  const createModel = (initialValue = "") => {
    let value = initialValue;
    const id = ++modelId;
    return {
      dispose: jest.fn(),
      getValue: () => value,
      setValue: (nextValue: string) => {
        value = nextValue;
      },
      undoStack: [] as string[],
      redoStack: [] as string[],
      uri: { toString: () => `inmemory://model/${id}` },
    };
  };
  let currentModel = createModel();
  const editor = {
    dispose: jest.fn(),
    getModel: jest.fn(() => currentModel),
    setModel: jest.fn((model: typeof currentModel) => {
      currentModel = model;
    }),
    trigger: jest.fn((_source: string, action: string) => {
      if (action === "undo") {
        currentModel.redoStack.push(currentModel.undoStack.pop() ?? "");
      } else if (action === "redo") {
        currentModel.undoStack.push(currentModel.redoStack.pop() ?? "");
      }
    }),
    onDidChangeModelContent: jest.fn().mockReturnValue({ dispose: jest.fn() }),
    saveViewState: jest.fn().mockReturnValue({ cursorState: [], viewState: { scrollTop: 10 } }),
    restoreViewState: jest.fn(),
    addAction: jest.fn(),
  };
  return {
    __esModule: true,
    KeyMod: { CtrlCmd: 2048 },
    KeyCode: { KeyS: 49 },
    editor: {
      create: jest.fn(
        (_container: unknown, options: { model: typeof currentModel }) => {
          currentModel = options.model;
          return editor;
        },
      ),
      createModel: jest.fn((value: string) => createModel(value)),
      setModelMarkers: jest.fn(),
      defineTheme: jest.fn(),
      setTheme: jest.fn(),
      MarkerSeverity: { Error: 1, Warning: 2, Info: 3 },
    },
  };
}, { virtual: true });

jest.mock("@/hooks/useCollaborativeEditor", () => ({
  useCollaborativeEditor: () => ({ peers: [], isConnected: false }),
}));

jest.mock("@/lib/editorLoadScheduler", () => ({
  scheduleEditorLoad: (cb: () => void) => {
    cb();
    return () => {};
  },
  preloadMonacoEditor: jest.fn(),
}));

jest.mock("@/lib/monacoWorkers", () => ({
  configureMonacoWorkers: jest.fn(),
}));

class MockWorker {
  postMessage = jest.fn();
  terminate = jest.fn();
  onmessage: ((event: any) => void) | null = null;
}

(global as any).Worker = jest.fn().mockImplementation(() => new MockWorker());

async function mountReadyEditor(props?: {
  modelKey?: string;
  viewStateKey?: string;
}) {
  const utils = render(
    <Editor code="fn main() {}" setCode={jest.fn()} {...props} />,
  );
  await waitFor(() => expect(monaco.editor.create).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByText(/loading editor/i)).not.toBeInTheDocument());
  return utils;
}

describe("Monaco lifecycle GC (integration)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    monacoLifecycle.reset();
    monacoViewStates.clearAll();
  });

  afterEach(() => {
    cleanup();
    monacoLifecycle.reset();
    monacoViewStates.clearAll();
  });

  it("tracks every Monaco allocation while the editor is live", async () => {
    await mountReadyEditor();

    const stats = monacoLifecycle.getStats();
    expect(stats.activeByKind.editor).toBe(1);
    expect(stats.activeByKind.model).toBe(1);
    expect(stats.activeByKind.listener).toBe(1);
    expect(stats.activeByKind.marker).toBe(1);
    expect(stats.activeByKind.worker).toBe(1);
    expect(stats.activeByKind.theme).toBe(1);
  });

  it("leaves zero live resources after a view transition (unmount)", async () => {
    const { unmount } = await mountReadyEditor();

    unmount();

    expect(monacoLifecycle.getLeaks()).toEqual([]);
    expect(monacoLifecycle.getStats().active).toBe(0);
    const editor = (monaco.editor.create as jest.Mock).mock.results[0].value;
    expect(editor.dispose).toHaveBeenCalledTimes(1);
    expect(editor.getModel().dispose).toHaveBeenCalledTimes(1);
  });

  it("does not accumulate leaks across repeated mount/unmount cycles", async () => {
    for (let cycle = 0; cycle < 5; cycle += 1) {
      const { unmount } = await mountReadyEditor();
      unmount();
    }

    expect(monacoLifecycle.getLeaks()).toEqual([]);
    expect(monacoLifecycle.getStats().active).toBe(0);
  });

  it("persists and restores view state across transitions", async () => {
    const { unmount } = await mountReadyEditor({ viewStateKey: "playground/lib.rs" });

    unmount();

    expect(monacoViewStates.has("playground/lib.rs")).toBe(true);

    await mountReadyEditor({ viewStateKey: "playground/lib.rs" });

    const editor = (monaco.editor.create as jest.Mock).mock.results[0].value;
    await waitFor(() => expect(editor.restoreViewState).toHaveBeenCalledTimes(1));
  });

  it("preserves each model's undo and redo history while switching tabs", async () => {
    const { rerender } = await mountReadyEditor({ modelKey: "src/lib.rs" });
    const editor = (monaco.editor.create as jest.Mock).mock.results[0].value;
    const originalModel = editor.getModel();
    originalModel.undoStack.push("edit lib.rs");

    rerender(
      <Editor
        code="helper source"
        setCode={jest.fn()}
        modelKey="src/helper.rs"
      />,
    );
    await waitFor(() => expect(editor.setModel).toHaveBeenCalledTimes(1));
    const helperModel = editor.getModel();
    helperModel.undoStack.push("edit helper.rs");

    rerender(
      <Editor
        code="fn main() {}"
        setCode={jest.fn()}
        modelKey="src/lib.rs"
      />,
    );
    await waitFor(() => expect(editor.setModel).toHaveBeenCalledTimes(2));
    expect(editor.getModel()).toBe(originalModel);
    expect(originalModel.undoStack).toEqual(["edit lib.rs"]);

    editor.trigger("keyboard", "undo");
    expect(originalModel.undoStack).toEqual([]);
    expect(originalModel.redoStack).toEqual(["edit lib.rs"]);
    editor.trigger("keyboard", "redo");
    expect(originalModel.undoStack).toEqual(["edit lib.rs"]);
    expect(helperModel.undoStack).toEqual(["edit helper.rs"]);
    expect(monaco.editor.createModel).toHaveBeenCalledTimes(2);
  });

  it("flushes a live editor on a simulated hot reload", async () => {
    await mountReadyEditor();
    expect(monacoLifecycle.getStats().active).toBeGreaterThan(0);

    // This is exactly what registerMonacoHotReloadCleanup() runs on HMR.
    monacoLifecycle.disposeAll();

    expect(monacoLifecycle.getStats().active).toBe(0);
    const editor = (monaco.editor.create as jest.Mock).mock.results[0].value;
    expect(editor.dispose).toHaveBeenCalledTimes(1);
  });
});
