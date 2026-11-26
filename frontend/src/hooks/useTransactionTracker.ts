"use client";

import { useCallback, useEffect, useReducer } from "react";

export type TxStatus = "pending" | "success" | "error";

export interface Transaction {
  id: string;
  label: string;
  status: TxStatus;
  hash?: string;
  error?: string;
  timestamp: number;
}

type State = {
  transactions: Transaction[];
};

type SetTransactionsAction = {
  type: "set";
  transactions: Transaction[];
};

type AddTransactionAction = {
  type: "add";
  transaction: Transaction;
};

type UpdateTransactionAction = {
  type: "update";
  id: string;
  update: Partial<Pick<Transaction, "status" | "hash" | "error">>;
};

type ClearTransactionsAction = {
  type: "clear";
};

type Action =
  | SetTransactionsAction
  | AddTransactionAction
  | UpdateTransactionAction
  | ClearTransactionsAction;

export const TX_TRACKER_STORAGE_KEY = "soroban-playground:tx-tracker";

function isTransaction(value: unknown): value is Transaction {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.label === "string" &&
    (v.status === "pending" || v.status === "success" || v.status === "error") &&
    typeof v.timestamp === "number" &&
    (v.hash === undefined || typeof v.hash === "string") &&
    (v.error === undefined || typeof v.error === "string")
  );
}

export function loadStoredTransactions(
  storage: Pick<Storage, "getItem"> | undefined = typeof window !== "undefined"
    ? window.localStorage
    : undefined,
): Transaction[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(TX_TRACKER_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isTransaction);
  } catch {
    return [];
  }
}

function saveStoredTransactions(
  transactions: Transaction[],
  storage: Pick<Storage, "setItem"> | undefined = typeof window !== "undefined"
    ? window.localStorage
    : undefined,
): void {
  if (!storage) return;
  try {
    storage.setItem(TX_TRACKER_STORAGE_KEY, JSON.stringify(transactions));
  } catch {
    // Storage may be full or unavailable (private mode); ignore.
  }
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "set":
      return { transactions: action.transactions };
    case "add":
      return { transactions: [action.transaction, ...state.transactions] };
    case "update":
      return {
        transactions: state.transactions.map((tx) =>
          tx.id === action.id ? { ...tx, ...action.update } : tx,
        ),
      };
    case "clear":
      return { transactions: [] };
    default:
      return state;
  }
}

export function useTransactionTracker() {
  const [state, dispatch] = useReducer(reducer, { transactions: [] });

  // Hydrate from localStorage on mount so tracked transactions survive refreshes.
  useEffect(() => {
    const stored = loadStoredTransactions();
    if (stored.length > 0) {
      dispatch({ type: "set", transactions: stored });
    }
  }, []);

  // Persist every change.
  useEffect(() => {
    saveStoredTransactions(state.transactions);
  }, [state.transactions]);

  const addTx = useCallback((label: string): string => {
    const id = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    dispatch({
      type: "add",
      transaction: { id, label, status: "pending", timestamp: Date.now() },
    });
    return id;
  }, []);

  const updateTx = useCallback(
    (
      id: string,
      update: Partial<Pick<Transaction, "status" | "hash" | "error">>,
    ) => {
      dispatch({ type: "update", id, update });
    },
    [],
  );

  const clearTx = useCallback(() => dispatch({ type: "clear" }), []);

  return { transactions: state.transactions, addTx, updateTx, clearTx };
}
