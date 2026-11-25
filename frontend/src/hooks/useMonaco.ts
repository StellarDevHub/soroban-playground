import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type * as monaco from "monaco-editor";
import { scheduleEditorLoad } from "@/lib/editorLoadScheduler";
import { configureMonacoWorkers } from "@/lib/monacoWorkers";
import {
  createMonacoScope,
  type MonacoLifecycleScope,
} from "@/lib/monacoLifecycle";
import { monacoViewStates } from "@/lib/monacoViewState";
import { getAppliedTheme } from "@/lib/theme/engine";
import { MONACO_THEME_NAME, registerMonacoTheme } from "@/lib/theme/monaco";
import { observeTheme } from "@/lib/theme/observe";
import type { RustFormatDiagnostic } from "@/lib/rustfmtDiagnostics";
import "monaco-editor/min/vs/style.css";

let instanceCounter = 0;

interface UseMonacoProps {
  language: string;
  value: string;
  onChange: (value: string) => void;
  modelKey?: string;
  viewStateKey?: string;
  onFormat?: (source?: string) => void;
  formatDiagnostics?: RustFormatDiagnostic[];
}

interface UseMonacoResult {
  containerRef: RefObject<HTMLDivElement | null>;
  isEditorReady: boolean;
  languageServiceStatus?: string | null;
}

export function useMonaco({
  language,
  value,
  onChange,
  modelKey,
  viewStateKey,
  onFormat,
  formatDiagnostics,
}: UseMonacoProps): UseMonacoResult {
  const activeModelKey = modelKey ?? viewStateKey ?? "editor";
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelRef = useRef<monaco.editor.ITextModel | null>(null);
  const modelsRef = useRef(new Map<string, monaco.editor.ITextModel>());
  const activeModelKeyRef = useRef(activeModelKey);
  const monacoRef = useRef<typeof import("monaco-editor") | null>(null);
  const scopeRef = useRef<MonacoLifecycleScope | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const onChangeRef = useRef(onChange);
  const onFormatRef = useRef(onFormat);
  const valueRef = useRef(value);
  const [isEditorReady, setIsEditorReady] = useState(false);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onFormatRef.current = onFormat;
  }, [onFormat]);

  useEffect(() => {
    valueRef.current = value;
    const model = modelRef.current;
    if (
      model &&
      activeModelKeyRef.current === activeModelKey &&
      value !== model.getValue()
    ) {
      model.setValue(value);
    }
  }, [activeModelKey, value]);

  useEffect(() => {
    if (!isEditorReady || activeModelKeyRef.current === activeModelKey) return;

    const editor = editorRef.current;
    const monacoAPI = monacoRef.current;
    const currentModel = modelRef.current;
    const scope = scopeRef.current;
    if (!editor || !monacoAPI || !scope) return;

    const previousKey = activeModelKeyRef.current;
    const previousViewState = editor.saveViewState();
    if (previousViewState) {
      monacoViewStates.save(previousKey, previousViewState);
    }

    let nextModel = modelsRef.current.get(activeModelKey);
    if (!nextModel) {
      nextModel = monacoAPI.editor.createModel(valueRef.current, language);
      modelsRef.current.set(activeModelKey, nextModel);
      scope.track({
        kind: "model",
        label: `${language} model (${activeModelKey})`,
        disposable: nextModel,
      });
    }

    editor.setModel(nextModel);
    modelRef.current = nextModel;
    activeModelKeyRef.current = activeModelKey;

    const savedState = monacoViewStates.restore(activeModelKey);
    if (savedState) {
      editor.restoreViewState(
        savedState as monaco.editor.ICodeEditorViewState,
      );
    }

    workerRef.current?.postMessage({
      uri: nextModel.uri.toString(),
      code: nextModel.getValue(),
    });

    if (currentModel) {
      monacoAPI.editor.setModelMarkers(currentModel, "rustfmt", []);
      monacoAPI.editor.setModelMarkers(currentModel, "rustAnalyzer", []);
    }
  }, [activeModelKey, isEditorReady, language, viewStateKey]);

  useEffect(() => {
    const model = modelRef.current;
    const monacoAPI = monacoRef.current;
    if (!isEditorReady || !model || !monacoAPI) return;

    monacoAPI.editor.setModelMarkers(
      model,
      "rustfmt",
      (formatDiagnostics ?? []).map((diagnostic) => ({
        severity: monacoAPI.MarkerSeverity.Error,
        startLineNumber: diagnostic.startLineNumber,
        startColumn: diagnostic.startColumn,
        endLineNumber: diagnostic.startLineNumber,
        endColumn: diagnostic.startColumn + 1,
        message: diagnostic.message,
        source: "rustfmt",
      })),
    );
  }, [activeModelKey, formatDiagnostics, isEditorReady]);

  useEffect(() => {
    let disposed = false;
    let cancel: (() => void) | undefined;
    let scope: MonacoLifecycleScope | null = null;
    let stopObservingTheme: (() => void) | undefined;
    let monacoAPI: typeof import("monaco-editor") | null = null;

    async function initEditor() {
      cancel = scheduleEditorLoad(async () => {
        while (!containerRef.current) {
          if (disposed) return;
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        if (disposed) return;

        try {
          const rawMonaco = await import("monaco-editor");
          monacoAPI = (rawMonaco as any).default?.editor ? (rawMonaco as any).default : rawMonaco;
          if (disposed || !monacoAPI || !containerRef.current) return;
          monacoRef.current = monacoAPI;

          configureMonacoWorkers();

          // Register the design-token theme before the editor reads it.
          registerMonacoTheme(monacoAPI, getAppliedTheme() ?? "dark");

          scope = createMonacoScope(
            `${viewStateKey ?? "editor"}#${++instanceCounter}`,
          );
          scopeRef.current = scope;
          const model = monacoAPI.editor.createModel(
            valueRef.current,
            language,
          );
          modelsRef.current.set(activeModelKey, model);
          modelRef.current = model;
          activeModelKeyRef.current = activeModelKey;

          const editor = monacoAPI.editor.create(containerRef.current, {
            model,
            language,
            ariaLabel: "Rust contract source editor",
            accessibilitySupport: "on",
            theme: MONACO_THEME_NAME,
            minimap: { enabled: false },
            fontSize: 14,
            padding: { top: 16, bottom: 16 },
            scrollBeyondLastLine: false,
            smoothScrolling: true,
            cursorBlinking: "smooth",
            cursorSmoothCaretAnimation: "on",
            formatOnPaste: true,
            wordWrap: "on",
            lineNumbers: "on",
            bracketPairColorization: { enabled: true },
            tabSize: 4,
            insertSpaces: true,
            renderLineHighlight: "all",
          });

          if (disposed) {
            editor.dispose();
            model.dispose();
            return;
          }

          editorRef.current = editor;

          scope.track({
            kind: "model",
            label: `${language} model (${activeModelKey})`,
            disposable: model,
          });
          scope.track({
            kind: "editor",
            label: "Soroban contract editor",
            disposable: editor,
          });

          const persistedViewState = monacoViewStates.restore(activeModelKey);
          if (persistedViewState) {
            try {
              editor.restoreViewState(
                persistedViewState as monaco.editor.ICodeEditorViewState,
              );
            } catch {}
          }

          setIsEditorReady(true);

          editor.addAction({
            id: "soroban.format-rust",
            label: "Format Rust",
            keybindings: [
              monacoAPI.KeyMod.CtrlCmd | monacoAPI.KeyCode.KeyS,
            ],
            run: () => onFormatRef.current?.(modelRef.current?.getValue()),
          });

          // Re-register the Monaco theme whenever the app theme changes so the
          // editor highlights stay aligned with the CSS tokens.
          stopObservingTheme = observeTheme((mode) => {
            if (!monacoAPI) return;
            registerMonacoTheme(monacoAPI, mode);
            monacoAPI.editor.setTheme(MONACO_THEME_NAME);
          });
          scope.track({
            kind: "theme",
            label: "monaco theme observer",
            teardown: () => {
              if (stopObservingTheme) {
                stopObservingTheme();
                stopObservingTheme = undefined;
              }
            },
          });

          const worker = new Worker(new URL("../workers/rust-analyzer.worker.ts", import.meta.url));
          workerRef.current = worker;
          scope.track({
            kind: "worker",
            label: "rust analyzer worker",
            teardown: () => worker.terminate(),
          });

          if (model) {
            scope.track({
              kind: "marker",
              label: `rustAnalyzer markers (${model.uri.toString()})`,
              teardown: () => {
                try {
                  monacoAPI?.editor.setModelMarkers(model, "rustAnalyzer", []);
                } catch {}
              },
            });
          }

          worker.onmessage = (event: MessageEvent) => {
            const { uri, diagnostics } = event.data;
            if (!modelRef.current || modelRef.current.uri.toString() !== uri) {
              return;
            }

            const markers: monaco.editor.IMarker[] = diagnostics.map((diagnostic: any) => ({
              severity:
                diagnostic.severity === "error"
                  ? monacoAPI!.MarkerSeverity.Error
                  : diagnostic.severity === "warning"
                    ? monacoAPI!.MarkerSeverity.Warning
                    : monacoAPI!.MarkerSeverity.Info,
              startLineNumber: diagnostic.startLineNumber,
              startColumn: diagnostic.startColumn,
              endLineNumber: diagnostic.endLineNumber,
              endColumn: diagnostic.endColumn,
              message: diagnostic.message,
            }));

            monacoAPI!.editor.setModelMarkers(
              modelRef.current,
              "rustAnalyzer",
              markers,
            );
          };

          const contentListener = editor.onDidChangeModelContent(() => {
            if (modelRef.current) {
              monacoAPI!.editor.setModelMarkers(modelRef.current, "rustfmt", []);
            }
            const currentValue = modelRef.current?.getValue();
            if (currentValue !== undefined) {
              onChangeRef.current(currentValue);
              workerRef.current?.postMessage({
                uri: modelRef.current?.uri.toString(),
                code: currentValue,
              });
            }
          });
          if (contentListener) {
            scope.track({
              kind: "listener",
              label: "onDidChangeModelContent",
              disposable: contentListener,
            });
          }

          if (modelRef.current) {
            workerRef.current.postMessage({
              uri: modelRef.current.uri.toString(),
              code: modelRef.current.getValue(),
            });
          }
        } catch (error) {
          console.error("Failed to initialize Monaco editor", error);
        }
      });
    }

    initEditor();

    return () => {
      disposed = true;
      if (cancel) cancel();

      if (editorRef.current) {
        try {
          const snapshot = editorRef.current.saveViewState();
          if (snapshot) {
            monacoViewStates.save(activeModelKeyRef.current, snapshot);
          }
        } catch {}
      }

      if (scope) {
        scope.dispose();
        scope = null;
      } else {
        if (stopObservingTheme) {
          stopObservingTheme();
          stopObservingTheme = undefined;
        }
        if (workerRef.current) {
          workerRef.current.terminate();
          workerRef.current = null;
        }
        if (editorRef.current) {
          editorRef.current.dispose();
          editorRef.current = null;
        }
        if (modelRef.current) {
          modelRef.current.dispose();
          modelRef.current = null;
        }
      }

      editorRef.current = null;
      modelRef.current = null;
      modelsRef.current.clear();
      scopeRef.current = null;
      workerRef.current = null;
      monacoRef.current = null;
      setIsEditorReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { containerRef, isEditorReady };
}
