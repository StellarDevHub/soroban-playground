"use client";

import React from "react";
import { CheckCircle2, Clock, ExternalLink, Trash2, XCircle } from "lucide-react";
import { Transaction } from "@/hooks/useTransactionTracker";

interface TransactionStatusProps {
  transactions: Transaction[];
  onClear: () => void;
}

export default function TransactionStatus({
  transactions,
  onClear,
}: TransactionStatusProps) {
  if (transactions.length === 0) return null;

  return (
    <div className="flex flex-col space-y-2 p-4 bg-gray-900 border border-gray-800 rounded-xl shadow-lg">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-widest flex items-center gap-2">
          <Clock size={14} className="text-amber-400" />
          Transactions
        </h3>
        <button
          onClick={onClear}
          className="text-gray-600 hover:text-gray-400 transition-colors"
          aria-label="Clear transactions"
        >
          <Trash2 size={12} />
        </button>
      </div>

      <div className="space-y-1.5 max-h-48 overflow-y-auto">
        {transactions.map((tx) => (
          <div
            key={tx.id}
            className="flex items-start gap-2 p-2 rounded-lg bg-gray-950 border border-gray-800"
          >
            <TxIcon status={tx.status} />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-300 truncate">{tx.label}</p>
              {tx.error && (
                <p className="text-[10px] text-rose-400 mt-0.5 truncate">{tx.error}</p>
              )}
              {tx.hash && (
                <a
                  href={`https://stellar.expert/explorer/testnet/tx/${tx.hash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[10px] text-cyan-400 hover:text-cyan-300 mt-0.5"
                >
                  <ExternalLink size={10} />
                  View on Explorer
                </a>
              )}
            </div>
            <span className="text-[10px] text-gray-600 shrink-0">
              {new Date(tx.timestamp).toLocaleTimeString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TxIcon({ status }: { status: Transaction["status"] }) {
  if (status === "pending") {
    return (
      <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-b-transparent border-amber-400 shrink-0 mt-0.5" />
    );
  }
  if (status === "success") {
    return <CheckCircle2 size={14} className="text-emerald-400 shrink-0 mt-0.5" />;
  }
  return <XCircle size={14} className="text-rose-400 shrink-0 mt-0.5" />;
}
