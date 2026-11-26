"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  YjsCollaborationProvider,
  type CollaborationStatus,
  type MonacoBindingFactory,
} from "@/collaboration/yjsProvider";
import type { CursorPosition, PeerPresence } from "@/collaboration/yjsPresence";

interface UseYjsCollaborationOptions {
  wsUrl: string;
  docId: string;
  userName: string;
  enabled?: boolean;
  bindingFactory?: MonacoBindingFactory;
}

export function useYjsCollaboration({
  wsUrl,
  docId,
  userName,
  enabled = true,
  bindingFactory,
}: UseYjsCollaborationOptions) {
  const provider = useMemo(
    () =>
      new YjsCollaborationProvider({
        wsUrl,
        docId,
        userName,
      }),
    [wsUrl, docId, userName],
  );

  const [status, setStatus] = useState<CollaborationStatus>(
    provider.getStatus(),
  );
  const [peers, setPeers] = useState<PeerPresence[]>(provider.getPeers());

  useEffect(() => {
    const unsubscribe = provider.subscribe(() => {
      setStatus(provider.getStatus());
      setPeers(provider.getPeers());
    });

    if (enabled) provider.connect();

    return () => {
      unsubscribe();
      provider.destroy();
    };
  }, [provider, enabled]);

  useEffect(() => {
    if (bindingFactory) provider.attachBinding(bindingFactory);
  }, [provider, bindingFactory]);

  const updateCursor = useCallback(
    (cursor: CursorPosition, selection?: string) => {
      provider.updateCursor(cursor, selection);
    },
    [provider],
  );

  return { provider, status, peers, updateCursor };
}
