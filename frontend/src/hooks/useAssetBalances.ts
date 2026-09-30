"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Address,
  Asset,
  Horizon,
  rpc,
  scValToNative,
} from "@stellar/stellar-sdk";

const SAC_STORAGE_PREFIX = "stellar_tracked_sac_v1";
const ACCOUNT_REFRESH_MS = 15_000;
const SAC_REFRESH_MS = 20_000;
const PRICE_REFRESH_MS = 60_000;
const MAX_TRACKED_SACS = 20;

const NETWORK_ENDPOINTS: Record<
  string,
  { horizonUrl: string; rpcUrl: string }
> = {
  "Public Global Stellar Network ; September 2015": {
    horizonUrl: "https://horizon.stellar.org",
    rpcUrl: "https://soroban-rpc.mainnet.stellar.org",
  },
  "Test SDF Network ; September 2015": {
    horizonUrl: "https://horizon-testnet.stellar.org",
    rpcUrl: "https://soroban-testnet.stellar.org",
  },
  "Test SDF Future Network ; October 2022": {
    horizonUrl: "https://horizon-futurenet.stellar.org",
    rpcUrl: "https://rpc-futurenet.stellar.org",
  },
  "Standalone Network ; February 2022": {
    horizonUrl: "",
    rpcUrl: "http://localhost:8000/soroban/rpc",
  },
};

export interface TrackedSacToken {
  contractId: string;
  symbol: string;
  name: string;
  decimals: number;
  marketAssetCode?: string;
  marketAssetIssuer?: string;
}

export interface AssetBalance {
  id: string;
  symbol: string;
  name: string;
  kind: "native" | "trustline" | "liquidity_pool" | "sac";
  issuer?: string;
  contractId?: string;
  amount: string;
  rawAmount: string;
  decimals: number;
  priceInXlm?: number;
  valueInXlm?: number;
  valueInUsd?: number;
  delta?: "up" | "down";
}

export type BalanceStreamStatus =
  | "idle"
  | "connecting"
  | "live"
  | "reconnecting"
  | "unavailable";

interface HorizonBalanceLine {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  liquidity_pool_id?: string;
  balance: string;
}

interface HorizonAccountSnapshot {
  balances: HorizonBalanceLine[];
}

function tokenStorageKey(account: string, networkPassphrase: string): string {
  return `${SAC_STORAGE_PREFIX}:${account}:${encodeURIComponent(networkPassphrase)}`;
}

function isContractId(value: unknown): value is string {
  return typeof value === "string" && /^C[A-Z2-7]{55}$/.test(value);
}

function isAccountId(value: unknown): value is string {
  return typeof value === "string" && /^G[A-Z2-7]{55}$/.test(value);
}

function parseTrackedTokens(value: string | null): TrackedSacToken[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (token): token is TrackedSacToken =>
        !!token &&
        typeof token === "object" &&
        isContractId((token as TrackedSacToken).contractId) &&
        typeof (token as TrackedSacToken).symbol === "string" &&
        typeof (token as TrackedSacToken).name === "string" &&
        Number.isInteger((token as TrackedSacToken).decimals) &&
        (token as TrackedSacToken).decimals >= 0 &&
        (token as TrackedSacToken).decimals <= 18 &&
        ((token as TrackedSacToken).marketAssetCode === undefined ||
          typeof (token as TrackedSacToken).marketAssetCode === "string") &&
        ((token as TrackedSacToken).marketAssetIssuer === undefined ||
          isAccountId((token as TrackedSacToken).marketAssetIssuer)),
    );
  } catch {
    return [];
  }
}

function decimalToRaw(amount: string, decimals: number): string {
  const [whole = "0", fraction = ""] = amount.split(".");
  const digits = `${whole}${fraction.padEnd(decimals, "0").slice(0, decimals)}`;
  return BigInt(digits || "0").toString();
}

function rawToDecimal(rawAmount: bigint, decimals: number): string {
  const negative = rawAmount < 0n;
  const digits = (negative ? -rawAmount : rawAmount)
    .toString()
    .padStart(decimals + 1, "0");
  if (decimals === 0) return `${negative ? "-" : ""}${digits}`;

  const whole = digits.slice(0, -decimals);
  const fraction = digits.slice(-decimals).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function compareRawAmounts(left: string, right: string): -1 | 0 | 1 {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);
  return leftValue === rightValue ? 0 : leftValue > rightValue ? 1 : -1;
}

function addDeltas(previous: AssetBalance[], next: AssetBalance[]): AssetBalance[] {
  const previousById = new Map(previous.map((balance) => [balance.id, balance]));
  return next.map((balance) => {
    const previousBalance = previousById.get(balance.id);
    if (!previousBalance) return balance;
    const comparison = compareRawAmounts(
      balance.rawAmount,
      previousBalance.rawAmount,
    );
    return {
      ...balance,
      delta: comparison === 0 ? undefined : comparison > 0 ? "up" : "down",
    };
  });
}

function toHorizonBalances(account: HorizonAccountSnapshot): AssetBalance[] {
  return account.balances.map((line) => {
    if (line.asset_type === "native") {
      return {
        id: "native:XLM",
        symbol: "XLM",
        name: "Stellar Lumens",
        kind: "native",
        amount: line.balance,
        rawAmount: decimalToRaw(line.balance, 7),
        decimals: 7,
      };
    }

    if (line.asset_type === "liquidity_pool_shares") {
      const poolId = line.liquidity_pool_id ?? "unknown";
      return {
        id: `liquidity-pool:${poolId}`,
        symbol: "LP shares",
        name: "Liquidity pool shares",
        kind: "liquidity_pool",
        issuer: poolId,
        amount: line.balance,
        rawAmount: decimalToRaw(line.balance, 7),
        decimals: 7,
      };
    }

    const code = line.asset_code ?? "ASSET";
    const issuer = line.asset_issuer ?? "";
    return {
      id: `trustline:${code}:${issuer}`,
      symbol: code,
      name: code,
      kind: "trustline",
      issuer,
      amount: line.balance,
      rawAmount: decimalToRaw(line.balance, 7),
      decimals: 7,
    };
  });
}

function toSacBalance(
  token: TrackedSacToken,
  rawValue: unknown,
): AssetBalance {
  const value =
    typeof rawValue === "bigint" ? rawValue : BigInt(String(rawValue ?? 0));
  const rawAmount = value.toString();
  return {
    id: `sac:${token.contractId}`,
    symbol: token.symbol,
    name: token.name,
    kind: "sac",
    contractId: token.contractId,
    amount: rawToDecimal(value, token.decimals),
    rawAmount,
    decimals: token.decimals,
    issuer: token.marketAssetIssuer,
  };
}

function readStoredTokens(
  account: string,
  networkPassphrase: string,
): TrackedSacToken[] {
  try {
    return parseTrackedTokens(
      window.localStorage.getItem(tokenStorageKey(account, networkPassphrase)),
    );
  } catch {
    return [];
  }
}

export function useAssetBalances(
  account: string | null,
  networkPassphrase: string,
) {
  const [horizonBalances, setHorizonBalances] = useState<AssetBalance[]>([]);
  const [sacBalances, setSacBalances] = useState<AssetBalance[]>([]);
  const [trackedSacs, setTrackedSacs] = useState<TrackedSacToken[]>([]);
  const [trackedScope, setTrackedScope] = useState<string | null>(null);
  const [streamStatus, setStreamStatus] =
    useState<BalanceStreamStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [sacError, setSacError] = useState<string | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [xlmUsd, setXlmUsd] = useState<number | null>(null);
  const [tokenPricesInXlm, setTokenPricesInXlm] = useState<
    Record<string, number>
  >({});
  const sacRequestGeneration = useRef(0);
  const priceRequestGeneration = useRef(0);
  const lastKnownSacBalances = useRef(new Map<string, AssetBalance>());

  const endpoints = NETWORK_ENDPOINTS[networkPassphrase];

  useEffect(() => {
    sacRequestGeneration.current += 1;
    lastKnownSacBalances.current.clear();
    if (!account) {
      setTrackedSacs([]);
      setTrackedScope(null);
      setHorizonBalances([]);
      setSacBalances([]);
      setStreamStatus("idle");
      return;
    }
    setTrackedScope(tokenStorageKey(account, networkPassphrase));
    setTrackedSacs(readStoredTokens(account, networkPassphrase));
    setSacBalances([]);
  }, [account, networkPassphrase]);

  useEffect(() => {
    if (!account || !endpoints) {
      setHorizonBalances([]);
      setStreamStatus(account ? "unavailable" : "idle");
      return;
    }
    if (!endpoints.horizonUrl) {
      setStreamStatus("unavailable");
      setError("Horizon balance streaming is not configured for this network.");
      return;
    }

    let active = true;
    const server = new Horizon.Server(endpoints.horizonUrl);
    setHorizonBalances([]);
    setStreamStatus("connecting");
    setError(null);

    const applyAccount = (snapshot: HorizonAccountSnapshot) => {
      if (!active) return;
      const next = toHorizonBalances(snapshot);
      setHorizonBalances((previous) => addDeltas(previous, next));
      setError(null);
      setStreamStatus("live");
    };

    const refreshAccount = async () => {
      try {
        const snapshot = (await server
          .accounts()
          .accountId(account)
          .call()) as HorizonAccountSnapshot;
        applyAccount(snapshot);
      } catch (cause) {
        if (active) {
          setError(
            cause instanceof Error ? cause.message : "Unable to load account balances.",
          );
          setStreamStatus((status) =>
            status === "live" ? "reconnecting" : "connecting",
          );
        }
      }
    };

    void refreshAccount();
    const closeStream = server
      .accounts()
      .accountId(account)
      .stream({
        onmessage: applyAccount,
        onerror: () => {
          if (active) setStreamStatus("reconnecting");
        },
      });
    const fallbackInterval = window.setInterval(refreshAccount, ACCOUNT_REFRESH_MS);

    return () => {
      active = false;
      closeStream();
      window.clearInterval(fallbackInterval);
    };
  }, [account, endpoints]);

  const refreshSacBalances = useCallback(async (tokens = trackedSacs) => {
    const requestGeneration = ++sacRequestGeneration.current;
    if (!account || !endpoints || tokens.length === 0) {
      setSacBalances([]);
      setSacError(null);
      return;
    }

    let server: rpc.Server;
    try {
      server = new rpc.Server(endpoints.rpcUrl, {
        allowHttp: endpoints.rpcUrl.startsWith("http://"),
      });
    } catch (cause) {
      setSacError(
        cause instanceof Error
          ? cause.message
          : "Unable to initialize Soroban RPC.",
      );
      return;
    }
    const results = await Promise.all(
      tokens.map(async (token) => {
        try {
          const result = await server.getContractData(
            token.contractId,
            new Address(account).toScVal(),
            rpc.Durability.Persistent,
          );
          const storageValue = result.val.contractData().val();
          return toSacBalance(token, scValToNative(storageValue));
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "";
          if (/not found|404/i.test(message)) return toSacBalance(token, 0n);
          return null;
        }
      }),
    );
    if (requestGeneration !== sacRequestGeneration.current) return;

    const next = results.filter((result): result is AssetBalance => result !== null);
    if (next.length !== results.length) {
      setSacError("Some SAC balances could not be refreshed; showing the last known values.");
    } else {
      setSacError(null);
    }
    for (const balance of next) {
      lastKnownSacBalances.current.set(balance.id, balance);
    }

    setSacBalances((previous) => {
      const previousById = new Map(previous.map((balance) => [balance.id, balance]));
      const nextById = new Map(next.map((balance) => [balance.id, balance]));
      const merged = tokens.flatMap((token) => {
        const id = `sac:${token.contractId}`;
        const balance =
          nextById.get(id) ??
          previousById.get(id) ??
          lastKnownSacBalances.current.get(id);
        return balance ? [balance] : [];
      });
      return addDeltas(previous, merged);
    });
  }, [account, endpoints, trackedSacs]);

  useEffect(() => {
    if (!account || trackedSacs.length === 0) return;
    void refreshSacBalances();
    const interval = window.setInterval(refreshSacBalances, SAC_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [account, refreshSacBalances, trackedSacs.length]);

  const quoteAssets = useMemo(() => {
    const trustlines = horizonBalances
      .filter((balance) => balance.kind === "trustline" && balance.issuer)
      .map((balance) => ({
        id: balance.id,
        code: balance.symbol,
        issuer: balance.issuer as string,
      }));
    const sacMarketAssets = trackedSacs
      .filter((token) => token.marketAssetCode && token.marketAssetIssuer)
      .map((token) => ({
        id: `sac:${token.contractId}`,
        code: token.marketAssetCode as string,
        issuer: token.marketAssetIssuer as string,
      }));
    return [...trustlines, ...sacMarketAssets].slice(0, 20);
  }, [horizonBalances, trackedSacs]);

  const refreshPrices = useCallback(async () => {
    const requestGeneration = ++priceRequestGeneration.current;
    const nextPrices: Record<string, number> = {};
    try {
      const response = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd",
      );
      if (!response.ok) throw new Error(`Price service returned HTTP ${response.status}.`);
      const quote = (await response.json()) as { stellar?: { usd?: number } };
      if (requestGeneration === priceRequestGeneration.current) {
        if (typeof quote.stellar?.usd === "number") setXlmUsd(quote.stellar.usd);
        setPriceError(null);
      }
    } catch (cause) {
      if (requestGeneration === priceRequestGeneration.current) {
        setPriceError(cause instanceof Error ? cause.message : "XLM price unavailable.");
      }
    }

    if (!endpoints?.horizonUrl) return;
    const server = new Horizon.Server(endpoints.horizonUrl);
    const prices = await Promise.all(
      quoteAssets.map(async (asset) => {
        try {
          const orderbook = await server
            .orderbook(new Asset(asset.code, asset.issuer), Asset.native())
            .call();
          const bestBid = Number(orderbook.bids[0]?.price);
          const bestAsk = Number(orderbook.asks[0]?.price);
          const price =
            Number.isFinite(bestBid) && Number.isFinite(bestAsk)
              ? (bestBid + bestAsk) / 2
              : Number.isFinite(bestBid)
                ? bestBid
                : Number.isFinite(bestAsk)
                  ? bestAsk
                  : null;
          return price && price > 0 ? ([asset.id, price] as const) : null;
        } catch {
          return null;
        }
      }),
    );
    for (const price of prices) {
      if (price) nextPrices[price[0]] = price[1];
    }
    if (requestGeneration === priceRequestGeneration.current) {
      setTokenPricesInXlm((previous) => ({ ...previous, ...nextPrices }));
    }
  }, [endpoints, quoteAssets]);

  useEffect(() => {
    setTokenPricesInXlm({});
    setTokenPricesInXlm({});
    void refreshPrices();
    const interval = window.setInterval(refreshPrices, PRICE_REFRESH_MS);
    return () => {
      priceRequestGeneration.current += 1;
      window.clearInterval(interval);
    };
  }, [refreshPrices]);

  useEffect(() => {
    const scope = account ? tokenStorageKey(account, networkPassphrase) : null;
    if (!scope || scope !== trackedScope) return;
    try {
      window.localStorage.setItem(
        scope,
        JSON.stringify(trackedSacs),
      );
    } catch {
      setSacError("Custom SAC tracking could not be saved in browser storage.");
    }
  }, [account, networkPassphrase, trackedSacs, trackedScope]);

  const addSac = useCallback(
    (token: TrackedSacToken) => {
      if (!account) return "Connect a wallet before adding SACs.";
      if (!isContractId(token.contractId)) return "Enter a valid Stellar contract ID.";
      if (!/^[A-Za-z0-9._-]{1,12}$/.test(token.symbol)) {
        return "Token symbol must be 1-12 letters, numbers, dots, underscores, or hyphens.";
      }
      if (!token.name.trim()) return "Enter a token name.";
      if (!Number.isInteger(token.decimals) || token.decimals < 0 || token.decimals > 18) {
        return "Decimals must be between 0 and 18.";
      }
      if (
        token.marketAssetIssuer &&
        !isAccountId(token.marketAssetIssuer)
      ) {
        return "The optional market issuer must be a Stellar account address.";
      }
      if (
        Boolean(token.marketAssetCode) !== Boolean(token.marketAssetIssuer)
      ) {
        return "Enter both market asset code and issuer to enable DEX pricing.";
      }
      if (trackedSacs.some((existing) => existing.contractId === token.contractId)) {
        return "This contract is already being tracked.";
      }
      if (trackedSacs.length >= MAX_TRACKED_SACS) {
        return `You can track up to ${MAX_TRACKED_SACS} SAC contracts per account.`;
      }
      const nextTokens = [
        ...trackedSacs,
        { ...token, name: token.name.trim() },
      ];
      setTrackedSacs(nextTokens);
      void refreshSacBalances(nextTokens);
      return null;
    },
    [account, refreshSacBalances, trackedSacs],
  );

  const removeSac = useCallback((contractId: string) => {
    setTrackedSacs((current) =>
      current.filter((token) => token.contractId !== contractId),
    );
    setSacBalances((current) =>
      current.filter((balance) => balance.contractId !== contractId),
    );
  }, []);

  const balances = useMemo(() => {
    const xlmUsdPrice = xlmUsd;
    return [...horizonBalances, ...sacBalances].map((balance) => {
      const priceInXlm =
        balance.kind === "native" ? 1 : tokenPricesInXlm[balance.id];
      const amountNumber = Number(balance.amount);
      const valueInXlm =
        priceInXlm !== undefined && Number.isFinite(amountNumber)
          ? amountNumber * priceInXlm
          : undefined;
      return {
        ...balance,
        priceInXlm,
        valueInXlm,
        valueInUsd:
          valueInXlm !== undefined && xlmUsdPrice !== null
            ? valueInXlm * xlmUsdPrice
            : undefined,
      };
    });
  }, [horizonBalances, sacBalances, tokenPricesInXlm, xlmUsd]);

  const refresh = useCallback(() => {
    void refreshSacBalances();
    void refreshPrices();
  }, [refreshPrices, refreshSacBalances]);

  return {
    balances,
    trackedSacs,
    addSac,
    removeSac,
    refresh,
    streamStatus,
    error,
    sacError,
    priceError,
    xlmUsd,
  };
}

export const assetBalanceInternals = {
  parseTrackedTokens,
  rawToDecimal,
  toHorizonBalances,
  toSacBalance,
};