"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import * as freighterApi from "@stellar/freighter-api";

export type WalletType = "freighter" | "soroban-wallet" | "albedo";
export type ConnectionStatus = "idle" | "connecting" | "connected" | "error" | "unavailable";

export interface WalletAccount {
  address: string;
  name?: string;
}

interface WalletContextType {
  activeWallet: WalletType | null;
  activeAccount: string | null;
  address: string | null; // Alias for activeAccount
  allAccounts: WalletAccount[];
  status: ConnectionStatus;
  network: string | null;
  error: string | null;
  connect: (type: WalletType, auto?: boolean) => Promise<void>;
  disconnect: () => void;
  switchAccount: (address: string) => void;
  signTransaction: (xdr: string) => Promise<string | null>;
  isWalletDetected: (type: WalletType) => boolean;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [activeWallet, setActiveWallet] = useState<WalletType | null>(null);
  const [activeAccount, setActiveAccount] = useState<string | null>(null);
  const [allAccounts, setAllAccounts] = useState<WalletAccount[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [network, setNetwork] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isWalletDetected = useCallback((type: WalletType) => {
    if (typeof window === "undefined") return false;
    switch (type) {
      case "freighter":
        // @ts-ignore
        return !!window.freighter || !!window.stellar || !!window.freighterApi;
      case "soroban-wallet":
        // @ts-ignore
        return !!window.soroban;
      default:
        return false;
    }
  }, []);

  const connect = useCallback(async (type: WalletType, auto = false) => {
    if (typeof window === "undefined") return;

    if (!isWalletDetected(type)) {
      setStatus("unavailable");
      setError(`${type} wallet extension not found.`);
      if (!auto) {
        window.alert(`${type} wallet extension is not installed or not detected in this browser. Please install the Freighter extension to connect.`);
      }
      return;
    }

    setStatus("connecting");
    setError(null);

    try {
      let address = "";
      let net = "";

      if (type === "freighter") {
        const allowedRes = await freighterApi.isAllowed();
        
        let isAllowed = allowedRes.isAllowed === true;
        
        if (!isAllowed) {
          if (auto) {
            // Do not prompt for access on auto-connect, wait for user interaction
            setStatus("idle");
            return;
          }
          const accessRes = await freighterApi.requestAccess();
          if (accessRes.error) throw new Error(accessRes.error);
          address = accessRes.address;
        } else {
          const addressRes = await freighterApi.getAddress();
          if (addressRes.error) throw new Error(addressRes.error);
          address = addressRes.address;
        }

        const networkRes = await freighterApi.getNetworkDetails();
        if (networkRes.error) throw new Error(networkRes.error);
        net = networkRes.network;
      } else if (type === "soroban-wallet") {
        // @ts-ignore
        const res = await window.soroban.getPublicKey();
        address = res;
        // @ts-ignore
        net = await window.soroban.getNetwork();
      }

      setActiveWallet(type);
      setActiveAccount(address);
      setAllAccounts([{ address }]);
      setNetwork(net);
      setStatus("connected");
      
      // Persist connection
      localStorage.setItem("preferred_wallet", type);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to connect wallet";
      setStatus("error");
      setError(msg);
      if (!auto) {
        window.alert(`Wallet Connection Error: ${msg}`);
      }
    }
  }, [isWalletDetected]);

  const disconnect = useCallback(() => {
    setActiveWallet(null);
    setActiveAccount(null);
    setAllAccounts([]);
    setNetwork(null);
    setStatus("idle");
    setError(null);
    localStorage.removeItem("preferred_wallet");
  }, []);

  const switchAccount = useCallback((address: string) => {
    setActiveAccount(address);
  }, []);

  const signTransaction = useCallback(async (xdr: string): Promise<string | null> => {
    if (!activeWallet || status !== "connected") {
      setError("No wallet connected");
      return null;
    }

    try {
      if (activeWallet === "freighter" && (window as any).freighter) {
        return await (window as any).freighter.signTransaction(xdr, {
          network: network ?? "TESTNET",
        });
      }
      // Add other wallet signing logic here
      return null;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transaction signing failed");
      return null;
    }
  }, [activeWallet, status, network]);

  // Auto-connect on mount if preferred wallet exists
  useEffect(() => {
    const preferred = localStorage.getItem("preferred_wallet") as WalletType | null;
    if (preferred && isWalletDetected(preferred)) {
      connect(preferred, true);
    }
  }, [connect, isWalletDetected]);

  return (
    <WalletContext.Provider
      value={{
        activeWallet,
        activeAccount,
        address: activeAccount,
        allAccounts,
        status,
        network,
        error,
        connect,
        disconnect,
        switchAccount,
        signTransaction,
        isWalletDetected,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return context;
}
