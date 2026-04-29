"use client";

import { useCallback, useState } from "react";

export type TxStatus = "pending" | "success" | "error";

export interface Transaction {
  id: string;
  label: string;
  status: TxStatus;
  hash?: string;
  error?: string;
  timestamp: number;
}

export function useTransactionTracker() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  const addTx = useCallback((label: string): string => {
    const id = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setTransactions((prev) => [
      { id, label, status: "pending", timestamp: Date.now() },
      ...prev,
    ]);
    return id;
  }, []);

  const updateTx = useCallback(
    (id: string, update: Partial<Pick<Transaction, "status" | "hash" | "error">>) => {
      setTransactions((prev) =>
        prev.map((tx) => (tx.id === id ? { ...tx, ...update } : tx))
      );
    },
    []
  );

  const clearTx = useCallback(() => setTransactions([]), []);

  return { transactions, addTx, updateTx, clearTx };
}
