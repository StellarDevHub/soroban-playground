import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type * as monaco from "monaco-editor";
import { scheduleEditorLoad } from "@/lib/editorLoadScheduler";
import { configureMonacoWorkers } from "@/lib/monacoWorkers";
import { registerRustLanguage } from "@/lib/rustLanguage";
import {
  createRustLanguageWorkerClient,
  type RustLanguageServiceStatus,
} from "@/lib/rustLanguageWorker";
import { getAppliedTheme } from "@/lib/theme/engine";
import { MONACO_THEME_NAME, registerMonacoTheme } from "@/lib/theme/monaco";
import { observeTheme } from "@/lib/theme/observe";
import "monaco-editor/min/vs/style.css";

interface UseMonacoProps {
  language: string;
  value: string;
  onChange: (value: string) => void;
}

interface UseMonacoResult {
  containerRef: RefObject<HTMLDivElement | null>;
  isEditorReady: boolean;
  languageServiceStatus: RustLanguageServiceStatus | null;
}

export function useMonaco({
  language,
  value,
  onChange,
}: UseMonacoProps): UseMonacoResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelRef = useRef<monaco.editor.ITextModel | null>(null);
  const languageWorkerRef = useRef<ReturnType<
    typeof createRustLanguageWorkerClient
  > | null>(null);
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);
  const [isEditorReady, setIsEditorReady] = useState(false);
  const [languageServiceStatus, setLanguageServiceStatus] =
    useState<RustLanguageServiceStatus | null>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

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

          configureMonacoWorkers();
          if (language === "rust") registerRustLanguage(monacoAPI);

          // Register the design-token theme before the editor reads it.
          registerMonacoTheme(monacoAPI, getAppliedTheme() ?? "dark");

          const editor = monacoAPI.editor.create(containerRef.current, {
            language,
            value: valueRef.current,
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
          modelRef.current = editor.getModel() ?? null;
          setIsEditorReady(true);

          // Re-register the Monaco theme whenever the app theme changes so the
          // editor highlights stay aligned with the CSS tokens.
          stopObservingTheme = observeTheme((mode) => {
            if (!monacoAPI) return;
            registerMonacoTheme(monacoAPI, mode);
            monacoAPI.editor.setTheme(MONACO_THEME_NAME);
          });

          if (language === "rust") {
            languageWorkerRef.current = createRustLanguageWorkerClient({
              createWorker: () =>
                new Worker(
                  new URL("../workers/rust-analyzer.worker.ts", import.meta.url),
                  { type: "module", name: "soroban-rust-language-service" },
                ),
              onStatusChange: setLanguageServiceStatus,
              onDiagnostics: (uri, diagnostics) => {
                const model = monacoAPI!.editor
                  .getModels()
                  .find((candidate) => candidate.uri.toString() === uri);
                if (!model) return;

                const markers: monaco.editor.IMarkerData[] = diagnostics.map(
                  (diagnostic) => ({
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
                  }),
                );

                monacoAPI!.editor.setModelMarkers(model, "rustAnalyzer", markers);
              },
            });
          }

          editor.onDidChangeModelContent(() => {
            const model = modelRef.current;
            const currentValue = model?.getValue();
            if (model && currentValue !== undefined) {
              onChangeRef.current(currentValue);
              languageWorkerRef.current?.analyze(
                model.uri.toString(),
                currentValue,
              );
            }
          });

          if (modelRef.current) {
            languageWorkerRef.current?.analyze(
              modelRef.current.uri.toString(),
              modelRef.current.getValue(),
            );
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
      if (stopObservingTheme) {
        stopObservingTheme();
        stopObservingTheme = undefined;
      }
      languageWorkerRef.current?.dispose();
      languageWorkerRef.current = null;
      if (editorRef.current) {
        editorRef.current.dispose();
        editorRef.current = null;
      }
      if (modelRef.current) {
        modelRef.current.dispose();
        modelRef.current = null;
      }
      setIsEditorReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { containerRef, isEditorReady, languageServiceStatus };
}
