"use client";

import type MonacoEditorComponent from "@monaco-editor/react";

type MonacoEditorModule = {
  default: typeof MonacoEditorComponent;
};

type IdleWindow = Window & {
  requestIdleCallback?: (
    callback: IdleRequestCallback,
    options?: IdleRequestOptions
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
};

let monacoEditorPromise: Promise<MonacoEditorModule> | null = null;

export function scheduleEditorLoad(
  task: () => void | Promise<void>,
  targetWindow: IdleWindow | undefined = typeof window === "undefined"
    ? undefined
    : (window as IdleWindow)
): () => void {
  if (!targetWindow) {
    void task();
    return () => {};
  }

  if (typeof targetWindow.requestIdleCallback === "function") {
    const handle = targetWindow.requestIdleCallback(
      () => {
        void task();
      },
      { timeout: 1500 }
    );

    return () => {
      targetWindow.cancelIdleCallback?.(handle);
    };
  }

  const handle = targetWindow.setTimeout(() => {
    void task();
  }, 0);

  return () => {
    targetWindow.clearTimeout(handle);
  };
}

export function loadMonacoEditor(
  importer: () => Promise<MonacoEditorModule> = () => import("@monaco-editor/react")
): Promise<MonacoEditorModule> {
  if (!monacoEditorPromise) {
    monacoEditorPromise = importer();
  }

  return monacoEditorPromise;
}

export function preloadMonacoEditor(): () => void {
  return scheduleEditorLoad(async () => {
    await loadMonacoEditor();
  });
}

export function resetMonacoEditorLoaderForTests() {
  monacoEditorPromise = null;
}
