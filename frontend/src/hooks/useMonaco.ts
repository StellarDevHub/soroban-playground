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
import type {
  RustFormatDiagnostic,
  RustfmtConfig,
} from "@/lib/rustfmtDiagnostics";
import { formatRustInWorker } from "@/lib/rustfmtClient";
import "monaco-editor/min/vs/style.css";

let instanceCounter = 0;

interface UseMonacoProps {
  language: string;
  value: string;
  onChange: (value: string) => void;
  viewStateKey?: string;
  onFormat?: (source?: string) => void | Promise<void>;
  formatDiagnostics?: RustFormatDiagnostic[];
  formatOnSave?: boolean;
  rustfmtConfig?: RustfmtConfig | string;
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
  viewStateKey,
  onFormat,
  formatDiagnostics,
  formatOnSave = true,
  rustfmtConfig,
}: UseMonacoProps): UseMonacoResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelRef = useRef<monaco.editor.ITextModel | null>(null);
  const monacoRef = useRef<typeof import("monaco-editor") | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const onChangeRef = useRef(onChange);
  const onFormatRef = useRef(onFormat);
  const formatOnSaveRef = useRef(formatOnSave);
  const rustfmtConfigRef = useRef(rustfmtConfig);
  const valueRef = useRef(value);
  const [isEditorReady, setIsEditorReady] = useState(false);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onFormatRef.current = onFormat;
  }, [onFormat]);

  useEffect(() => {
    formatOnSaveRef.current = formatOnSave;
  }, [formatOnSave]);

  useEffect(() => {
    rustfmtConfigRef.current = rustfmtConfig;
  }, [rustfmtConfig]);

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
  }, [formatDiagnostics, isEditorReady]);

  useEffect(() => {
    valueRef.current = value;
    const model = modelRef.current;
    if (model && value !== model.getValue()) {
      model.setValue(value);
    }
  }, [value]);

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

          const editor = monacoAPI.editor.create(containerRef.current, {
            language,
            value: valueRef.current,
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
            const model = editor.getModel();
            if (model) model.dispose();
            return;
          }

          editorRef.current = editor;
          const model = editor.getModel() ?? null;
          modelRef.current = model;

          if (model) {
            scope.track({
              kind: "model",
              label: `${language} model`,
              disposable: model,
            });
          }
          scope.track({
            kind: "editor",
            label: "Soroban contract editor",
            disposable: editor,
          });

          if (viewStateKey) {
            const persistedViewState = monacoViewStates.restore(viewStateKey);
            if (persistedViewState) {
              try {
                editor.restoreViewState(
                  persistedViewState as monaco.editor.ICodeEditorViewState,
                );
              } catch {}
            }
          }

          setIsEditorReady(true);

          if (language === "rust") {
            const formattingProviderDisposable =
              monacoAPI.languages.registerDocumentFormattingEditProvider("rust", {
                async provideDocumentFormattingEdits(model) {
                  const text = model.getValue();
                  try {
                    const result = await formatRustInWorker(
                      text,
                      rustfmtConfigRef.current,
                    );
                    if ("formatted" in result && result.formatted !== text) {
                      return [
                        {
                          range: model.getFullModelRange(),
                          text: result.formatted,
                        },
                      ];
                    }
                    const monaco = monacoAPI;
                    if (
                      "diagnostics" in result &&
                      result.diagnostics.length > 0 &&
                      monaco
                    ) {
                      monaco.editor.setModelMarkers(
                        model,
                        "rustfmt",
                        result.diagnostics.map((d) => ({
                          severity: monaco.MarkerSeverity.Error,
                          startLineNumber: d.startLineNumber,
                          startColumn: d.startColumn,
                          endLineNumber: d.startLineNumber,
                          endColumn: d.startColumn + 1,
                          message: d.message,
                          source: "rustfmt",
                        })),
                      );
                    }
                  } catch (err) {
                    console.error("[editor] Document formatting failed", err);
                  }
                  return [];
                },
              });

            scope.track({
              kind: "disposable",
              label: "rust document formatting provider",
              disposable: formattingProviderDisposable,
            });
          }

          editor.addAction({
            id: "soroban.format-rust",
            label: "Format Rust",
            keybindings: [
              monacoAPI.KeyMod.CtrlCmd | monacoAPI.KeyCode.KeyS,
            ],
            run: async () => {
              const currentModel = modelRef.current;
              if (!currentModel) return;

              if (formatOnSaveRef.current && language === "rust") {
                const currentText = currentModel.getValue();
                try {
                  const result = await formatRustInWorker(
                    currentText,
                    rustfmtConfigRef.current,
                  );
                  if ("formatted" in result) {
                    if (result.formatted !== currentText) {
                      currentModel.setValue(result.formatted);
                      onChangeRef.current(result.formatted);
                    }
                    monacoAPI?.editor.setModelMarkers(
                      currentModel,
                      "rustfmt",
                      [],
                    );
                    await onFormatRef.current?.(result.formatted);
                  } else if ("diagnostics" in result) {
                    const monaco = monacoAPI;
                    if (monaco) {
                      monaco.editor.setModelMarkers(
                        currentModel,
                        "rustfmt",
                        result.diagnostics.map((d) => ({
                          severity: monaco.MarkerSeverity.Error,
                          startLineNumber: d.startLineNumber,
                          startColumn: d.startColumn,
                          endLineNumber: d.startLineNumber,
                          endColumn: d.startColumn + 1,
                          message: d.message,
                          source: "rustfmt",
                        })),
                      );
                    }
                    await onFormatRef.current?.(currentText);
                  }
                } catch (err) {
                  console.error("[editor] Format on save failed", err);
                  await onFormatRef.current?.(currentText);
                }
              } else {
                await onFormatRef.current?.(currentModel.getValue());
              }
            },
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

      if (viewStateKey && editorRef.current) {
        try {
          const snapshot = editorRef.current.saveViewState();
          if (snapshot) {
            monacoViewStates.save(viewStateKey, snapshot);
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
      workerRef.current = null;
      monacoRef.current = null;
      setIsEditorReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { containerRef, isEditorReady };
}
