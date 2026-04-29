"use client";

import React, { useState } from "react";
import { ShieldCheck, Users, Clock, Plus, CheckCircle, XCircle, PlayCircle } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type SignerRole = "Owner" | "Admin" | "Operator" | "Viewer";

export interface SignerData {
  address: string;
  role: SignerRole;
}

export type TxStatus = "Pending" | "Queued" | "Executed" | "Cancelled" | "Expired";

export interface MultisigTx {
  id: number;
  proposer: string;
  description: string;
  amount: number;
  recipient?: string;
  status: TxStatus;
  approvals: number;
  threshold: number;
  createdAt: number;
  executeAfter: number;
}

interface Props {
  contractId?: string;
  walletAddress?: string;
  signers: SignerData[];
  transactions: MultisigTx[];
  threshold: number;
  isLoading: boolean;
  onAddSigner: (address: string, role: SignerRole) => Promise<void>;
  onRemoveSigner: (address: string) => Promise<void>;
  onChangeThreshold: (t: number) => Promise<void>;
  onPropose: (description: string, amount: number, recipient?: string) => Promise<void>;
  onApprove: (txId: number) => Promise<void>;
  onExecute: (txId: number) => Promise<void>;
  onCancel: (txId: number) => Promise<void>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const ROLE_COLORS: Record<SignerRole, string> = {
  Owner: "text-orange-300 border-orange-400/30 bg-orange-400/10",
  Admin: "text-cyan-300 border-cyan-400/30 bg-cyan-400/10",
  Operator: "text-emerald-300 border-emerald-400/30 bg-emerald-400/10",
  Viewer: "text-slate-300 border-slate-400/30 bg-slate-400/10",
};

const STATUS_COLORS: Record<TxStatus, string> = {
  Pending: "text-amber-300",
  Queued: "text-cyan-300",
  Executed: "text-emerald-300",
  Cancelled: "text-rose-300",
  Expired: "text-slate-500",
};

function short(addr: string) {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

function timelockRemaining(executeAfter: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = executeAfter - now;
  if (diff <= 0) return "Ready";
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  return `${h}h ${m}m`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MultisigWalletDashboard({
  contractId,
  walletAddress,
  signers,
  transactions,
  threshold,
  isLoading,
  onAddSigner,
  onRemoveSigner,
  onChangeThreshold,
  onPropose,
  onApprove,
  onExecute,
  onCancel,
}: Props) {
  const [tab, setTab] = useState<"txs" | "signers">("txs");

  // Propose form
  const [propDesc, setPropDesc] = useState("");
  const [propAmount, setPropAmount] = useState("0");
  const [propRecipient, setPropRecipient] = useState("");

  // Add signer form
  const [newAddr, setNewAddr] = useState("");
  const [newRole, setNewRole] = useState<SignerRole>("Operator");

  // Threshold form
  const [newThreshold, setNewThreshold] = useState(String(threshold));

  const pending = transactions.filter((t) => t.status === "Pending" || t.status === "Queued");
  const history = transactions.filter((t) => t.status === "Executed" || t.status === "Cancelled" || t.status === "Expired");

  return (
    <div className="rounded-2xl border border-white/8 bg-white/5 p-4">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-cyan-400" />
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
            Multisig Wallet
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>{threshold}-of-{signers.length} threshold</span>
          {contractId && (
            <span className="font-mono text-slate-600">{short(contractId)}</span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-2">
        {(["txs", "signers"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              tab === t
                ? "bg-cyan-400/20 text-cyan-200 border border-cyan-400/30"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {t === "txs" ? "Transactions" : "Signers"}
          </button>
        ))}
      </div>

      {/* ── Transactions tab ── */}
      {tab === "txs" && (
        <div className="space-y-4">
          {/* Propose form */}
          <div className="rounded-xl border border-white/8 bg-slate-950/50 p-3 space-y-2">
            <p className="text-xs font-semibold text-slate-400 flex items-center gap-1">
              <Plus size={12} /> New Proposal
            </p>
            <input
              value={propDesc}
              onChange={(e) => setPropDesc(e.target.value)}
              placeholder="Description"
              className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 outline-none"
            />
            <div className="flex gap-2">
              <input
                value={propAmount}
                onChange={(e) => setPropAmount(e.target.value)}
                placeholder="Amount (stroops)"
                className="flex-1 rounded-lg border border-white/10 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 outline-none"
              />
              <input
                value={propRecipient}
                onChange={(e) => setPropRecipient(e.target.value)}
                placeholder="Recipient (optional)"
                className="flex-1 rounded-lg border border-white/10 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 outline-none"
              />
            </div>
            <button
              disabled={isLoading || !contractId || !propDesc.trim()}
              onClick={() => {
                onPropose(propDesc.trim(), parseInt(propAmount) || 0, propRecipient || undefined);
                setPropDesc("");
                setPropAmount("0");
                setPropRecipient("");
              }}
              className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-xs font-medium text-cyan-200 transition hover:bg-cyan-400/20 disabled:opacity-40"
            >
              Propose
            </button>
          </div>

          {/* Pending / Queued */}
          {pending.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-slate-500 uppercase tracking-wider">Pending Approval</p>
              {pending.map((tx) => (
                <TxCard
                  key={tx.id}
                  tx={tx}
                  walletAddress={walletAddress}
                  isLoading={isLoading}
                  onApprove={onApprove}
                  onExecute={onExecute}
                  onCancel={onCancel}
                />
              ))}
            </div>
          )}

          {/* History */}
          {history.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-slate-500 uppercase tracking-wider">History</p>
              {history.slice(-5).map((tx) => (
                <TxCard
                  key={tx.id}
                  tx={tx}
                  walletAddress={walletAddress}
                  isLoading={isLoading}
                  onApprove={onApprove}
                  onExecute={onExecute}
                  onCancel={onCancel}
                />
              ))}
            </div>
          )}

          {transactions.length === 0 && (
            <p className="text-center text-xs text-slate-600 py-4">No transactions yet.</p>
          )}
        </div>
      )}

      {/* ── Signers tab ── */}
      {tab === "signers" && (
        <div className="space-y-4">
          {/* Signer list */}
          <div className="space-y-2">
            {signers.map((s) => (
              <div
                key={s.address}
                className="flex items-center justify-between rounded-xl border border-white/8 bg-slate-950/50 px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <Users size={12} className="text-slate-500" />
                  <span className="font-mono text-xs text-slate-300">{short(s.address)}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${ROLE_COLORS[s.role]}`}>
                    {s.role}
                  </span>
                </div>
                {s.role !== "Owner" && (
                  <button
                    disabled={isLoading || !contractId}
                    onClick={() => onRemoveSigner(s.address)}
                    className="text-rose-400 hover:text-rose-300 disabled:opacity-40"
                  >
                    <XCircle size={14} />
                  </button>
                )}
              </div>
            ))}
            {signers.length === 0 && (
              <p className="text-center text-xs text-slate-600 py-2">No signers registered.</p>
            )}
          </div>

          {/* Add signer */}
          <div className="rounded-xl border border-white/8 bg-slate-950/50 p-3 space-y-2">
            <p className="text-xs font-semibold text-slate-400 flex items-center gap-1">
              <Plus size={12} /> Add Signer
            </p>
            <input
              value={newAddr}
              onChange={(e) => setNewAddr(e.target.value)}
              placeholder="Stellar address"
              className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 outline-none"
            />
            <div className="flex gap-2">
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as SignerRole)}
                className="flex-1 rounded-lg border border-white/10 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 outline-none"
              >
                {(["Admin", "Operator", "Viewer"] as SignerRole[]).map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
              <button
                disabled={isLoading || !contractId || !newAddr.trim()}
                onClick={() => { onAddSigner(newAddr.trim(), newRole); setNewAddr(""); }}
                className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-200 transition hover:bg-emerald-400/20 disabled:opacity-40"
              >
                Add
              </button>
            </div>
          </div>

          {/* Change threshold */}
          <div className="rounded-xl border border-white/8 bg-slate-950/50 p-3 space-y-2">
            <p className="text-xs font-semibold text-slate-400">Change Threshold</p>
            <div className="flex gap-2">
              <input
                type="number"
                min={1}
                max={signers.length}
                value={newThreshold}
                onChange={(e) => setNewThreshold(e.target.value)}
                className="w-20 rounded-lg border border-white/10 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 outline-none"
              />
              <button
                disabled={isLoading || !contractId}
                onClick={() => onChangeThreshold(parseInt(newThreshold) || threshold)}
                className="rounded-full border border-orange-400/30 bg-orange-400/10 px-3 py-1 text-xs font-medium text-orange-200 transition hover:bg-orange-400/20 disabled:opacity-40"
              >
                Update
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── TxCard sub-component ──────────────────────────────────────────────────────

function TxCard({
  tx,
  walletAddress,
  isLoading,
  onApprove,
  onExecute,
  onCancel,
}: {
  tx: MultisigTx;
  walletAddress?: string;
  isLoading: boolean;
  onApprove: (id: number) => Promise<void>;
  onExecute: (id: number) => Promise<void>;
  onCancel: (id: number) => Promise<void>;
}) {
  const canApprove = tx.status === "Pending";
  const canExecute = tx.status === "Queued";
  const canCancel = tx.status === "Pending" || tx.status === "Queued";
  const progress = Math.min(100, Math.round((tx.approvals / tx.threshold) * 100));

  return (
    <div className="rounded-xl border border-white/8 bg-slate-950/50 px-3 py-2 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-slate-200 truncate">{tx.description}</p>
          <p className="text-[10px] text-slate-500 font-mono">#{tx.id} · {short(tx.proposer)}</p>
        </div>
        <span className={`text-[10px] font-semibold ${STATUS_COLORS[tx.status]}`}>
          {tx.status}
        </span>
      </div>

      {/* Approval progress bar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1 rounded-full bg-slate-800">
          <div
            className="h-1 rounded-full bg-cyan-400 transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-[10px] text-slate-400">{tx.approvals}/{tx.threshold}</span>
      </div>

      {/* Timelock indicator */}
      {tx.status === "Queued" && (
        <div className="flex items-center gap-1 text-[10px] text-amber-400">
          <Clock size={10} />
          <span>Timelock: {timelockRemaining(tx.executeAfter)}</span>
        </div>
      )}

      {/* Actions */}
      {(canApprove || canExecute || canCancel) && (
        <div className="flex gap-1.5 pt-0.5">
          {canApprove && (
            <button
              disabled={isLoading}
              onClick={() => onApprove(tx.id)}
              className="flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-medium text-emerald-200 hover:bg-emerald-400/20 disabled:opacity-40"
            >
              <CheckCircle size={10} /> Approve
            </button>
          )}
          {canExecute && (
            <button
              disabled={isLoading}
              onClick={() => onExecute(tx.id)}
              className="flex items-center gap-1 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-medium text-cyan-200 hover:bg-cyan-400/20 disabled:opacity-40"
            >
              <PlayCircle size={10} /> Execute
            </button>
          )}
          {canCancel && (
            <button
              disabled={isLoading}
              onClick={() => onCancel(tx.id)}
              className="flex items-center gap-1 rounded-full border border-rose-400/30 bg-rose-400/10 px-2 py-0.5 text-[10px] font-medium text-rose-200 hover:bg-rose-400/20 disabled:opacity-40"
            >
              <XCircle size={10} /> Cancel
            </button>
          )}
        </div>
      )}
    </div>
  );
}
