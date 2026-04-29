"use client";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ProductStatus =
  | "Registered"
  | "InTransit"
  | "AtWarehouse"
  | "QualityCheck"
  | "Approved"
  | "Rejected"
  | "Delivered"
  | "Recalled";

export type QualityResult = "Pass" | "Fail" | "Pending";

export interface Product {
  id: number;
  owner: string;
  name: string;
  metadataHash: number;
  status: ProductStatus;
  createdAt: number;
  updatedAt: number;
}

export interface Checkpoint {
  productId: number;
  index: number;
  handler: string;
  locationHash: number;
  notesHash: number;
  timestamp: number;
}

export interface QualityReport {
  productId: number;
  inspector: string;
  result: QualityResult;
  reportHash: number;
  timestamp: number;
}

// ── API client ────────────────────────────────────────────────────────────────

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api/v1/supply-chain${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.message ?? `HTTP ${res.status}`);
  }
  return json as T;
}

export const supplyChainApi = {
  getCount: (contractId: string) =>
    apiFetch<{ count: number }>(`/${contractId}/products`),

  getProduct: (contractId: string, id: number) =>
    apiFetch<{ product: Product }>(`/${contractId}/products/${id}`),

  registerProduct: (
    contractId: string,
    body: { owner: string; name: string; metadataHash: number; sourceAccount?: string }
  ) =>
    apiFetch<{ productId: number }>(`/${contractId}/products`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  addCheckpoint: (
    contractId: string,
    productId: number,
    body: { handler: string; locationHash: number; notesHash: number; sourceAccount?: string }
  ) =>
    apiFetch<{ checkpointIndex: number }>(
      `/${contractId}/products/${productId}/checkpoints`,
      { method: "POST", body: JSON.stringify(body) }
    ),

  submitQualityReport: (
    contractId: string,
    productId: number,
    body: { inspector: string; result: QualityResult; reportHash: number; sourceAccount?: string }
  ) =>
    apiFetch(`/${contractId}/products/${productId}/quality-report`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  recallProduct: (
    contractId: string,
    productId: number,
    body: { caller: string; sourceAccount?: string }
  ) =>
    apiFetch(`/${contractId}/products/${productId}/recall`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  pause: (contractId: string, body: { caller: string; sourceAccount?: string }) =>
    apiFetch(`/${contractId}/pause`, { method: "POST", body: JSON.stringify(body) }),

  unpause: (contractId: string, body: { caller: string; sourceAccount?: string }) =>
    apiFetch(`/${contractId}/unpause`, { method: "POST", body: JSON.stringify(body) }),

  getPaused: (contractId: string) =>
    apiFetch<{ paused: boolean }>(`/${contractId}/paused`),
};
