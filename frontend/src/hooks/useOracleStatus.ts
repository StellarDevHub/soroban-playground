"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type OracleNode = {
  id: string;
  status: "idle" | "processing" | "error";
  processed: number;
  lastProofAt: number | null;
};

export type OracleVote = {
  nodeId: string;
  ok: boolean;
  phase: "pending" | "follower" | "leader" | "rejected";
  error?: string;
};

export type OracleProof = {
  id: string;
  payload: unknown;
  metadata: Record<string, unknown> | null;
  status: "voting" | "submitted" | "no_quorum" | "failed";
  submittedAt: number;
  votes: OracleVote[];
  consensus: { totalVotes: number; results: Array<{ vote: unknown; count: number }> } | null;
  leader: string | null;
  result: unknown;
  error: string | null;
};

export type OracleEvent = {
  event: string;
  ts: number;
  proofId?: string;
  nodeId?: string;
  vote?: unknown;
  tally?: { totalVotes: number; results: Array<{ vote: unknown; count: number }> };
  threshold?: number;
  submission?: unknown;
  error?: string;
};

interface UseOracleStatusOptions {
  apiBase?: string;
  wsUrl?: string;
  pollMs?: number;
  maxEvents?: number;
}

interface UseOracleStatusApi {
  nodes: OracleNode[];
  proofs: OracleProof[];
  events: OracleEvent[];
  health: Record<string, unknown> | null;
  loading: boolean;
  error: string | null;
  submitProof: (payload: unknown, metadata?: Record<string, unknown>) => Promise<OracleProof | null>;
  refresh: () => Promise<void>;
}

export function useOracleStatus(options: UseOracleStatusOptions = {}): UseOracleStatusApi {
  const apiBase = options.apiBase ?? "/api/oracle";
  const pollMs = options.pollMs ?? 5000;
  const maxEvents = options.maxEvents ?? 50;

  const [nodes, setNodes] = useState<OracleNode[]>([]);
  const [proofs, setProofs] = useState<OracleProof[]>([]);
  const [events, setEvents] = useState<OracleEvent[]>([]);
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [nodesRes, proofsRes, healthRes] = await Promise.all([
        fetch(`${apiBase}/nodes`).then((r) => r.json()),
        fetch(`${apiBase}/proofs?limit=20`).then((r) => r.json()),
        fetch(`${apiBase}/health`).then((r) => r.json()),
      ]);
      setNodes(nodesRes.data || []);
      setProofs(proofsRes.data || []);
      setHealth(healthRes.data || null);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  const submitProof = useCallback(
    async (payload: unknown, metadata?: Record<string, unknown>) => {
      try {
        const res = await fetch(`${apiBase}/proofs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ payload, metadata, wait: false }),
        });
        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.message || "Proof submission failed");
        }
        // optimistically prepend; refresh() will reconcile
        setProofs((prev) => [json.data, ...prev].slice(0, 50));
        return json.data as OracleProof;
      } catch (err) {
        setError((err as Error).message);
        return null;
      }
    },
    [apiBase]
  );

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, pollMs);
    return () => clearInterval(id);
  }, [refresh, pollMs]);

  // WebSocket subscription for live events. Only opens in the browser.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const wsUrl =
      options.wsUrl ??
      (() => {
        const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
        return `${proto}//${window.location.host}/ws`;
      })();
    let socket: WebSocket | null = null;
    try {
      socket = new WebSocket(wsUrl);
    } catch {
      return;
    }
    wsRef.current = socket;
    socket.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        if (data?.type !== "oracle-event") return;
        setEvents((prev) => [data, ...prev].slice(0, maxEvents));
        // Cheap incremental refresh on key transitions
        if (
          data.event === "proof.submitted" ||
          data.event === "proof.failed" ||
          data.event === "quorum.reached"
        ) {
          refresh();
        }
      } catch {
        /* ignore non-JSON frames */
      }
    };
    socket.onerror = () => {
      /* polling will keep state alive even if ws fails */
    };
    return () => {
      socket?.close();
      wsRef.current = null;
    };
  }, [options.wsUrl, maxEvents, refresh]);

  return { nodes, proofs, events, health, loading, error, submitProof, refresh };
}
