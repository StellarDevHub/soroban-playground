"use client";

import React, { useState } from "react";

import { useOracleStatus, OracleProof } from "@/hooks/useOracleStatus";

function formatRelative(ts: number | null | undefined): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  if (diff < 1000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

const STATUS_CLASSES: Record<OracleProof["status"], string> = {
  voting: "bg-amber-500/20 text-amber-300 border border-amber-500/40",
  submitted: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40",
  no_quorum: "bg-gray-500/20 text-gray-300 border border-gray-500/40",
  failed: "bg-red-500/20 text-red-300 border border-red-500/40",
};

const NODE_DOT: Record<string, string> = {
  idle: "bg-emerald-400",
  processing: "bg-amber-400 animate-pulse",
  error: "bg-red-400",
};

export function OracleStatusPanel() {
  const { nodes, proofs, events, health, loading, error, submitProof } =
    useOracleStatus();
  const [payloadDraft, setPayloadDraft] = useState(
    JSON.stringify({ price: 100, asset: "XLM" }, null, 2)
  );
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const parsed = JSON.parse(payloadDraft);
      await submitProof(parsed);
    } catch (err) {
      alert(`Invalid JSON or submission failed: ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6 font-mono text-sm text-gray-100">
      <header className="flex items-baseline justify-between border-b border-gray-800 pb-3">
        <h1 className="text-2xl font-bold text-white">Oracle Network</h1>
        {health && (
          <div className="text-xs text-gray-400">
            backend: <span className="text-gray-200">{String(health.backend)}</span> · nodes:{" "}
            <span className="text-gray-200">{String(health.nodes)}</span> · threshold:{" "}
            <span className="text-gray-200">{String(health.threshold)}</span> · active:{" "}
            <span className="text-gray-200">{String(health.activeProofs ?? 0)}</span>
          </div>
        )}
      </header>

      {error && (
        <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-red-300">
          {error}
        </div>
      )}

      <section>
        <h2 className="mb-2 text-base font-semibold text-gray-200">
          Nodes <span className="text-gray-500">({nodes.length})</span>
        </h2>
        {loading ? (
          <p className="text-gray-500">Loading…</p>
        ) : (
          <ul className="divide-y divide-gray-800 rounded border border-gray-800 bg-gray-900/40">
            {nodes.map((n) => (
              <li
                key={n.id}
                className="flex items-center justify-between px-3 py-2"
              >
                <span className="flex items-center gap-2">
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${
                      NODE_DOT[n.status] || "bg-gray-500"
                    }`}
                  />
                  <span className="text-gray-100">{n.id}</span>
                  <span className="ml-2 text-xs text-gray-500">{n.status}</span>
                </span>
                <span className="text-xs text-gray-400">
                  {n.processed} processed · last {formatRelative(n.lastProofAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-base font-semibold text-gray-200">Submit a proof</h2>
        <textarea
          value={payloadDraft}
          onChange={(e) => setPayloadDraft(e.target.value)}
          rows={5}
          className="w-full resize-y rounded border border-gray-700 bg-gray-900 p-2 font-mono text-xs text-gray-100 focus:border-blue-500 focus:outline-none"
          spellCheck={false}
        />
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className={`mt-2 rounded px-4 py-1.5 text-sm font-medium transition ${
            submitting
              ? "cursor-not-allowed bg-gray-700 text-gray-400"
              : "bg-blue-600 text-white hover:bg-blue-500"
          }`}
        >
          {submitting ? "Submitting…" : "Submit proof"}
        </button>
      </section>

      <section>
        <h2 className="mb-2 text-base font-semibold text-gray-200">
          Recent proofs <span className="text-gray-500">({proofs.length})</span>
        </h2>
        {proofs.length === 0 ? (
          <p className="text-gray-500">No proofs yet.</p>
        ) : (
          <ul className="divide-y divide-gray-800 rounded border border-gray-800 bg-gray-900/40">
            {proofs.map((p) => (
              <li key={p.id} className="px-3 py-2">
                <div className="flex items-center justify-between">
                  <code className="text-xs text-gray-300">{p.id}</code>
                  <span
                    className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                      STATUS_CLASSES[p.status] ||
                      "bg-gray-500/20 text-gray-300 border border-gray-500/40"
                    }`}
                  >
                    {p.status}
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-gray-500">
                  {formatRelative(p.submittedAt)}
                  {p.leader ? ` · leader ${p.leader.split(":")[0]}` : ""}
                  {p.consensus ? ` · ${p.consensus.totalVotes} votes` : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-base font-semibold text-gray-200">Live events</h2>
        {events.length === 0 ? (
          <p className="text-gray-500">Waiting for events…</p>
        ) : (
          <ul className="max-h-64 overflow-y-auto rounded border border-gray-800 bg-gray-900/40 p-2 text-[11px]">
            {events.map((e, idx) => (
              <li key={`${e.ts}-${idx}`} className="py-0.5 text-gray-300">
                <span className="text-gray-500">
                  {new Date(e.ts).toLocaleTimeString()}
                </span>{" "}
                <span className="font-semibold text-blue-400">{e.event}</span>
                {e.proofId ? (
                  <span className="text-gray-500"> · {e.proofId.slice(0, 8)}</span>
                ) : null}
                {e.nodeId ? <span className="text-gray-500"> · {e.nodeId}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default OracleStatusPanel;
