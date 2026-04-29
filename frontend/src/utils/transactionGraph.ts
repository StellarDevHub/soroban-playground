export type LedgerState = Record<string, unknown>;

export interface TransactionCallNode {
  id: string;
  parentId?: string;
  depth: number;
  indexInDepth: number;
  contractId: string;
  functionName: string;
  argsSummary: string;
  resultSummary?: string;
  ledgerState: LedgerState;
  raw: unknown;
}

export interface TransactionCallEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface TransactionCallGraph {
  nodes: TransactionCallNode[];
  edges: TransactionCallEdge[];
  rootId?: string;
  txHash?: string;
}

const ROOT_KEYS = [
  "invocationTree",
  "invocation",
  "callTree",
  "transaction",
  "tx",
  "result",
  "simulation",
];

const CHILD_KEYS = [
  "children",
  "calls",
  "invocations",
  "subInvocations",
  "subcalls",
  "internalCalls",
];

const LEDGER_KEYS = [
  "ledgerState",
  "storageState",
  "storage",
  "state",
  "snapshot",
  "ledger",
  "writes",
];

const TX_HASH_KEYS = ["txHash", "transactionHash", "hash"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringifyValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

function cloneForSnapshot<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => cloneForSnapshot(item)) as T;
  }

  const clone: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    clone[key] = cloneForSnapshot(nestedValue);
  }

  return clone as T;
}

function cloneLedgerState(state: LedgerState): LedgerState {
  return cloneForSnapshot(state);
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function pickString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }

    if (isRecord(value)) {
      const nested = value.id;
      if (typeof nested === "string" && nested.trim().length > 0) {
        return nested;
      }

      const address = value.address;
      if (typeof address === "string" && address.trim().length > 0) {
        return address;
      }
    }
  }

  return undefined;
}

function pickUnknown(source: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in source) {
      return source[key];
    }
  }

  return undefined;
}

function normalizeLedgerState(rawLedger: unknown): LedgerState {
  if (!isRecord(rawLedger)) {
    return {};
  }

  const result: LedgerState = {};
  for (const [key, value] of Object.entries(rawLedger)) {
    result[key] = cloneForSnapshot(value);
  }

  return result;
}

function extractTxHash(payload: unknown): string | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  const direct = pickString(payload, TX_HASH_KEYS);
  if (direct) {
    return direct;
  }

  const txValue = payload.tx;
  if (isRecord(txValue)) {
    return pickString(txValue, ["id", "hash", ...TX_HASH_KEYS]);
  }

  return undefined;
}

function findChildrenArray(source: Record<string, unknown>): unknown[] {
  for (const key of CHILD_KEYS) {
    const value = source[key];
    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}

function findInvocationRoot(payload: unknown): unknown {
  if (!isRecord(payload)) {
    return payload;
  }

  for (const key of ROOT_KEYS) {
    const nested = payload[key];
    if (nested !== undefined) {
      if (isRecord(nested)) {
        return findInvocationRoot(nested);
      }

      if (Array.isArray(nested) && nested.length > 0) {
        return nested[0];
      }

      return nested;
    }
  }

  return payload;
}

function summarizeArgs(args: unknown): string {
  if (args === undefined) return "no args";
  const serialized = stringifyValue(args);
  return truncate(serialized, 90);
}

function summarizeResult(result: unknown): string | undefined {
  if (result === undefined) return undefined;
  return truncate(stringifyValue(result), 90);
}

export function parseTransactionInvocationPayload(payload: unknown): TransactionCallGraph {
  const root = findInvocationRoot(payload);

  if (!isRecord(root)) {
    return { nodes: [], edges: [] };
  }

  const nodes: TransactionCallNode[] = [];
  const edges: TransactionCallEdge[] = [];
  const depthCounters = new Map<number, number>();
  const visited = new WeakSet<object>();
  let idCounter = 0;

  const visit = (
    current: unknown,
    parentId: string | undefined,
    depth: number,
    inheritedLedger: LedgerState,
  ): void => {
    if (!isRecord(current)) {
      return;
    }

    if (visited.has(current)) {
      return;
    }
    visited.add(current);

    const currentId =
      pickString(current, ["id", "nodeId", "invocationId"]) ?? `call-${idCounter++}`;
    const contractId =
      pickString(current, ["contractId", "contract", "contract_id", "address"]) ?? "unknown-contract";
    const functionName =
      pickString(current, ["function", "func", "fn", "method", "entrypoint", "symbol"]) ?? "unknown_fn";
    const args = pickUnknown(current, ["args", "arguments", "params", "input"]);
    const result = pickUnknown(current, ["result", "returnValue", "output"]);

    const ledgerPatch = normalizeLedgerState(pickUnknown(current, LEDGER_KEYS));
    const mergedLedger = cloneLedgerState({ ...inheritedLedger, ...ledgerPatch });

    const indexInDepth = depthCounters.get(depth) ?? 0;
    depthCounters.set(depth, indexInDepth + 1);

    nodes.push({
      id: currentId,
      parentId,
      depth,
      indexInDepth,
      contractId,
      functionName,
      argsSummary: summarizeArgs(args),
      resultSummary: summarizeResult(result),
      ledgerState: mergedLedger,
      raw: current,
    });

    if (parentId) {
      edges.push({
        id: `${parentId}->${currentId}`,
        source: parentId,
        target: currentId,
        label: functionName,
      });
    }

    const children = findChildrenArray(current);
    for (const child of children) {
      visit(child, currentId, depth + 1, mergedLedger);
    }
  };

  visit(root, undefined, 0, {});

  return {
    nodes,
    edges,
    rootId: nodes[0]?.id,
    txHash: extractTxHash(payload),
  };
}
