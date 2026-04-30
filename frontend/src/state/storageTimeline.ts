import type { LedgerState, TransactionCallNode } from "@/utils/transactionGraph";

export interface StorageSnapshot {
  id: string;
  label: string;
  contextLabel: string;
  state: LedgerState;
  capturedAt: string;
  contractId?: string;
  functionName?: string;
  txHash?: string;
  source: "deployment" | "transaction";
  nodeId?: string;
}

export interface StorageTimelineState {
  snapshots: StorageSnapshot[];
  currentIndex: number;
  nodeToSnapshotIndex: Record<string, number>;
}

export type StorageTimelineAction =
  | {
      type: "reset_with_deployment";
      contractId: string;
      state: LedgerState;
      capturedAt?: string;
    }
  | {
      type: "append_transaction_frames";
      nodes: TransactionCallNode[];
      txHash?: string;
      capturedAt?: string;
    }
  | {
      type: "select_snapshot_index";
      index: number;
    }
  | {
      type: "select_snapshot_for_node";
      nodeId: string;
    };

function cloneValue<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => cloneValue(entry)) as T;
  }

  const clone: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    clone[key] = cloneValue(nested);
  }
  return clone as T;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      deepFreeze(entry);
    }
  } else {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
  }

  return Object.freeze(value);
}

function immutableLedgerState(state: LedgerState): LedgerState {
  return deepFreeze(cloneValue(state));
}

function buildTransactionSnapshot(
  node: TransactionCallNode,
  index: number,
  txHash: string | undefined,
  capturedAt: string,
): StorageSnapshot {
  return {
    id: `${txHash ?? "tx"}:${node.id}:${index}`,
    label: `${node.contractId}.${node.functionName}`,
    contextLabel: `Frame ${index + 1}: ${node.contractId}.${node.functionName}`,
    state: immutableLedgerState(node.ledgerState),
    capturedAt,
    contractId: node.contractId,
    functionName: node.functionName,
    txHash,
    source: "transaction",
    nodeId: node.id,
  };
}

export function createInitialStorageTimelineState(): StorageTimelineState {
  return {
    snapshots: [],
    currentIndex: -1,
    nodeToSnapshotIndex: {},
  };
}

export function storageTimelineReducer(
  state: StorageTimelineState,
  action: StorageTimelineAction,
): StorageTimelineState {
  switch (action.type) {
    case "reset_with_deployment": {
      const capturedAt = action.capturedAt ?? new Date().toISOString();
      return {
        snapshots: [
          {
            id: `deploy:${action.contractId}:${capturedAt}`,
            label: "Deployment baseline",
            contextLabel: "Deployment baseline snapshot",
            state: immutableLedgerState(action.state),
            capturedAt,
            source: "deployment",
            contractId: action.contractId,
          },
        ],
        currentIndex: 0,
        nodeToSnapshotIndex: {},
      };
    }

    case "append_transaction_frames": {
      if (action.nodes.length === 0) {
        return state;
      }

      const nextSnapshots = [...state.snapshots];
      const nextNodeMap = { ...state.nodeToSnapshotIndex };
      const capturedAt = action.capturedAt ?? new Date().toISOString();

      for (const node of action.nodes) {
        const nextIndex = nextSnapshots.length;
        const snapshot = buildTransactionSnapshot(node, nextIndex, action.txHash, capturedAt);
        nextSnapshots.push(snapshot);
        nextNodeMap[node.id] = nextIndex;
      }

      return {
        snapshots: nextSnapshots,
        currentIndex: nextSnapshots.length - 1,
        nodeToSnapshotIndex: nextNodeMap,
      };
    }

    case "select_snapshot_index": {
      if (state.snapshots.length === 0) {
        return state;
      }

      const clampedIndex = Math.max(0, Math.min(action.index, state.snapshots.length - 1));
      return {
        ...state,
        currentIndex: clampedIndex,
      };
    }

    case "select_snapshot_for_node": {
      const index = state.nodeToSnapshotIndex[action.nodeId];
      if (index === undefined) {
        return state;
      }

      return {
        ...state,
        currentIndex: index,
      };
    }

    default: {
      return state;
    }
  }
}
