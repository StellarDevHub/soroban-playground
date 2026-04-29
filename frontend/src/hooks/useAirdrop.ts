"use client";

import { useCallback, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";

export interface Campaign {
  id: number;
  admin: string;
  token: string;
  name: string;
  description: string;
  amountPerClaim: number;
  totalAmount: number;
  claimedAmount: number;
  remainingAmount: number;
  startTimestamp: number;
  endTimestamp: number;
  requireAllowlist: boolean;
  status: "active" | "ended";
  claimCount: number;
  allowlistSize: number;
  createdAt: number;
}

export interface CampaignStats {
  id: number;
  totalAmount: number;
  claimedAmount: number;
  remainingAmount: number;
  claimCount: number;
  allowlistSize: number;
  claimRate: string;
  status: string;
}

export interface EligibilityResult {
  eligible: boolean;
  hasClaimed: boolean;
  isAllowlisted: boolean;
  isActive: boolean;
  hasStarted: boolean;
  notExpired: boolean;
  hasFunds: boolean;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || "Request failed");
  return json.data as T;
}

export function useAirdrop() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wrap = useCallback(async <T>(fn: () => Promise<T>): Promise<T | null> => {
    setLoading(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const listCampaigns = useCallback(
    (params?: { status?: string; page?: number; limit?: number }) => {
      const qs = new URLSearchParams();
      if (params?.status) qs.set("status", params.status);
      if (params?.page) qs.set("page", String(params.page));
      if (params?.limit) qs.set("limit", String(params.limit));
      return wrap(() =>
        apiFetch<{ items: Campaign[]; total: number; page: number; limit: number }>(
          `/airdrop/campaigns?${qs}`
        )
      );
    },
    [wrap]
  );

  const getCampaign = useCallback(
    (id: number) => wrap(() => apiFetch<Campaign>(`/airdrop/campaigns/${id}`)),
    [wrap]
  );

  const createCampaign = useCallback(
    (body: Omit<Campaign, "id" | "claimedAmount" | "remainingAmount" | "claimCount" | "allowlistSize" | "createdAt">) =>
      wrap(() =>
        apiFetch<Campaign>("/airdrop/campaigns", {
          method: "POST",
          body: JSON.stringify(body),
        })
      ),
    [wrap]
  );

  const endCampaign = useCallback(
    (id: number, admin: string) =>
      wrap(() =>
        apiFetch<Campaign>(`/airdrop/campaigns/${id}/end`, {
          method: "POST",
          body: JSON.stringify({ admin }),
        })
      ),
    [wrap]
  );

  const getStats = useCallback(
    (id: number) => wrap(() => apiFetch<CampaignStats>(`/airdrop/campaigns/${id}/stats`)),
    [wrap]
  );

  const checkEligibility = useCallback(
    (campaignId: number, address: string) =>
      wrap(() =>
        apiFetch<EligibilityResult>(`/airdrop/campaigns/${campaignId}/eligibility/${address}`)
      ),
    [wrap]
  );

  const claim = useCallback(
    (campaignId: number, address: string) =>
      wrap(() =>
        apiFetch<{ amount: number }>(`/airdrop/campaigns/${campaignId}/claim`, {
          method: "POST",
          body: JSON.stringify({ address }),
        })
      ),
    [wrap]
  );

  const addToAllowlist = useCallback(
    (campaignId: number, addresses: string[]) =>
      wrap(() =>
        apiFetch<{ added: number }>(`/airdrop/campaigns/${campaignId}/allowlist`, {
          method: "POST",
          body: JSON.stringify({ addresses }),
        })
      ),
    [wrap]
  );

  return {
    loading,
    error,
    listCampaigns,
    getCampaign,
    createCampaign,
    endCampaign,
    getStats,
    checkEligibility,
    claim,
    addToAllowlist,
  };
}
