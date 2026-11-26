"use client";

import { useEffect, useState, useCallback, useRef } from "react";

export interface PeerUser {
  id: string;
  name: string;
  color: string;
  cursor?: { line: number; column: number };
  selection?: string;
  lastActive: string;
}

interface UseCollaborativeEditorOptions {
  wsUrl?: string;
  docId?: string;
  projectId?: string;
  userName?: string;
  enabled?: boolean;
}

export function useCollaborativeEditor({
  wsUrl = "ws://localhost:3001/ws",
  docId = "default-doc",
  projectId,
  userName = "User",
  enabled = true,
}: UseCollaborativeEditorOptions = {}) {
  const [peers, setPeers] = useState<PeerUser[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);

  const userColor = useRef(
    "#" +
      Math.floor(Math.random() * 16777215)
        .toString(16)
        .padStart(6, "0"),
  ).current;

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    let socket: WebSocket;
    try {
      socket = new WebSocket(wsUrl);
      socketRef.current = socket;

      socket.onopen = () => {
        setIsConnected(true);
        socket.send(
          JSON.stringify({
            type: "collaboration-join",
            docId,
            user: { name: userName, color: userColor },
            projectId,
          }),
        );
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "collaboration-presence" && data.docId === docId) {
            setPeers(data.peers || []);
          } else if (
            data.type === "collaboration-peer-cursor" &&
            data.docId === docId
          ) {
            setPeers((prev) =>
              prev.map((p) =>
                p.id === data.peerId ? { ...p, cursor: data.cursor } : p,
              ),
            );
          }
        } catch {
          // ignore non-json
        }
      };

      socket.onclose = () => {
        setIsConnected(false);
      };

      socket.onerror = () => {
        setIsConnected(false);
      };
    } catch {
      setIsConnected(false);
    }

    return () => {
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, [enabled, wsUrl, docId, userName, userColor, projectId]);

  const sendCursorUpdate = useCallback(
    (cursor: { line: number; column: number }) => {
      if (
        socketRef.current &&
        socketRef.current.readyState === WebSocket.OPEN
      ) {
        socketRef.current.send(
          JSON.stringify({
            type: "collaboration-cursor",
            docId,
            cursor,
          }),
        );
      }
    },
    [docId],
  );

  return {
    peers,
    isConnected,
    sendCursorUpdate,
  };
}
