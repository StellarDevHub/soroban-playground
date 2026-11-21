import { BridgeSession, BridgeStage, StageStatus } from "../types/bridgeTracker";

export const BRIDGE_STORAGE_KEY = "soroban_bridge_active_sessions";

export function getBridgeSessions(): BridgeSession[] {
  if (typeof window === "undefined" || !window.localStorage) {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(BRIDGE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("Failed to parse bridge sessions from localStorage:", err);
    return [];
  }
}

export function saveBridgeSession(session: BridgeSession): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const sessions = getBridgeSessions();
    const index = sessions.findIndex((s) => s.id === session.id);
    if (index >= 0) {
      sessions[index] = { ...session, updatedAt: Date.now() };
    } else {
      sessions.unshift({ ...session, updatedAt: Date.now() });
    }
    window.localStorage.setItem(BRIDGE_STORAGE_KEY, JSON.stringify(sessions));
  } catch (err) {
    console.error("Failed to save bridge session to localStorage:", err);
  }
}

export function getBridgeSessionById(id: string): BridgeSession | null {
  const sessions = getBridgeSessions();
  return sessions.find((s) => s.id === id) || null;
}

export function updateBridgeSession(
  id: string,
  updates: Partial<BridgeSession>
): BridgeSession | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const sessions = getBridgeSessions();
    const index = sessions.findIndex((s) => s.id === id);
    if (index < 0) return null;

    const updated = {
      ...sessions[index],
      ...updates,
      updatedAt: Date.now(),
    };
    sessions[index] = updated;
    window.localStorage.setItem(BRIDGE_STORAGE_KEY, JSON.stringify(sessions));
    return updated;
  } catch (err) {
    console.error("Failed to update bridge session in localStorage:", err);
    return null;
  }
}

export function removeBridgeSession(id: string): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const sessions = getBridgeSessions().filter((s) => s.id !== id);
    window.localStorage.setItem(BRIDGE_STORAGE_KEY, JSON.stringify(sessions));
  } catch (err) {
    console.error("Failed to remove bridge session from localStorage:", err);
  }
}

export function createDefaultBridgeSession(params: {
  id?: string;
  depositId?: number;
  token: string;
  amount: number;
  sourceTxHash: string;
  sourceNetwork?: "stellar-testnet" | "stellar-mainnet";
  destinationNetwork?: "ethereum-sepolia" | "ethereum-mainnet";
  estimatedTotalSeconds?: number;
}): BridgeSession {
  const now = Date.now();
  const stages: Record<BridgeStage, StageStatus> = {
    source_confirmed: "completed",
    relayer_picked_up: "in_progress",
    proof_generated: "pending",
    destination_minted: "pending",
  };
  const timestamps: Record<BridgeStage, number | null> = {
    source_confirmed: now,
    relayer_picked_up: null,
    proof_generated: null,
    destination_minted: null,
  };

  return {
    id: params.id || `bridge-${now}-${Math.random().toString(36).slice(2, 7)}`,
    depositId: params.depositId,
    token: params.token,
    amount: params.amount,
    sourceNetwork: params.sourceNetwork || "stellar-testnet",
    destinationNetwork: params.destinationNetwork || "ethereum-sepolia",
    sourceTxHash: params.sourceTxHash,
    currentStage: "relayer_picked_up",
    stageStatuses: stages,
    stageTimestamps: timestamps,
    createdAt: now,
    updatedAt: now,
    estimatedTotalSeconds: params.estimatedTotalSeconds || 600, // 10 minutes standard
  };
}
