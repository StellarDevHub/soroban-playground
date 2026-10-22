import React, { useCallback, useEffect, useRef, useState } from "react";

export interface CodeEditorProps {
  /** Initial code source. */
  initialCode: string;
  /** Language hint for syntax highlighting (e.g. "rust", "ts"). */
  language?: string;
  /** Called when the user clicks "Run" or when the debounced live re-execution fires. */
  onExecute: (code: string) => void | Promise<void>;
  /** Optional live re-execution delay in ms. 0 disables live re-execution. */
  liveDebounceMs?: number;
  /** Optional controlled value. */
  value?: string;
  /** Optional change handler for controlled usage. */
  onChange?: (code: string) => void;
  /** Readonly mode disables editing and execution. */
  readOnly?: boolean;
  /** Maximum height of the editor in pixels. */
  maxHeight?: number;
  /** Accessible label for the editor textarea. */
  label?: string;
}

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    if (delay <= 0) {
      setDebounced(value);
      return;
    }
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

const CodeEditor: React.FC<CodeEditorProps> = ({
  initialCode,
  language = "rust",
  onExecute,
  liveDebounceMs = 600,
  value,
  onChange,
  readOnly = false,
  maxHeight = 400,
  label = "Contract code editor",
}) => {
  const [internalCode, setInternalCode] = useState(initialCode);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const isControlled = value !== undefined;
  const code = isControlled ? value : internalCode;
  const debouncedCode = useDebounced(code, liveDebounceMs);
  const lastExecutedRef = useRef<string | null>(null);

  const setCode = useCallback(
    (next: string) => {
      if (!isControlled) setInternalCode(next);
      onChange?.(next);
    },
    [isControlled, onChange],
  );

  const run = useCallback(
    async (source: string) => {
      if (readOnly) return;
      setExecuting(true);
      setError(null);
      try {
        await onExecute(source);
        lastExecutedRef.current = source;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setExecuting(false);
      }
    },
    [onExecute, readOnly],
  );

  // Live re-execution on debounced changes.
  useEffect(() => {
    if (readOnly || liveDebounceMs <= 0) return;
    if (debouncedCode === lastExecutedRef.current) return;
    void run(debouncedCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedCode, liveDebounceMs, readOnly]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        void run(code);
      }
      // Tab indentation inside the editor.
      if (event.key === "Tab" && !readOnly) {
        event.preventDefault();
        const target = event.currentTarget;
        const start = target.selectionStart;
        const end = target.selectionEnd;
        const next = `${code.slice(0, start)}  ${code.slice(end)}`;
        setCode(next);
        window.requestAnimationFrame(() => {
          target.selectionStart = target.selectionEnd = start + 2;
        });
      }
    },
    [code, readOnly, run, setCode],
  );

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-700 bg-slate-900 p-3 text-slate-100">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-wide text-slate-400">
          {language}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void run(code)}
            disabled={readOnly || executing}
            className="rounded-md bg-emerald-600 px-3 py-1 text-sm font-medium text-white enabled:hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {executing ? "Running..." : "Run"}
          </button>
        </div>
      </div>

      <textarea
        ref={textareaRef}
        aria-label={label}
        spellCheck={false}
        value={code}
        readOnly={readOnly}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setCode(e.target.value)}
        onKeyDown={onKeyDown}
        className="wresize-y font-mono text-sm leading-relaxed bg-slate-950 p-3 text-slate-100 outline-none focus:ring-2 focus:ring-emerald-500"
        style={{ maxHeight, minHeight: 120 }}
      />

      {error && (
        <p className="text-sm text-rose-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};

export default CodeEditor;
