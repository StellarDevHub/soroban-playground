"use client";

import { useState, useEffect, useCallback } from "react";

export interface FileMetadata {
  owner: string;
  name: string;
  size: number;
  shardCount: number;
  redundancyLevel: number;
  cid: string;
}

export interface ShardMetadata {
  shardId: number;
  hash: string;
  size: number;
  replicas: string[];
}

export interface StorageMetrics {
  totalCapacity: number;
  usedCapacity: number;
  activeOffers: number;
}

export function useCloudStorage() {
  const [files, setFiles] = useState<FileMetadata[]>([]);
  const [metrics, setMetrics] = useState<StorageMetrics>({ totalCapacity: 0, usedCapacity: 0, activeOffers: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ws, setWs] = useState<WebSocket | null>(null);

  const apiCall = useCallback(async (endpoint: string, options?: RequestInit) => {
    const response = await fetch(`/api/cloud-storage${endpoint}`, options);
    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error || 'API call failed');
    }
    return data.data;
  }, []);

  const uploadFile = useCallback(async (file: File, redundancyLevel: number = 3) => {
    setLoading(true);
    setError(null);
    try {
      // Simulate sharding (in real implementation, use a library like shard.js)
      const shardCount = Math.ceil(file.size / (1024 * 1024)); // 1MB shards
      const cid = `cid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Upload metadata
      await apiCall('/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: 'user-address', // In real app, get from wallet
          name: file.name,
          size: file.size,
          shardCount,
          redundancyLevel,
          cid,
        }),
      });

      // Simulate adding shards
      for (let i = 0; i < shardCount; i++) {
        const hash = `hash-${cid}-${i}`;
        await apiCall('/shard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cid,
            shardId: i,
            hash,
            size: Math.min(1024 * 1024, file.size - i * 1024 * 1024),
            provider: 'provider-address', // In real app, select provider
          }),
        });
      }

      await fetchFiles();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [apiCall]);

  const fetchFiles = useCallback(async () => {
    try {
      // In real implementation, fetch user's files
      // For now, just set empty
      setFiles([]);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const fetchMetrics = useCallback(async () => {
    try {
      // Fetch metrics from API
      setMetrics({ totalCapacity: 1000000, usedCapacity: 500000, activeOffers: 5 });
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const grantAccess = useCallback(async (cid: string, user: string) => {
    await apiCall('/access/grant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cid, user }),
    });
  }, [apiCall]);

  const revokeAccess = useCallback(async (cid: string, user: string) => {
    await apiCall('/access/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cid, user }),
    });
  }, [apiCall]);

  useEffect(() => {
    fetchFiles();
    fetchMetrics();

    // WebSocket for live updates
    const websocket = new WebSocket('ws://localhost:3001'); // Adjust URL
    setWs(websocket);

    websocket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'file_uploaded') {
        fetchFiles();
      } else if (data.type === 'metrics_updated') {
        fetchMetrics();
      }
    };

    return () => {
      websocket.close();
    };
  }, [fetchFiles, fetchMetrics]);

  return {
    files,
    metrics,
    loading,
    error,
    uploadFile,
    grantAccess,
    revokeAccess,
  };
}