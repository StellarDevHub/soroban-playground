'use client';

import { useState, useCallback } from 'react';

const API = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:5000').replace(/\/$/, '');

async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message ?? 'Request failed');
  return json.data;
}

export interface Patent {
  title: string;
  description: string;
  owner: string;
  filing_date: number;
  expiry_date: number;
  status: 'Pending' | 'Active' | 'Expired' | 'Revoked';
  license_count: number;
}

export interface License {
  patent_id: number;
  licensee: string;
  license_type: 'Exclusive' | 'NonExclusive';
  fee: number;
  expiry_date: number;
  granted_date: number;
}

export interface Dispute {
  patent_id: number;
  claimant: string;
  reason: string;
  filed_date: number;
  status: 'Open' | 'Resolved';
  resolution: string;
}

export interface Stats {
  patentCount: number;
  licenseCount: number;
  disputeCount: number;
  paused: boolean;
}

export function usePatentRegistry() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async <T>(fn: () => Promise<T>): Promise<T | null> => {
    setLoading(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const getStats = useCallback(() =>
    run<Stats>(() => apiFetch('/api/patents/stats')), [run]);

  const getPatent = useCallback((id: number) =>
    run<Patent>(() => apiFetch(`/api/patents/${id}`)), [run]);

  const getLicense = useCallback((id: number) =>
    run<License>(() => apiFetch(`/api/patents/licenses/${id}`)), [run]);

  const getDispute = useCallback((id: number) =>
    run<Dispute>(() => apiFetch(`/api/patents/disputes/${id}`)), [run]);

  const filePatent = useCallback((body: {
    inventor: string; title: string; description: string; expiryDate: number;
  }) => run<number>(() => apiFetch('/api/patents/file', { method: 'POST', body: JSON.stringify(body) })), [run]);

  const activatePatent = useCallback((id: number, admin: string) =>
    run(() => apiFetch(`/api/patents/${id}/activate`, { method: 'POST', body: JSON.stringify({ admin }) })), [run]);

  const revokePatent = useCallback((id: number, admin: string) =>
    run(() => apiFetch(`/api/patents/${id}/revoke`, { method: 'POST', body: JSON.stringify({ admin }) })), [run]);

  const transferPatent = useCallback((id: number, owner: string, newOwner: string) =>
    run(() => apiFetch(`/api/patents/${id}/transfer`, { method: 'POST', body: JSON.stringify({ owner, newOwner }) })), [run]);

  const grantLicense = useCallback((id: number, body: {
    owner: string; licensee: string; licenseType: string; fee: number; expiryDate: number;
  }) => run<number>(() => apiFetch(`/api/patents/${id}/license`, { method: 'POST', body: JSON.stringify(body) })), [run]);

  const fileDispute = useCallback((body: { claimant: string; patentId: number; reason: string }) =>
    run<number>(() => apiFetch('/api/patents/disputes', { method: 'POST', body: JSON.stringify(body) })), [run]);

  const resolveDispute = useCallback((id: number, admin: string, resolution: string) =>
    run(() => apiFetch(`/api/patents/disputes/${id}/resolve`, { method: 'POST', body: JSON.stringify({ admin, resolution }) })), [run]);

  return {
    loading, error,
    getStats, getPatent, getLicense, getDispute,
    filePatent, activatePatent, revokePatent, transferPatent,
    grantLicense, fileDispute, resolveDispute,
  };
}
