"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  ReactNode,
} from "react";
import {
  WalletType,
  ConnectionStatus,
  WalletAccount,
  WalletAdapter,
  walletRegistry,
} from "@/lib/wallets";

export type { WalletType, ConnectionStatus, WalletAccount, WalletAdapter };

export interface WalletContextType {
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
  signTransaction: (
    xdr: string,
    options?: { networkPassphrase?: string; network?: string },
  ) => Promise<string | null>;
  isWalletDetected: (type: WalletType) => boolean;
  retry: () => Promise<void>;
  lastAttemptedWallet: WalletType | null;
  adapters: WalletAdapter[];
  isModalOpen: boolean;
  openWalletModal: () => void;
  closeWalletModal: () => void;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

const PREFERRED_WALLET_KEY = "preferred_wallet";
const PREFERRED_ACCOUNT_KEY = "preferred_account";

export function WalletProvider({ children }: { children: ReactNode }) {
  const [activeWallet, setActiveWallet] = useState<WalletType | null>(null);
  const [activeAccount, setActiveAccount] = useState<string | null>(null);
  const [allAccounts, setAllAccounts] = useState<WalletAccount[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [network, setNetwork] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastAttemptedWallet, setLastAttemptedWallet] =
    useState<WalletType | null>(null);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);

  const [detectedWallets, setDetectedWallets] = useState<
    Record<WalletType, boolean>
  >({
    freighter: true,
    xbull: false,
    albedo: true,
    hana: false,
    walletconnect: true,
    rango: true,
    "soroban-wallet": false,
  });

  const activeUnsubscribersRef = useRef<Array<() => void>>([]);

  const cleanupListeners = useCallback(() => {
    activeUnsubscribersRef.current.forEach((unsub) => {
      try {
        unsub();
      } catch (err) {
        console.warn("Error cleaning up wallet listener:", err);
      }
    });
    activeUnsubscribersRef.current = [];
  }, []);

  const refreshDetection = useCallback(async () => {
    if (typeof window === "undefined") return;
    const adapters = walletRegistry.getAll();
    const results: Record<string, boolean> = {};

    await Promise.all(
      adapters.map(async (adapter) => {
        try {
          const available = await adapter.isAvailable();
          results[adapter.id] = available;
        } catch {
          results[adapter.id] = false;
        }
      }),
    );

    setDetectedWallets((prev) => ({ ...prev, ...results }));
  }, []);

  useEffect(() => {
    refreshDetection();
    const timer = setTimeout(refreshDetection, 500);
    return () => clearTimeout(timer);
  }, [refreshDetection]);

  const isWalletDetected = useCallback(
    (type: WalletType) => {
      if (typeof window === "undefined") return false;
      return !!detectedWallets[type];
    },
    [detectedWallets],
  );

  const disconnect = useCallback(() => {
    cleanupListeners();
    const adapter = activeWallet ? walletRegistry.get(activeWallet) : null;
    if (adapter) {
      try {
        adapter.disconnect();
      } catch (err) {
        console.warn("Adapter disconnect error:", err);
      }
    }

    setActiveWallet(null);
    setActiveAccount(null);
    setAllAccounts([]);
    setNetwork(null);
    setStatus("idle");
    setError(null);
    setLastAttemptedWallet(null);

    if (typeof window !== "undefined") {
      localStorage.removeItem(PREFERRED_WALLET_KEY);
      localStorage.removeItem(PREFERRED_ACCOUNT_KEY);
    }
  }, [activeWallet, cleanupListeners]);

  const connect = useCallback(
    async (type: WalletType, auto = false) => {
      if (typeof window === "undefined") return;

      setLastAttemptedWallet(type);
      const adapter = walletRegistry.get(type);

      if (!adapter) {
        setStatus("unavailable");
        setError(`Wallet adapter for ${type} is not registered.`);
        return;
      }

      const available = await adapter.isAvailable();
      if (!available && !auto) {
        setStatus("unavailable");
        setError(`${adapter.name} extension or application is not detected.`);
        return;
      }

      setStatus("connecting");
      setError(null);

      try {
        const result = await adapter.connect(auto);
        const address = result.address;
        const net = result.network ?? "TESTNET";
        const accounts =
          result.allAccounts && result.allAccounts.length > 0
            ? result.allAccounts
            : [{ address, name: `${adapter.name} Account` }];

        cleanupListeners();

        // Subscribe to account changes
        if (typeof adapter.onAccountChange === "function") {
          const unsub = adapter.onAccountChange((newAddress: string) => {
            if (newAddress && newAddress !== address) {
              setActiveAccount(newAddress);
              setAllAccounts((prev) => {
                const exists = prev.some((acc) => acc.address === newAddress);
                if (exists) return prev;
                return [{ address: newAddress, name: "Active Account" }, ...prev];
              });
              localStorage.setItem(PREFERRED_ACCOUNT_KEY, newAddress);
            }
          });
          if (typeof unsub === "function") {
            activeUnsubscribersRef.current.push(unsub);
          }
        }

        // Subscribe to network changes
        if (typeof adapter.onNetworkChange === "function") {
          const unsub = adapter.onNetworkChange((newNetwork: string) => {
            if (newNetwork) {
              setNetwork(newNetwork);
            }
          });
          if (typeof unsub === "function") {
            activeUnsubscribersRef.current.push(unsub);
          }
        }

        setActiveWallet(type);
        setActiveAccount(address);
        setAllAccounts(accounts);
        setNetwork(net);
        setStatus("connected");
        setLastAttemptedWallet(null);

        localStorage.setItem(PREFERRED_WALLET_KEY, type);
        localStorage.setItem(PREFERRED_ACCOUNT_KEY, address);
      } catch (err) {
        if (auto) {
          setStatus("idle");
          return;
        }
        const msg =
          err instanceof Error ? err.message : "Failed to connect wallet";
        setStatus("error");
        setError(msg);
        console.error("Wallet connection error:", msg);
      }
    },
    [cleanupListeners],
  );

  const switchAccount = useCallback((address: string) => {
    setActiveAccount(address);
    if (typeof window !== "undefined") {
      localStorage.setItem(PREFERRED_ACCOUNT_KEY, address);
    }
  }, []);

  const retry = useCallback(async () => {
    if (lastAttemptedWallet) {
      await connect(lastAttemptedWallet);
    }
  }, [connect, lastAttemptedWallet]);

  const signTransaction = useCallback(
    async (
      xdr: string,
      options?: { networkPassphrase?: string; network?: string },
    ): Promise<string | null> => {
      if (!activeWallet || status !== "connected") {
        const errMsg = "No wallet connected";
        setError(errMsg);
        console.error(errMsg);
        return null;
      }

      const adapter = walletRegistry.get(activeWallet);
      if (!adapter) {
        const errMsg = `Adapter not found for ${activeWallet}`;
        setError(errMsg);
        return null;
      }

      try {
        return await adapter.signTransaction(xdr, {
          networkPassphrase:
            options?.networkPassphrase ??
            (network === "PUBLIC"
              ? "Public Global Stellar Network ; September 2015"
              : "Test SDF Network ; November 2015"),
          network: options?.network ?? network ?? "TESTNET",
          accountToSign: activeAccount ?? undefined,
        });
      } catch (err) {
        const errMsg =
          err instanceof Error ? err.message : "Transaction signing failed";
        setError(errMsg);
        console.error("Transaction signing error:", errMsg);
        return null;
      }
    },
    [activeWallet, status, network, activeAccount],
  );

  // Auto-reconnect on startup with network verification
  useEffect(() => {
    if (typeof window === "undefined") return;

    const preferredWallet = localStorage.getItem(
      PREFERRED_WALLET_KEY,
    ) as WalletType | null;

    if (preferredWallet) {
      connect(preferredWallet, true);
    }
  }, [connect]);

  // Clean up listeners on unmount
  useEffect(() => {
    return () => {
      cleanupListeners();
    };
  }, [cleanupListeners]);

  const openWalletModal = useCallback(() => setIsModalOpen(true), []);
  const closeWalletModal = useCallback(() => setIsModalOpen(false), []);

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
        retry,
        lastAttemptedWallet,
        adapters: walletRegistry.getAll(),
        isModalOpen,
        openWalletModal,
        closeWalletModal,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextType {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return context;
}
