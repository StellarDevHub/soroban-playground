import React from 'react';
import { render, cleanup, waitFor } from '@testing-library/react';
import Editor from './Editor';
import * as monaco from 'monaco-editor';
import { monacoLifecycle } from '@/lib/monacoLifecycle';

jest.mock('monaco-editor', () => {
  let modelId = 0;
  const createModel = (initialValue = '') => {
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
  const contentListener = { dispose: jest.fn() };
  const editor = {
    dispose: jest.fn(),
    getModel: jest.fn(() => currentModel),
    setModel: jest.fn((model: typeof currentModel) => {
      currentModel = model;
    }),
    trigger: jest.fn((_source: string, action: string) => {
      if (action === 'undo') {
        currentModel.redoStack.push(currentModel.undoStack.pop() ?? '');
      } else if (action === 'redo') {
        currentModel.undoStack.push(currentModel.redoStack.pop() ?? '');
      }
    }),
    onDidChangeModelContent: jest.fn().mockReturnValue(contentListener),
    saveViewState: jest.fn().mockReturnValue({ viewState: {} }),
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
    languages: {
      register: jest.fn(),
      registerCompletionItemProvider: jest.fn(),
    },
  };
}, { virtual: true });

jest.mock('@/hooks/useCollaborativeEditor', () => ({
  useCollaborativeEditor: () => ({ peers: [], isConnected: false }),
}));

jest.mock('@/lib/editorLoadScheduler', () => ({
  scheduleEditorLoad: (cb: () => void) => {
    cb();
    return () => {};
  },
  preloadMonacoEditor: jest.fn(),
}));

jest.mock('@/lib/monacoWorkers', () => ({
  configureMonacoWorkers: jest.fn(),
}));

class MockWorker {
  postMessage = jest.fn();
  terminate = jest.fn();
  onmessage: ((event: any) => void) | null = null;
}

(global as any).Worker = jest.fn().mockImplementation(() => new MockWorker());

describe('Editor', () => {
  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
    monacoLifecycle.reset();
  });

  it('creates a Monaco editor on mount', async () => {
    render(<Editor code="const x = 1;" setCode={() => {}} />);
    await waitFor(() => expect(monaco.editor.create).toHaveBeenCalledTimes(1));
  });

  it('disposes the editor and model on unmount', async () => {
    const { unmount } = render(<Editor code="const x = 1;" setCode={() => {}} />);

    await waitFor(() => expect(monaco.editor.create).toHaveBeenCalledTimes(1));

    const createMock = monaco.editor.create as jest.Mock;
    const editorInstance = createMock.mock.results[0].value;

    expect(editorInstance.getModel).toHaveBeenCalled();
    const modelInstance = editorInstance.getModel();

    expect(editorInstance.dispose).not.toHaveBeenCalled();
    expect(modelInstance.dispose).not.toHaveBeenCalled();

    unmount();

    expect(editorInstance.dispose).toHaveBeenCalledTimes(1);
    expect(modelInstance.dispose).toHaveBeenCalledTimes(1);
  });

  it('terminates the analysis worker on unmount', async () => {
    const { unmount } = render(<Editor code="fn main() {}" setCode={() => {}} />);

    await waitFor(() => expect(monaco.editor.create).toHaveBeenCalledTimes(1));

    const WorkerMock = (global as any).Worker as jest.Mock;
    const workerInstance = WorkerMock.mock.results[0].value;

    unmount();

    expect(workerInstance.terminate).toHaveBeenCalledTimes(1);
  });

  it('releases every tracked Monaco resource on unmount', async () => {
    const { unmount } = render(<Editor code="fn main() {}" setCode={() => {}} />);

    await waitFor(() => expect(monaco.editor.create).toHaveBeenCalledTimes(1));

    const before = monacoLifecycle.getStats();
    expect(before.active).toBeGreaterThan(0);
    expect(before.activeByKind.editor).toBe(1);
    expect(before.activeByKind.model).toBe(1);
    expect(before.activeByKind.worker).toBe(1);
    expect(before.activeByKind.listener).toBe(1);
    expect(before.activeByKind.marker).toBe(1);

    unmount();

    expect(monacoLifecycle.getLeaks()).toHaveLength(0);
    expect(monacoLifecycle.getStats().active).toBe(0);
  });
});
