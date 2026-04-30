"use client";

import { useCallback, useEffect, useState } from "react";

// Freighter injects window.freighter in the browser
declare global {
  interface Window {
    freighter?: {
      isConnected: () => Promise<boolean>;
      getPublicKey: () => Promise<string>;
      getNetwork: () => Promise<string>;
      signTransaction: (xdr: string, opts?: { network?: string }) => Promise<string>;
    };
  }
}

export type WalletStatus = "idle" | "connecting" | "connected" | "error" | "unavailable";

export interface WalletState {
  status: WalletStatus;
  address: string | null;
  network: string | null;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  signTransaction: (xdr: string) => Promise<string | null>;
}

export function useFreighterWallet(): WalletState {
  const [status, setStatus] = useState<WalletStatus>("idle");
  const [address, setAddress] = useState<string | null>(null);
  const [network, setNetwork] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Check if Freighter is already connected on mount
  useEffect(() => {
    if (typeof window === "undefined") return;

    async function checkExisting() {
      if (!window.freighter) return;
      try {
        const connected = await window.freighter.isConnected();
        if (connected) {
          const [pub, net] = await Promise.all([
            window.freighter.getPublicKey(),
            window.freighter.getNetwork(),
          ]);
          setAddress(pub);
          setNetwork(net);
          setStatus("connected");
        }
      } catch {
        // Not connected yet — that's fine
      }
    }

    checkExisting();
  }, []);

  const connect = useCallback(async () => {
    if (typeof window === "undefined") return;

    if (!window.freighter) {
      setStatus("unavailable");
      setError("Freighter wallet extension not found. Install it from freighter.app");
      return;
    }

    setStatus("connecting");
    setError(null);

    try {
      const [pub, net] = await Promise.all([
        window.freighter.getPublicKey(),
        window.freighter.getNetwork(),
      ]);
      setAddress(pub);
      setNetwork(net);
      setStatus("connected");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Failed to connect wallet");
    }
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
    setNetwork(null);
    setStatus("idle");
    setError(null);
  }, []);

  const signTransaction = useCallback(
    async (xdr: string): Promise<string | null> => {
      if (!window.freighter || status !== "connected") return null;
      try {
        return await window.freighter.signTransaction(xdr, {
          network: network ?? "TESTNET",
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Transaction signing failed");
        return null;
      }
    },
    [status, network]
  );

  return { status, address, network, error, connect, disconnect, signTransaction };
}
