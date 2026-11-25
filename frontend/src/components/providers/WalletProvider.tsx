"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  useReducer,
  ReactNode,
} from "react";
import type { ModuleInterface } from "@creit.tech/stellar-wallets-kit/types";
import { walletRegistry } from "@/lib/wallets";
import {
  INITIAL_WALLET_MACHINE_STATE,
  isUserRejection,
  toLegacyStatus,
  walletConnectionReducer,
  type WalletConnectionEvent,
  type WalletConnectionState,
} from "@/lib/wallets/connectionMachine";

export type WalletType =
  "freighter" | "albedo" | "xbull" | "hana" | "walletconnect" | "ledger";
export type ConnectionStatus =
  "idle" | "connecting" | "connected" | "error" | "unavailable";

const WALLET_MODULE_IDS: Record<WalletType, string> = {
  freighter: "freighter",
  albedo: "albedo",
  xbull: "xbull",
  hana: "hana",
  walletconnect: "wallet_connect",
  ledger: "LEDGER",
};
const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
const LEDGER_SIGNING_TIMEOUT_MS = 120_000;
const NETWORK_CONFIG: Record<string, { name: string; passphrase: string }> = {
  mainnet: {
    name: "Mainnet",
    passphrase: "Public Global Stellar Network ; September 2015",
  },
  testnet: { name: "Testnet", passphrase: TESTNET_PASSPHRASE },
  futurenet: {
    name: "Futurenet",
    passphrase: "Test SDF Future Network ; October 2022",
  },
  local: {
    name: "Local Standalone",
    passphrase: "Standalone Network ; February 2022",
  },
};
const SESSION_STORAGE_KEY = "stellar_wallet_session";
const SESSION_VERSION = 1;
const SESSION_INACTIVITY_MS = 30 * 60 * 1000;
const HORIZON_VALIDATION_INTERVAL_MS = 5 * 60 * 1000;
const HORIZON_URL_BY_PASSPHRASE: Record<string, string> = {
  "Public Global Stellar Network ; September 2015":
    "https://horizon.stellar.org",
  [TESTNET_PASSPHRASE]: "https://horizon-testnet.stellar.org",
  "Test SDF Future Network ; October 2022":
    "https://horizon-futurenet.stellar.org",
};
const walletConnectProjectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

interface PersistedWalletSession {
  version: 1;
  wallet: WalletType;
  address: string;
  network: string;
  networkPassphrase: string;
  lastActivityAt: number;
  signerKeys: string[];
}

type SessionValidation = "idle" | "checking" | "verified" | "unavailable";
interface HorizonAccountSnapshot {
  accountId: string;
  signerKeys: string[];
}

function isWalletType(value: unknown): value is WalletType {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(WALLET_MODULE_IDS, value)
  );
}

function parsePersistedSession(value: string | null): PersistedWalletSession | null {
  if (!value) return null;

  try {
    const session: unknown = JSON.parse(value);
    if (!session || typeof session !== "object") return null;

    const candidate = session as Partial<PersistedWalletSession>;
    if (
      candidate.version !== SESSION_VERSION ||
      !isWalletType(candidate.wallet) ||
      typeof candidate.address !== "string" ||
      !/^G[A-Z2-7]{55}$/.test(candidate.address) ||
      typeof candidate.network !== "string" ||
      typeof candidate.networkPassphrase !== "string" ||
      typeof candidate.lastActivityAt !== "number" ||
      !Number.isFinite(candidate.lastActivityAt) ||
      !Array.isArray(candidate.signerKeys) ||
      !candidate.signerKeys.every((key) => typeof key === "string")
    ) {
      return null;
    }

    return candidate as PersistedWalletSession;
  } catch {
    return null;
  }
}

function readPersistedSession(): PersistedWalletSession | null {
  // #1369 — never touch `window` during the server render. All callers run
  // inside effects or event handlers, but the guard keeps the helper safe if
  // the call graph ever changes and makes the SSR contract explicit.
  if (typeof window === "undefined") return null;
  try {
    return parsePersistedSession(window.localStorage.getItem(SESSION_STORAGE_KEY));
  } catch {
    return null;
  }
}

function writePersistedSession(session: PersistedWalletSession): void {
  try {
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {}
}

function removePersistedSession(): void {
  try {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {}
}

function walletErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string" && error.length > 0) return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return fallback;
}

function getConfiguredNetwork() {
  // #1369 — SSR guard: the server has no `localStorage`, so always fall back
  // to testnet during pre-render. The client adopts the stored network after
  // mount via the ledger-sync effect / explicit `connect`.
  if (typeof window === "undefined") return NETWORK_CONFIG.testnet;
  try {
    const networkId = window.localStorage.getItem("soroban_playground_network");
    if (networkId && NETWORK_CONFIG[networkId]) return NETWORK_CONFIG[networkId];
  } catch {}
  return NETWORK_CONFIG.testnet;
}

async function validateHorizonAccount(
  address: string,
  networkPassphrase: string,
): Promise<HorizonAccountSnapshot | null> {
  const horizonUrl = HORIZON_URL_BY_PASSPHRASE[networkPassphrase];
  if (!horizonUrl) throw new Error("No Horizon endpoint is configured for this network.");

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(
      `${horizonUrl}/accounts/${encodeURIComponent(address)}`,
      { signal: controller.signal },
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Horizon returned HTTP ${response.status}.`);

    const account = (await response.json()) as {
      account_id?: unknown;
      signers?: Array<{ key?: unknown }>;
    };
    if (account.account_id !== address || !Array.isArray(account.signers)) {
      throw new Error("Horizon returned an invalid account response.");
    }
    const signerKeys = account.signers
      .map((signer) => signer.key)
      .filter((key): key is string => typeof key === "string")
      .sort();
    return { accountId: address, signerKeys };
  } finally {
    window.clearTimeout(timeout);
  }
}

type WalletKit = typeof import("@creit.tech/stellar-wallets-kit/sdk").StellarWalletsKit;

let walletKitPromise: Promise<WalletKit> | null = null;

function initializeWalletKit(): Promise<WalletKit> {
  if (!walletKitPromise) {
    walletKitPromise = (async () => {
      const { Buffer } = await import("buffer");
      const bufferGlobal = globalThis as typeof globalThis & {
        Buffer?: typeof Buffer;
      };
      bufferGlobal.Buffer ??= Buffer;

      const [
        { StellarWalletsKit },
        { Networks },
        { AlbedoModule },
        { FreighterModule },
        { HanaModule },
        { xBullModule },
        { LedgerModule },
        { default: TransportWebHID },
        { default: TransportWebUSB },
      ] = await Promise.all([
        import("@creit.tech/stellar-wallets-kit/sdk"),
        import("@creit.tech/stellar-wallets-kit/types"),
        import("@creit.tech/stellar-wallets-kit/modules/albedo"),
        import("@creit.tech/stellar-wallets-kit/modules/freighter"),
        import("@creit.tech/stellar-wallets-kit/modules/hana"),
        import("@creit.tech/stellar-wallets-kit/modules/xbull"),
        import("@creit.tech/stellar-wallets-kit/modules/ledger"),
        import("@ledgerhq/hw-transport-webhid"),
        import("@ledgerhq/hw-transport-webusb"),
      ]);

      class BrowserLedgerModule extends LedgerModule {
        private browserTransport: { close: () => Promise<void> } | null = null;

        async isAvailable() {
          const [webHidAvailable, webUsbAvailable] = await Promise.all([
            TransportWebHID.isSupported(),
            TransportWebUSB.isSupported(),
          ]);
          return webHidAvailable || webUsbAvailable;
        }

        async transport() {
          if (this.browserTransport) return this.browserTransport;
          if (await TransportWebHID.isSupported()) {
            this.browserTransport = await TransportWebHID.create();
          } else if (await TransportWebUSB.isSupported()) {
            this.browserTransport = await TransportWebUSB.create();
          } else {
            throw new Error("This browser does not support Ledger WebHID or WebUSB.");
          }
          return this.browserTransport;
        }

        async disconnect() {
          const transport = this.browserTransport;
          this.browserTransport = null;
          await transport?.close();
          await super.disconnect();
        }
      }

      const modules: ModuleInterface[] = [
        new FreighterModule(),
        new xBullModule(),
        new AlbedoModule(),
        new HanaModule(),
        new BrowserLedgerModule(),
      ];

      if (walletConnectProjectId) {
        const { WalletConnectModule, WalletConnectTargetChain } = await import(
          "@creit.tech/stellar-wallets-kit/modules/wallet-connect"
        );
        modules.push(
          new WalletConnectModule({
            projectId: walletConnectProjectId,
            metadata: {
              name: "Soroban Playground",
              description: "Connect a Stellar wallet to Soroban Playground",
              url: window.location.origin,
              icons: [`${window.location.origin}/favicon.ico`],
            },
            allowedChains: [WalletConnectTargetChain.TESTNET],
          }),
        );
      }

      StellarWalletsKit.init({ modules, network: Networks.TESTNET });
      return StellarWalletsKit;
    })().catch((error) => {
      walletKitPromise = null;
      throw error;
    });
  }
  return walletKitPromise;
}

export interface WalletAccount {
  address: string;
  name?: string;
  isMultisig?: boolean;
}

export interface WalletContextType {
  activeWallet: WalletType | null;
  activeAccount: string | null;
  address: string | null; // Alias for activeAccount
  allAccounts: WalletAccount[];
  /** Legacy status string, derived from `connectionState`. */
  status: ConnectionStatus;
  /** DISCONNECTED -> CONNECTING -> CONNECTED -> SIGNING, or ERROR (#2035). */
  connectionState: WalletConnectionState;
  isSigning: boolean;
  network: string | null;
  networkPassphrase: string;
  error: string | null;
  sessionValidation: SessionValidation;
  reauthenticationRequired: boolean;
  reauthenticate: () => Promise<void>;
  connect: (type: WalletType, auto?: boolean) => Promise<void>;
  disconnect: () => void;
  switchAccount: (address: string) => void;
  signTransaction: (xdr: string) => Promise<string | null>;
  isWalletDetected: (type: WalletType) => boolean;
  retry: () => Promise<void>;
  lastAttemptedWallet: WalletType | null;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

/**
 * SSR-safe wallet initialization (#1369).
 *
 * The initial state is deliberately static (`idle` / `null` / empty) so the
 * server render and the hydration pass always agree. The persisted session,
 * the stored network and the detected browser wallets are adopted in mount
 * effects below — never during render — so direct `window`/`localStorage`
 * access can never leak into the server HTML or cause a layout shift.
 */
export function WalletProvider({ children }: { children: ReactNode }) {
  const [activeWallet, setActiveWallet] = useState<WalletType | null>(null);
  const [activeAccount, setActiveAccount] = useState<string | null>(null);
  const [allAccounts, setAllAccounts] = useState<WalletAccount[]>([]);
  const [machine, dispatch] = useReducer(
    walletConnectionReducer,
    INITIAL_WALLET_MACHINE_STATE,
  );
  const status: ConnectionStatus = toLegacyStatus(machine);
  const [network, setNetwork] = useState<string | null>(null);
  const [networkPassphrase, setNetworkPassphrase] =
    useState(TESTNET_PASSPHRASE);
  const [sessionValidation, setSessionValidation] =
    useState<SessionValidation>("idle");
  const [reauthenticationRequired, setReauthenticationRequired] =
    useState(false);
  const [reauthenticationWallet, setReauthenticationWallet] =
    useState<WalletType | null>(null);
  const [lastActivityAt, setLastActivityAt] = useState(0);
  const [horizonSignerKeys, setHorizonSignerKeys] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [detectedWallets, setDetectedWallets] = useState<Set<WalletType>>(
    () => new Set(),
  );
  const [lastAttemptedWallet, setLastAttemptedWallet] =
    useState<WalletType | null>(null);
  const lastActivityWriteRef = useRef(0);
  // #2035 — lifecycle guards. `isMountedRef` stops any async step from setting
  // state after unmount, and `attemptRef` numbers each connect attempt so a
  // wallet that answers after the user switched wallets or disconnected is
  // ignored instead of overwriting the newer session.
  const isMountedRef = useRef(false);
  const attemptRef = useRef(0);
  // Kept in step with the reducer by `send`, so callbacks read the current
  // state synchronously (a second sign in the same tick sees SIGNING).
  const machineRef = useRef(INITIAL_WALLET_MACHINE_STATE);
  const send = useCallback((event: WalletConnectionEvent) => {
    machineRef.current = walletConnectionReducer(machineRef.current, event);
    dispatch(event);
  }, []);
  const activeWalletRef = useRef<WalletType | null>(null);
  useEffect(() => {
    activeWalletRef.current = activeWallet;
  }, [activeWallet]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      attemptRef.current += 1;
    };
  }, []);

  const isCurrentAttempt = useCallback(
    (attempt: number) => isMountedRef.current && attempt === attemptRef.current,
    [],
  );

  const isWalletDetected = useCallback(
    (type: WalletType) => detectedWallets.has(type),
    [detectedWallets],
  );

  const refreshWallets = useCallback(async () => {
    const kit = await initializeWalletKit();
    const supportedWallets = await kit.refreshSupportedWallets();
    const detected = new Set<WalletType>();

    for (const [type, id] of Object.entries(WALLET_MODULE_IDS) as [
      WalletType,
      string,
    ][]) {
      if (
        (type === "walletconnect" && walletConnectProjectId) ||
        supportedWallets.some((wallet) => wallet.id === id && wallet.isAvailable)
      ) {
        detected.add(type);
      }
    }

    if (isMountedRef.current) setDetectedWallets(detected);
    return detected;
  }, []);

  const requireReauthentication = useCallback((wallet: WalletType) => {
    attemptRef.current += 1;
    removePersistedSession();
    setActiveWallet(null);
    setActiveAccount(null);
    setAllAccounts([]);
    setNetwork(null);
    setNetworkPassphrase(TESTNET_PASSPHRASE);
    send({ type: "DISCONNECT" });
    setSessionValidation("idle");
    setHorizonSignerKeys([]);
    setReauthenticationWallet(wallet);
    setReauthenticationRequired(true);
    setLastAttemptedWallet(null);
  }, [send]);

  const connect = useCallback(
    async (type: WalletType, auto = false) => {
      if (typeof window === "undefined") return;
      if (machineRef.current.state === "SIGNING") {
        setError("Finish or cancel the open signing request before switching wallets.");
        return;
      }

      const attempt = ++attemptRef.current;
      const previousWallet = activeWalletRef.current;
      setLastAttemptedWallet(type);
      send({ type: "CONNECT" });
      setError(null);

      try {
        let kit: any = null;
        try {
          kit = await initializeWalletKit();
        } catch (kitErr) {
          if (!isCurrentAttempt(attempt)) return;
          const adapter = walletRegistry.get(type as any);
          if (adapter) {
            const res = await adapter.connect(auto);
            if (!isCurrentAttempt(attempt)) return;
            setActiveWallet(type);
            setActiveAccount(res.address);
            setAllAccounts(
              res.allAccounts || [
                { address: res.address, name: `${type} Account` },
              ],
            );
            setNetwork(res.network || "TESTNET");
            setNetworkPassphrase(TESTNET_PASSPHRASE);
            send({ type: "CONNECTED" });
            setLastAttemptedWallet(null);
            if (typeof window !== "undefined") {
              try {
                window.localStorage.setItem("preferred_wallet", type);
                window.localStorage.setItem("preferred_account", res.address);
              } catch {}
            }
            return;
          }
          throw kitErr;
        }

        const availableWallets = await refreshWallets();
        if (!isCurrentAttempt(attempt)) return;

        if (!availableWallets.has(type)) {
          if (auto) {
            send({ type: "DISCONNECT" });
            setLastAttemptedWallet(null);
            return;
          }
          send({ type: "FAIL", kind: "unavailable" });
          setError(`${type} wallet is not available in this browser.`);
          return;
        }

        // Switching wallets: release the previous module (its listeners and,
        // for Ledger, the open HID transport) before selecting the new one.
        if (previousWallet && previousWallet !== type) {
          try {
            void Promise.resolve(kit.disconnect()).catch(() => {});
          } catch {}
        }

        kit.setWallet(WALLET_MODULE_IDS[type]);
        if (auto) {
          try {
            const { address } = await kit.getAddress();
            if (!isCurrentAttempt(attempt)) return;
            if (address) {
              const activityTime = Date.now();
              setActiveWallet(type);
              setActiveAccount(address);
              setAllAccounts([{ address, name: `${type} Account` }]);
              setNetwork("TESTNET");
              setNetworkPassphrase(TESTNET_PASSPHRASE);
              setLastActivityAt(activityTime);
              lastActivityWriteRef.current = activityTime;
              setReauthenticationRequired(false);
              setReauthenticationWallet(null);
              send({ type: "CONNECTED" });
            } else {
              send({ type: "DISCONNECT" });
            }
          } catch {
            if (!isCurrentAttempt(attempt)) return;
            send({ type: "DISCONNECT" });
          }
          setLastAttemptedWallet(null);
          return;
        }

        const { address } = await kit.fetchAddress();
        if (!isCurrentAttempt(attempt)) return;
        if (!address) throw new Error("Wallet returned no account address.");

        const configuredNetwork = getConfiguredNetwork();
        let net = configuredNetwork.name;
        let passphrase = configuredNetwork.passphrase;
        if (type !== "ledger") {
          try {
            const networkInfo = await kit.getNetwork();
            if (!isCurrentAttempt(attempt)) return;
            net = networkInfo.network;
            passphrase = networkInfo.networkPassphrase;
          } catch {}
        }

        setActiveWallet(type);
        setActiveAccount(address);
        setAllAccounts([{ address, name: `${type} Account` }]);
        setNetwork(net);
        setNetworkPassphrase(passphrase);
        setHorizonSignerKeys([]);
        send({ type: "CONNECTED" });
        setSessionValidation("checking");
        setReauthenticationRequired(false);
        setReauthenticationWallet(null);
        const activityTime = Date.now();
        lastActivityWriteRef.current = activityTime;
        setLastActivityAt(activityTime);
        setLastAttemptedWallet(null);

        try {
          window.localStorage.setItem("preferred_wallet", type);
        } catch {}
      } catch (err) {
        if (!isCurrentAttempt(attempt)) return;
        const rejected = isUserRejection(err);
        const msg = rejected
          ? "The connection request was rejected in the wallet."
          : walletErrorMessage(err, "Failed to connect wallet");
        send({ type: "FAIL", kind: rejected ? "rejected" : "failed" });
        setError(msg);
        if (!rejected) console.error("Wallet connection error:", msg);
      }
    },
    [refreshWallets, isCurrentAttempt, send],
  );

  const disconnect = useCallback(() => {
    // Cancels any connect attempt or session restore still in flight.
    attemptRef.current += 1;
    if (activeWallet) {
      void initializeWalletKit()
        .then((kit) => kit.disconnect())
        .catch(() => {});
    }
    setActiveWallet(null);
    setActiveAccount(null);
    setAllAccounts([]);
    setNetwork(null);
    setNetworkPassphrase(TESTNET_PASSPHRASE);
    send({ type: "DISCONNECT" });
    setSessionValidation("idle");
    setHorizonSignerKeys([]);
    setReauthenticationRequired(false);
    setReauthenticationWallet(null);
    setLastActivityAt(0);
    setError(null);
    setLastAttemptedWallet(null);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem("preferred_wallet");
      } catch {}
      removePersistedSession();
    }
  }, [activeWallet, send]);

  const reauthenticate = useCallback(async () => {
    if (reauthenticationWallet) await connect(reauthenticationWallet);
  }, [connect, reauthenticationWallet]);

  const switchAccount = useCallback((address: string) => {
    setActiveAccount((current) =>
      allAccounts.some((account) => account.address === address)
        ? address
        : current,
    );
  }, [allAccounts]);

  const retry = useCallback(async () => {
    if (lastAttemptedWallet) {
      await connect(lastAttemptedWallet);
    }
  }, [connect, lastAttemptedWallet]);

  const signTransaction = useCallback(
    async (xdr: string): Promise<string | null> => {
      if (machineRef.current.state === "SIGNING") {
        setError("A signing request is already open in your wallet.");
        return null;
      }
      if (!activeWallet || machineRef.current.state !== "CONNECTED") {
        const errMsg = "No wallet connected";
        setError(errMsg);
        console.error(errMsg);
        return null;
      }

      const attempt = attemptRef.current;
      send({ type: "SIGN_START" });
      let timeoutId: number | undefined;
      let kit: WalletKit | null = null;
      try {
        kit = await initializeWalletKit();
        kit.setWallet(WALLET_MODULE_IDS[activeWallet]);
        const signingRequest = kit.signTransaction(xdr, {
          networkPassphrase,
          address: activeWallet === "ledger" ? undefined : activeAccount ?? undefined,
        });
        const result =
          activeWallet === "ledger"
            ? await Promise.race([
                signingRequest,
                new Promise<never>((_, reject) => {
                  timeoutId = window.setTimeout(
                    () => reject(new Error("LEDGER_SIGNING_TIMEOUT")),
                    LEDGER_SIGNING_TIMEOUT_MS,
                  );
                }),
              ])
            : await signingRequest;
        if (!isCurrentAttempt(attempt)) return null;
        if (
          result.signerAddress &&
          activeAccount &&
          result.signerAddress !== activeAccount
        ) {
          requireReauthentication(activeWallet);
          setError("The wallet account changed. Reconnect to continue signing.");
          return null;
        }
        send({ type: "SIGN_DONE" });
        return result.signedTxXdr || null;
      } catch (err) {
        if (!isCurrentAttempt(attempt)) return null;
        if (
          activeWallet === "ledger" &&
          err instanceof Error &&
          err.message === "LEDGER_SIGNING_TIMEOUT"
        ) {
          if (kit) void kit.disconnect().catch(() => {});
          requireReauthentication("ledger");
          setError("Ledger confirmation timed out. Reconnect your device and try again.");
          return null;
        }
        send({ type: "SIGN_FAIL" });
        if (isUserRejection(err)) {
          setError("The transaction was rejected in the wallet.");
          return null;
        }
        const errMsg = walletErrorMessage(err, "Transaction signing failed");
        setError(errMsg);
        console.error("Transaction signing error:", errMsg);
        return null;
      } finally {
        if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      }
    },
    [
      activeWallet,
      activeAccount,
      networkPassphrase,
      requireReauthentication,
      isCurrentAttempt,
      send,
    ],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    let isMounted = true;

    void refreshWallets().catch((err) => {
      if (isMounted) {
        setError(walletErrorMessage(err, "Wallet discovery failed"));
      }
    });

    return () => {
      isMounted = false;
    };
  }, [refreshWallets]);

  useEffect(() => {
    if (typeof window === "undefined" || activeWallet !== "ledger") return;

    const syncSelectedNetwork = () => {
      const selectedNetwork = getConfiguredNetwork();
      setNetwork(selectedNetwork.name);
      setNetworkPassphrase(selectedNetwork.passphrase);
    };

    window.addEventListener("soroban-network-change", syncSelectedNetwork);
    return () =>
      window.removeEventListener("soroban-network-change", syncSelectedNetwork);
  }, [activeWallet]);

  useEffect(() => {
    if (typeof window === "undefined" || !activeWallet) return;
    const adapter = walletRegistry.get(activeWallet as any);
    if (!adapter) return;

    const unsubAccount = adapter.onAccountChange?.((address) => {
      if (!isMountedRef.current) return;
      setActiveAccount(address);
      try {
        window.localStorage.setItem("preferred_account", address);
      } catch {}
    });

    const unsubNetwork = adapter.onNetworkChange?.((net) => {
      if (!isMountedRef.current) return;
      setNetwork(net);
    });

    return () => {
      unsubAccount?.();
      unsubNetwork?.();
    };
  }, [activeWallet]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const session = readPersistedSession();
    if (!session) {
      removePersistedSession();
      return;
    }

    const now = Date.now();
    if (
      session.lastActivityAt > now + 60_000 ||
      now - session.lastActivityAt >= SESSION_INACTIVITY_MS
    ) {
      removePersistedSession();
      setReauthenticationWallet(session.wallet);
      setReauthenticationRequired(true);
      setError("Your wallet session expired after inactivity. Reconnect to continue.");
      return;
    }

    setActiveWallet(session.wallet);
    setActiveAccount(session.address);
    setAllAccounts([{ address: session.address, name: `${session.wallet} Account` }]);
    setNetwork(session.network);
    setNetworkPassphrase(session.networkPassphrase);
    setLastActivityAt(session.lastActivityAt);
    setHorizonSignerKeys(session.signerKeys);
    lastActivityWriteRef.current = session.lastActivityAt;

    // #2035 — auto-reconnect: a cached session is only trusted once the wallet
    // itself confirms it still exposes the same account. Until then the
    // provider is CONNECTING, so nothing can sign with a stale session.
    const attempt = ++attemptRef.current;
    send({ type: "CONNECT" });

    const adopt = () => {
      if (!isCurrentAttempt(attempt)) return;
      setSessionValidation("checking");
      send({ type: "CONNECTED" });
    };

    if (session.wallet === "ledger") {
      // A hardware wallet cannot be queried without a user gesture; the
      // device is re-checked when it signs and Horizon validates the account.
      adopt();
      return;
    }

    void (async () => {
      try {
        const kit = await initializeWalletKit();
        if (!isCurrentAttempt(attempt)) return;
        kit.setWallet(WALLET_MODULE_IDS[session.wallet]);
        const { address } = await kit.getAddress();
        if (!isCurrentAttempt(attempt)) return;
        if (address === session.address) {
          adopt();
          return;
        }
        requireReauthentication(session.wallet);
        setError(
          address
            ? "Your wallet is now on a different account. Reconnect to continue."
            : "Your wallet is locked or no longer connected. Reconnect to continue.",
        );
      } catch {
        if (!isCurrentAttempt(attempt)) return;
        requireReauthentication(session.wallet);
        setError("Your wallet could not be reached. Reconnect to continue.");
      }
    })();
  }, [isCurrentAttempt, requireReauthentication, send]);

  useEffect(() => {
    if (
      status !== "connected" ||
      !activeWallet ||
      !activeAccount ||
      !lastActivityAt
    ) {
      return;
    }

    writePersistedSession({
      version: SESSION_VERSION,
      wallet: activeWallet,
      address: activeAccount,
      network: network ?? "TESTNET",
      networkPassphrase,
      lastActivityAt,
      signerKeys: horizonSignerKeys,
    });
  }, [
    activeWallet,
    activeAccount,
    status,
    network,
    networkPassphrase,
    lastActivityAt,
    horizonSignerKeys,
  ]);

  useEffect(() => {
    if (status !== "connected" || !activeWallet || !activeAccount) return;
    let isMounted = true;

    const revalidate = async () => {
      setSessionValidation("checking");
      try {
        const snapshot = await validateHorizonAccount(
          activeAccount,
          networkPassphrase,
        );
        if (!isMounted) return;
        const existingSession = readPersistedSession();
        if (!snapshot) {
          if (
            existingSession?.wallet === activeWallet &&
            existingSession.address === activeAccount &&
            existingSession.signerKeys.length > 0
          ) {
            requireReauthentication(activeWallet);
            setError("This wallet account is no longer available on Horizon. Reconnect to continue.");
          } else {
            setSessionValidation("unavailable");
          }
          return;
        }

        const previousSignerKeys =
          existingSession?.wallet === activeWallet &&
          existingSession.address === activeAccount
            ? existingSession.signerKeys
            : horizonSignerKeys;
        if (
          previousSignerKeys.length > 0 &&
          JSON.stringify(previousSignerKeys) !== JSON.stringify(snapshot.signerKeys)
        ) {
          requireReauthentication(activeWallet);
          setError("The account signers changed. Reconnect your wallet to continue.");
          return;
        }

        // Keep the previous array when the signers are unchanged: a fresh
        // array would re-run this effect and re-query Horizon in a loop.
        setHorizonSignerKeys((current) =>
          JSON.stringify(current) === JSON.stringify(snapshot.signerKeys)
            ? current
            : snapshot.signerKeys,
        );
        setSessionValidation("verified");
      } catch {
        if (isMounted) setSessionValidation("unavailable");
      }
    };

    void revalidate();
    const interval = window.setInterval(
      revalidate,
      HORIZON_VALIDATION_INTERVAL_MS,
    );
    return () => {
      isMounted = false;
      window.clearInterval(interval);
    };
  }, [
    activeWallet,
    activeAccount,
    status,
    networkPassphrase,
    horizonSignerKeys,
    requireReauthentication,
  ]);

  useEffect(() => {
    if (status !== "connected" || !activeWallet || !activeAccount) return;

    let timeout: number;
    const checkInactivity = () => {
      const remaining = SESSION_INACTIVITY_MS - (Date.now() - lastActivityAt);
      if (remaining <= 0) {
        requireReauthentication(activeWallet);
        setError("Your wallet session expired after inactivity. Reconnect to continue.");
        return;
      }
      timeout = window.setTimeout(checkInactivity, remaining);
    };

    timeout = window.setTimeout(
      checkInactivity,
      Math.max(0, SESSION_INACTIVITY_MS - (Date.now() - lastActivityAt)),
    );
    return () => window.clearTimeout(timeout);
  }, [status, activeWallet, activeAccount, lastActivityAt, requireReauthentication]);

  useEffect(() => {
    if (status !== "connected" || !activeWallet || !activeAccount) return;

    const recordActivity = () => {
      const now = Date.now();
      if (now - lastActivityWriteRef.current < 15_000) return;
      lastActivityWriteRef.current = now;
      setLastActivityAt(now);

      const session = readPersistedSession();
      if (session?.wallet === activeWallet && session.address === activeAccount) {
        writePersistedSession({ ...session, lastActivityAt: now });
      }
    };

    window.addEventListener("pointerdown", recordActivity);
    window.addEventListener("keydown", recordActivity);
    window.addEventListener("touchstart", recordActivity);
    return () => {
      window.removeEventListener("pointerdown", recordActivity);
      window.removeEventListener("keydown", recordActivity);
      window.removeEventListener("touchstart", recordActivity);
    };
  }, [status, activeWallet, activeAccount]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncSession = (event: StorageEvent) => {
      if (event.key !== SESSION_STORAGE_KEY) return;
      const session = parsePersistedSession(event.newValue);
      if (!session && activeWallet) {
        requireReauthentication(activeWallet);
      } else if (
        session &&
        session.wallet === activeWallet &&
        session.address === activeAccount
      ) {
        setLastActivityAt(session.lastActivityAt);
      }
    };

    window.addEventListener("storage", syncSession);
    return () => window.removeEventListener("storage", syncSession);
  }, [activeWallet, activeAccount, requireReauthentication]);

  return (
    <WalletContext.Provider
      value={{
        activeWallet,
        activeAccount,
        address: activeAccount,
        allAccounts,
        status,
        connectionState: machine.state,
        isSigning: machine.state === "SIGNING",
        network,
        networkPassphrase,
        error,
        sessionValidation,
        reauthenticationRequired,
        reauthenticate,
        connect,
        disconnect,
        switchAccount,
        signTransaction,
        isWalletDetected,
        retry,
        lastAttemptedWallet,
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
