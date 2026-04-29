// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { cloudStorageKeys } from '@/lib/queryKeys/cloudStorage';

export function useCloudStorageEvents() {
  const queryClient = useQueryClient();

  useEffect(() => {
    // Use relative path to connect to same host
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws/cloud-storage-events`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[CloudStorage] WebSocket connected');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const type = msg.type;
        if (
          type === 'FileUploaded' ||
          type === 'ShardAssigned' ||
          type === 'ShardsRebalanced'
        ) {
          const fileId = msg.file_id;
          // Invalidate file query
          queryClient.invalidateQueries({ queryKey: cloudStorageKeys.file(fileId) });
        }
      } catch (err) {
        console.error('Failed to parse WebSocket message', err);
      }
    };

    ws.onerror = (err) => {
      console.error('[CloudStorage] WebSocket error', err);
    };

    ws.onclose = () => {
      console.log('[CloudStorage] WebSocket closed');
    };

    return () => {
      ws.close();
    };
  }, [queryClient]);
}
