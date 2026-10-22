import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type WidgetKind = 'query' | 'simulate' | 'invoke';

export interface LiveExecutionWidgetProps {
  /** Widget mode. */
  kind?: WidgetKind;
  /** Contract identifier (e.g. CADRESS) to invoke. */
  contractId: string;
  /** Sorban method name to execute. */
  method: string;
  /** JSon-serializable arguments for the method. */
  args?: unknown[];
  /** Optional pre-filled arguments JSON text. */
  initialArgsText?: string;
  /** Optional pre-filled source snippet for the code editor. */
  initialCodeSnippet?: string;
  /** Optional label shown above the widget. */
  title?: string;
  /** Optional description shown under the title. */
  description?: string;
  /** Network passphrase (e.g. 'TESTNETWORK', 'PUBLIC'). */
  network?: string;
  /** Resolver that executes the call. Defaults to the built-in Sorban RPC transport. */
  executor?: (request: LiveExecutionRequest) => Promise<LiveExecutionResult>;
  /** Callback fired after every execution. */
  onExecute?: (result: LiveExecutionResult) => void;
  /** Disable execution (e.g. when no wallet is connected). */
  disabled?: boolean;
}

export interface LiveExecutionRequest {
  kind: WidgetKind;
  contractId: string;
  method: string;
  args: unknown[];
  network: string;
}

export interface LiveExecutionResult {
  ok: boolean;
  status: number;
  /** Decoded result value (or null). */
  result?: unknown | null;
  /** Raw response body text for display. */
  rawBody: string;
  /** Error message when ok = false. */
  error?: string;
  /** Wall-clock latency in ms. */
  latencyMs: number;
}

const DEFAULT_NETWORK = 'TESTNETWORK';

const SORBAN_RPC_ENDPOINTS: Record<string, string> = {
  TESTNETWORK: 'https://sorban-testnet.stellar.org',
  PUBLIC: 'https://sorban-mainnet.stellar.org',
  FUTURENET: 'https://responses.futurenet.stellar.org',
};

function resolveRpcUrl(network: string): string {
  const key = network.toUpperCase();
  if (SORBAN_RPC_ENDPOINTS[key]) {
    return SORBAN_RPC_ENDPOINTS[key];
  }
  if (/^https?:\/\//.test(network)) {
    return network;
  }
  return SORBAN_RPC_ENDPOINTS.TESTNETWORK;
}

function decodeScVal(value: unknown): unknown {
  if (!value || typeof value !== 'object') {
    return value;
  }
  const v = value as Record<string, unknown>;
  if (typeof v.xdr === 'string') {
    return decodeScVal(v.xdr);
  }
  if (Array.isArray(v)) {
    return v.map(decodeScVal);
  }
  if (typeof v.map === 'object' && v.map !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v.map as Record<string, unknown>)) {
      out[k] = decodeScVal(val);
    }
    return out;
  }
  if (typeof v.vec === 'object' && v.vec !== null) {
    return Object.values(v.vec as Record<string, unknown>).map(decodeScVal);
  }
  return value;
}

function decodeScValText(text: string): unknown {
  try {
    const parsed = JSON.parse(text);
    return decodeScVal(parsed);
  } catch {
    return text;
  }
}

function toScVal(args: unknown[]): unknown[] {
  return args.map((a) => {
    if (a === null || typeof a !== 'object') {
      return a;
    }
    if (Array.isArray(a)) {
      return { vec: toScVal(a as unknown[]) };
    }
    const map: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(a as Record<string, unknown>)) {
      map[k] = toScVal(Array.isArray(v) ? (v as unknown[]) : [v]);
    }
    return { map };
  });
}

async function defaultSorbanRpcExecutor(request: LiveExecutionRequest): Promise<LiveExecutionResult> {
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const url = resolveRpcUrl(request.network);
  const payload = {
    jsonrpc: '2.0',
    id: 1,
    method: 'simulateTransaction',
    params: {
      transaction: {
        operations: [
          {
            type: 'invoke_host_function',
            contractId: request.contractId,
            functionName: request.method,
            args: toScVal(request.args),
          },
        ],
      },
    },
  };
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const rawBody = await response.text();
    const latencyMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started;
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        rawBody,
        error: `RPC responded with ${response.status}`,
        latencyMs,
      };
    }
    const json = JSON.parse(rawBody) as Record<string, unknown>;
    if (json.error) {
      const err = json.error as Record<string, unknown>;
      return {
        ok: false,
        status: response.status,
        rawBody,
        error: String(err.message ?? 'RPC error'),
        latencyMs,
      };
    }
    const result = json.result as Record<string, unknown> | undefined;
    const retVal = result?.returnValue;
    const decoded = typeof retVal === 'string' ? decodeScValText(retVal) : decodeScVal(retVal);
    return {
      ok: true,
      status: response.status,
      result: decoded ?? null,
      rawBody,
      latencyMs,
    };
  } catch (err) {
    const latencyMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started;
    return {
      ok: false,
      status: 0,
      rawBody: '',
      error: err instanceof Error ? err.message : 'Unknown execution error',
      latencyMs,
    };
  }
}

function safeParseArgs(text: string): { ok: true; value: unknown[] } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: true, value: [] };
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      return { ok: false, error: 'Arguments must be a JSON array.' };
    }
    return { ok: true, value: parsed as unknown[] };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Invalid JSON.' };
  }
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

const kindLabel: Record<WidgetKind, string> = {
  query: 'Run Query',
  simulate: 'Simulate Call',
  invoke: 'Invoke',
};

export const LiveExecutionWidget: React.FC<LiveExecutionWidgetProps> = ({
  kind = 'query',
  contractId,
  method,
  args,
  initialArgsText,
  initialCodeSnippet,
  title,
  description,
  network = DEFAULT_NETWORK,
  executor,
  onExecute,
  disabled = false,
}) => {
  const initialArgsString = useMemo(() => {
    if (initialArgsText !== undefined) {
      return initialArgsText;
    }
    return formatJson(args ?? []);
  }, [args, initialArgsText]);

  const [argsText, setArgsText] = useState(initialArgsString);
  const [codeSnippet, setCodeSnippet] = useState(initialCodeSnippet ?? '');
  const [result, setResult] = useState<LiveExecutionResult | null>(null);
  const [pending, setPending] = useState(false);
  const [argsError, setArgsError] = useState<string | null>(null);
  const [autoRunEnabled, setAutoRunEnabled] = useState(false);
  const requestIdRef = useRef<number>(0);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const runExecution = useCallback(
    async (overrideArgs?: unknown[]) => {
      if (disabled || pending || !contractId || !method) {
        return;
      }
      let parsedArgs: unknown[];
      if (overrideArgs) {
        parsedArgs = overrideArgs;
        setArgsError(null);
      } else {
        const parsed = safeParseArgs(argsText);
        if (!parsed.ok) {
          setArgsError(parsed.error);
          return;
        }
        setArgsError(null);
        parsedArgs = parsed.value;
      }
      const request: LiveExecutionRequest = {
        kind,
        contractId,
        method,
        args: parsedArgs,
        network,
      };
      const id = ++requestIdRef.current;
      setPending(true);
      try {
        const run = executor ?? defaultSorbanRpcExecutor;
        const res = await run(request);
        if (!mountedRef.current || id !== requestIdRef.current) {
          return;
        }
        setResult(res);
        onExecute?.(res);
      } catch (err) {
        if (!mountedRef.current || id !== requestIdRef.current) {
          return;
        }
        const failed: LiveExecutionResult = {
          ok: false,
          status: 0,
          rawBody: '',
          error: err instanceof Error ? err.message : 'Execution failed',
          latencyMs: 0,
        };
        setResult(failed);
        onExecute?.(failed);
      } finally {
        if (mountedRef.current && id === requestIdRef.current) {
          setPending(false);
        }
      }
    },
    [argsText, contractId, disabled, executor, kind, method, network, onExecute, pending],
  );

  const onCodeSnippetChange = useCallback(
    (next: string) => {
      setCodeSnippet(next);
      if (!autoRunEnabled) {
        return;
      }
      const parsed = safeParseArgs(next);
      if (parsed.ok) {
        void runExecution(parsed.value);
      } else {
        setArgsError(parsed.error);
      }
    },
    [autoRunEnabled, runExecution],
  );

  const onRunClick = useCallback(() => {
    void runExecution();
  }, [runExecution]);

  const onToggleAutoRun = useCallback(() => {
    setAutoRunEnabled((prev) => !prev);
  }, []);

  const onResetArgs = useCallback(() => {
    setArgsText(initialArgsString);
    setArgsError(null);
  }, [initialArgsString]);

  const disabledButton = disabled || pending || !contractId || !method;
  const statusLabel = pending ? 'Executing…' : result ? (result.ok ? 'Success' : 'Error') : 'Idle';

  return (
    <section
      className="live-execution-widget"
      data-kind={kind}
      data-contract-id={contractId}
      data-method={method}
      aria-label={title ?? `${kindLabel[kind]}: ${method}`}
      style={{
        border: '1px solid var(--docs-border, #e5e7eb)',
        borderRadius: 12,
        padding: 16,
        margin: '1em 0',
        background: 'var(--docs-surface, #fff)',
        color: 'var(--docs-text, #1f2937)',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16 }}>{title ?? `${kindLabel[kind]}: ${method}`}</h3>
          {description ? (
            <p style={{ margin: '4px 0 0', color: 'var(--docs-muted, #6b7280)', fontSize: 13 }}>{description}</p>
          ) : null}
        </div>
        <span
          aria-live="polite"
          style={{
            fontSize: 12,
            padding: '2px 8px',
            borderRadius: 999,
            background: result && !result.ok ? '#fee2e2' : result?.ok ? '#ecfdf5' : '#f3f4f6',
            color: result && !result.ok ? '#991518' : result?.ok ? '#166534' : '#374151',
          }}
        >
          {statusLabel}
        </span>
      </header>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
        <code style={{ fontSize: 12 }}>{contractId}</code>
        <code style={{ fontSize: 12 }}>{method}</code>
        <span style={{ fontSize: 12 }}>Network: {network}</span>
      </div>

      <label style={{ display: 'block', marginTop: 12, fontSize: 12 }}>
        Arguments (JSON array)
        <textarea
          value={argsText}
          onChange={(e) => setArgsText(e.target.value)}
          spellCheck={false}
          aria-invalid={argsError !== null}
          style={{
            display: 'block',
            width: '100%',
            minHeight: 72,
            marginTop: 4,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 12,
            padding: 8,
          }}
        />
      </label>
      {argsError ? (
        <p role="alert" style={{ color: '#991518', fontSize: 12 }}>{argsError}</p>
      ) : null}

      {initialCodeSnippet !== undefined ? (
        <label style={{ display: 'block', marginTop: 12, fontSize: 12 }}>
          Code snippet
          <textarea
            value={codeSnippet}
            onChange={(e) => onCodeSnippetChange(e.target.value)}
            spellCheck={false}
            style={{
              display: 'block',
              width: '100%',
              minHeight: 96,
              marginTop: 4,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 12,
              padding: 8,
            }}
          />
        </label>
      ) : null}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
        <button type="button" onClick={onRunClick} disabled={disabledButton}>
          {pending ? 'Executing…' : kindLabel[kind]}
        </button>
        <button type="button" onClick={onResetArgs} disabled={pending}>
          Reset arguments
        </button>
        {initialCodeSnippet !== undefined ? (
          <label style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={autoRunEnabled} onChange={onToggleAutoRun} />
            Auto-run on edit
          </label>
        ) : null}
      </div>

      {result ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12 }}>
            Status: {result.status} · Latency: {result.latencyMs}ms
          </div>
          {result.error ? (
            <p role="alert" style={{ color: '#991518', fontSize: 12 }}>{result.error}</p>
          ) : null}
          <pre
            style={{
              marginTop: 8,
              padding: 8,
              background: '#f9fafb',
              borderRadius: 8,
              fontSize: 12,
              overflow: 'auto',
              maxHeight: 240,
            }}
          >
            {result.ok ? formatJson(result.result) : result.rawBody}
          </pre>
        </div>
      ) : null}
    </section>
  );
};

export default LiveExecutionWidget;
