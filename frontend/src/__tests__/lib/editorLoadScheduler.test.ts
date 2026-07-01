import {
  loadMonacoEditor,
  resetMonacoEditorLoaderForTests,
  scheduleEditorLoad,
} from "../../lib/editorLoadScheduler";

describe("editorLoadScheduler", () => {
  afterEach(() => {
    jest.useRealTimers();
    resetMonacoEditorLoaderForTests();
  });

  it("schedules editor loading with requestIdleCallback when available", () => {
    const task = jest.fn();
    const requestIdleCallback = jest.fn((callback: IdleRequestCallback) => {
      callback({ didTimeout: false, timeRemaining: () => 10 });
      return 42;
    });
    const cancelIdleCallback = jest.fn();

    scheduleEditorLoad(task, {
      requestIdleCallback,
      cancelIdleCallback,
    } as unknown as Window & typeof globalThis);

    expect(requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 1500,
    });
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("falls back to a macrotask when requestIdleCallback is unavailable", () => {
    jest.useFakeTimers();
    const task = jest.fn();

    scheduleEditorLoad(task, window);

    expect(task).not.toHaveBeenCalled();
    jest.runOnlyPendingTimers();
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("caches the Monaco editor import so repeat mounts share one download", async () => {
    const importer = jest.fn(async () => ({ default: jest.fn() as never }));

    const firstLoad = loadMonacoEditor(importer);
    const secondLoad = loadMonacoEditor(importer);

    expect(firstLoad).toBe(secondLoad);
    await expect(firstLoad).resolves.toEqual({ default: expect.any(Function) });
    expect(importer).toHaveBeenCalledTimes(1);
  });
});

