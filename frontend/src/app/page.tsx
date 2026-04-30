import WarrantyPanel from '@/components/WarrantyPanel';
"use client";

import {
  startTransition,
  useEffect,
  useEffectEvent,
  useState,
  type ReactNode,
} from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BadgeDollarSign,
  Boxes,
  CheckCircle2,
  Coins,
  LoaderCircle,
  RadioTower,
  Shield,
  Signature,
  TrendingUp,
  Wallet,
  Waves,
} from "lucide-react";

const DEFAULT_API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ||
  "http://localhost:5000";
const DEFAULT_CONTRACT_ID =
  process.env.NEXT_PUBLIC_SYNTHETIC_CONTRACT_ID?.trim() || "";
const DEMO_ACCOUNT = "GDEMO4MV6L6QY6P4UQBW5SC4R6X4P7WALLET";
const CONTRACT_ID_PATTERN = /^C[A-Z0-9]{55}$/;
const MIN_COLLATERAL_RATIO = 150;
const LIQUIDATION_THRESHOLD = 120;
const MIN_TRADE_MARGIN = 25;

type HealthState = "checking" | "online" | "offline";
type ActionMode = "register" | "mint" | "collateral" | "trade" | "oracle";
type Direction = "Long" | "Short";
type TxStatus = "queued" | "awaiting_wallet" | "submitted" | "confirmed" | "failed";

type SyntheticAsset = {
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  confidence: number;
  totalSupply: number;
  volume24h: number;
  sparkline: number[];
};

type Position = {
  id: number;
  user: string;
  assetSymbol: string;
  collateral: number;
  minted: number;
};

type Trade = {
  id: number;
  user: string;
  assetSymbol: string;
  direction: Direction;
  margin: number;
  leverage: number;
  entryPrice: number;
};

type TransactionItem = {
  id: string;
  title: string;
  status: TxStatus;
  detail: string;
  createdAt: string;
  hash?: string;
  output?: string;
};

type WalletState = {
  isLoading: boolean;
  installed: boolean;
  isAllowed: boolean;
  address: string;
  network: string;
  networkPassphrase: string;
  rpcUrl: string;
  error: string;
};

type ApiErrorPayload = {
  message?: string;
  details?: unknown;
};

type HealthPayload = {
  data?: {
    runtime?: {
      node?: string;
    };
  };
};

type InvokePayload = {
  message: string;
  output: string;
  invokedAt: string;
};

type FreighterModule = {
  isConnected: () => Promise<{ isConnected: boolean; error?: string }>;
  isAllowed: () => Promise<{ isAllowed: boolean; error?: string }>;
  getAddress: () => Promise<{ address: string; error?: string }>;
  requestAccess: () => Promise<{ address: string; error?: string }>;
  getNetworkDetails: () => Promise<{
    network: string;
    networkPassphrase: string;
    networkUrl?: string;
    sorobanRpcUrl?: string;
    error?: string;
  }>;
};

const INITIAL_ASSETS: SyntheticAsset[] = [
  {
    symbol: "sUSD",
    name: "Synthetic Dollar",
    price: 1,
    change24h: 0.3,
    confidence: 99,
    totalSupply: 128400,
    volume24h: 912000,
    sparkline: [0.99, 1.0, 1.0, 1.01, 1.0, 1.0, 1.0, 1.01, 1.0, 1.0, 1.0, 1.0],
  },
  {
    symbol: "sBTC",
    name: "Synthetic Bitcoin",
    price: 68420,
    change24h: 2.6,
    confidence: 93,
    totalSupply: 84,
    volume24h: 4680000,
    sparkline: [65210, 65800, 66410, 66980, 67410, 67640, 67910, 68100, 68320, 68550, 68480, 68420],
  },
  {
    symbol: "sXAU",
    name: "Synthetic Gold",
    price: 2388,
    change24h: -0.8,
    confidence: 91,
    totalSupply: 420,
    volume24h: 864000,
    sparkline: [2410, 2408, 2402, 2397, 2394, 2390, 2388, 2384, 2386, 2389, 2387, 2388],
  },
];

const INITIAL_POSITIONS: Position[] = [
  {
    id: 1,
    user: DEMO_ACCOUNT,
    assetSymbol: "sUSD",
    collateral: 360,
    minted: 200,
  },
  {
    id: 2,
    user: DEMO_ACCOUNT,
    assetSymbol: "sBTC",
    collateral: 178000,
    minted: 1.65,
  },
];

const INITIAL_TRADES: Trade[] = [
  {
    id: 1,
    user: DEMO_ACCOUNT,
    assetSymbol: "sBTC",
    direction: "Long",
    margin: 1200,
    leverage: 2.5,
    entryPrice: 67110,
  },
  {
    id: 2,
    user: DEMO_ACCOUNT,
    assetSymbol: "sXAU",
    direction: "Short",
    margin: 860,
    leverage: 1.8,
    entryPrice: 2415,
  },
];

function formatApiError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Something unexpected happened.";
}

function wait(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function shortAddress(value: string) {
  if (!value) {
    return "Not connected";
  }

  if (value.length < 12) {
    return value;
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  }).format(value);
}

function formatAmount(value: number, digits = 2) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
  }).format(value);
}

function formatPercent(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function assetFor(assets: SyntheticAsset[], symbol: string) {
  return assets.find((asset) => asset.symbol === symbol);
}

function collateralRatio(position: Position, asset?: SyntheticAsset) {
  if (!asset || position.minted <= 0 || asset.price <= 0) {
    return 0;
  }

  return (position.collateral / (position.minted * asset.price)) * 100;
}

function tradeNotional(trade: Trade) {
  return trade.margin * trade.leverage;
}

function tradePnl(trade: Trade, asset?: SyntheticAsset) {
  if (!asset || trade.entryPrice <= 0) {
    return 0;
  }

  const notional = tradeNotional(trade);
  const priceMove =
    trade.direction === "Long"
      ? asset.price - trade.entryPrice
      : trade.entryPrice - asset.price;

  return (priceMove / trade.entryPrice) * notional;
}

function tradeLiquidationPrice(trade: Trade) {
  const moveLimit = 1 / trade.leverage;
  return trade.direction === "Long"
    ? trade.entryPrice * (1 - moveLimit)
    : trade.entryPrice * (1 + moveLimit);
}

function buildSparklinePoints(values: number[]) {
  if (values.length === 0) {
    return "";
  }

  const width = 160;
  const height = 62;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  return values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${x},${y}`;
    })
    .join(" ");
}

function pushSparkline(sparkline: number[], nextValue: number) {
  return [...sparkline.slice(-11), nextValue];
}

function txTone(status: TxStatus) {
  switch (status) {
    case "confirmed":
      return "text-emerald-300";
    case "failed":
      return "text-rose-300";
    case "submitted":
      return "text-cyan-300";
    case "awaiting_wallet":
      return "text-amber-300";
    default:
      return "text-slate-300";
  }
}

function isValidContractId(contractId: string) {
  return CONTRACT_ID_PATTERN.test(contractId);
}

function currentIsoTime() {
  return new Date().toISOString();
}

function buildTxHash() {
  return `TX-${Math.random().toString(16).slice(2, 10).toUpperCase()}`;
}

export default function Home() {
  const [healthState, setHealthState] = useState<HealthState>("checking");
  const [healthMessage, setHealthMessage] = useState("Checking backend health...");
  const [contractId, setContractId] = useState(DEFAULT_CONTRACT_ID);
  const [freighterApi, setFreighterApi] = useState<FreighterModule | null>(null);
  const [wallet, setWallet] = useState<WalletState>({
    isLoading: false,
    installed: false,
    isAllowed: false,
    address: "",
    network: "TESTNET",
    networkPassphrase: "",
    rpcUrl: "",
    error: "",
  });
  const [assets, setAssets] = useState<SyntheticAsset[]>(INITIAL_ASSETS);
  const [positions, setPositions] = useState<Position[]>(INITIAL_POSITIONS);
  const [trades, setTrades] = useState<Trade[]>(INITIAL_TRADES);
  const [transactions, setTransactions] = useState<TransactionItem[]>([
    {
      id: "boot",
      title: "Dashboard Booted",
      status: "confirmed",
      detail: `Synthetic assets desk pointed at ${DEFAULT_API_BASE_URL}`,
      createdAt: currentIsoTime(),
    },
  ]);
  const [activeComposer, setActiveComposer] = useState<ActionMode>("mint");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [registerForm, setRegisterForm] = useState({
    symbol: "sETH",
    name: "Synthetic Ether",
    price: "3240",
  });
  const [mintForm, setMintForm] = useState({
    assetSymbol: "sUSD",
    collateral: "325",
    mintAmount: "200",
  });
  const [collateralForm, setCollateralForm] = useState({
    positionId: "1",
    additionalCollateral: "40",
  });
  const [tradeForm, setTradeForm] = useState({
    assetSymbol: "sBTC",
    direction: "Long" as Direction,
    margin: "250",
    leverage: "2.5",
  });
  const [oracleForm, setOracleForm] = useState({
    assetSymbol: "sBTC",
    price: "69050",
    confidence: "94",
  });

  const activeAccount = wallet.address || DEMO_ACCOUNT;
  const filteredPositions = positions.filter((position) => position.user === activeAccount);
  const filteredTrades = trades.filter((trade) => trade.user === activeAccount);
  const totalCollateral = filteredPositions.reduce(
    (sum, position) => sum + position.collateral,
    0,
  );
  const mintedExposure = filteredPositions.reduce((sum, position) => {
    const asset = assetFor(assets, position.assetSymbol);
    return sum + position.minted * (asset?.price || 0);
  }, 0);
  const totalSupplyValue = assets.reduce(
    (sum, asset) => sum + asset.totalSupply * asset.price,
    0,
  );
  const openInterest = filteredTrades.reduce(
    (sum, trade) => sum + tradeNotional(trade),
    0,
  );
  const routeMode =
    healthState === "online" && isValidContractId(contractId)
      ? "Backend relay"
      : "Simulation";

  async function requestJson<T>(path: string, body: Record<string, unknown>) {
    const response = await fetch(`${DEFAULT_API_BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const payload = (await response.json().catch(() => ({}))) as T & ApiErrorPayload;
    if (!response.ok) {
      const details =
        Array.isArray(payload.details) && payload.details.length > 0
          ? payload.details.join(", ")
          : typeof payload.details === "string"
            ? payload.details
            : "";

      throw new Error([payload.message, details].filter(Boolean).join(": "));
    }

    return payload;
  }

  const pushTransaction = useEffectEvent((item: TransactionItem) => {
    startTransition(() => {
      setTransactions((prev) => [item, ...prev].slice(0, 10));
    });
  });

  const updateTransaction = useEffectEvent(
    (id: string, patch: Partial<TransactionItem>) => {
      startTransition(() => {
        setTransactions((prev) =>
          prev.map((item) => (item.id === id ? { ...item, ...patch } : item)),
        );
      });
    },
  );

  const loadWalletState = useEffectEvent(async (promptForAccess: boolean) => {
    setWallet((prev) => ({ ...prev, isLoading: true, error: "" }));

    try {
      const api =
        freighterApi ||
        ((await import("@stellar/freighter-api")) as FreighterModule);
      setFreighterApi(api);

      const connection = await api.isConnected();
      if (connection.error || !connection.isConnected) {
        setWallet({
          isLoading: false,
          installed: false,
          isAllowed: false,
          address: "",
          network: "TESTNET",
          networkPassphrase: "",
          rpcUrl: "",
          error:
            connection.error ||
            "Freighter is not installed in this browser profile.",
        });
        return;
      }

      const allowance = await api.isAllowed();
      const access = promptForAccess
        ? await api.requestAccess()
        : allowance.isAllowed
          ? await api.getAddress()
          : { address: "", error: "" };
      const networkDetails = await api.getNetworkDetails();

      setWallet({
        isLoading: false,
        installed: true,
        isAllowed: allowance.isAllowed || Boolean(access.address),
        address: access.address || "",
        network: networkDetails.network || "TESTNET",
        networkPassphrase: networkDetails.networkPassphrase || "",
        rpcUrl: networkDetails.sorobanRpcUrl || "",
        error: access.error || networkDetails.error || allowance.error || "",
      });
    } catch (error) {
      setWallet({
        isLoading: false,
        installed: false,
        isAllowed: false,
        address: "",
        network: "TESTNET",
        networkPassphrase: "",
        rpcUrl: "",
        error: formatApiError(error),
      });
    }
  });

  const refreshMarkets = useEffectEvent(() => {
    setAssets((prev) =>
      prev.map((asset, index) => {
        const variance = index === 1 ? 0.012 : index === 2 ? 0.008 : 0.002;
        const drift = (Math.random() - 0.5) * variance;
        const nextPrice = Math.max(0.01, asset.price * (1 + drift));
        const nextChange = clamp(asset.change24h + drift * 220, -12, 12);
        const nextConfidence = clamp(
          asset.confidence + Math.round((Math.random() - 0.5) * 4),
          80,
          99,
        );

        return {
          ...asset,
          price: nextPrice,
          change24h: nextChange,
          confidence: nextConfidence,
          volume24h: Math.max(0, asset.volume24h * (1 + drift / 2)),
          sparkline: pushSparkline(asset.sparkline, nextPrice),
        };
      }),
    );
  });

  useEffect(() => {
    let cancelled = false;

    async function checkHealth() {
      setHealthState("checking");

      try {
        const response = await fetch(`${DEFAULT_API_BASE_URL}/api/health`, {
          method: "GET",
        });

        if (!response.ok) {
          throw new Error(`Health check failed with ${response.status}`);
        }

        const payload = (await response.json()) as HealthPayload;
        if (cancelled) {
          return;
        }

        setHealthState("online");
        setHealthMessage(
          `Backend online - ${payload.data?.runtime?.node ?? "runtime unknown"}`,
        );
      } catch (error) {
        if (cancelled) {
          return;
        }

        setHealthState("offline");
        setHealthMessage(
          "Backend unavailable - action forms will continue in simulation mode.",
        );
        pushTransaction({
          id: crypto.randomUUID(),
          title: "Backend Check",
          status: "failed",
          detail: formatApiError(error),
          createdAt: currentIsoTime(),
        });
      }
    }

    checkHealth();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void loadWalletState(false);
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      refreshMarkets();
    }, 4500);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  async function runAction(options: {
    title: string;
    functionName: string;
    args: Record<string, string>;
    onSuccess: () => void;
    successDetail: string;
  }) {
    const txId = crypto.randomUUID();
    const canRelay = healthState === "online" && isValidContractId(contractId);

    setIsSubmitting(true);
    pushTransaction({
      id: txId,
      title: options.title,
      status: wallet.address ? "awaiting_wallet" : "queued",
      detail: wallet.address
        ? `Wallet ${shortAddress(wallet.address)} ready`
        : "Running in local simulation mode",
      createdAt: currentIsoTime(),
    });

    try {
      await wait(250);
      updateTransaction(txId, {
        status: "submitted",
        detail: canRelay
          ? `Invoking ${options.functionName} on ${shortAddress(contractId)}`
          : "Applying state locally without backend relay",
      });

      let output = "Simulated";
      if (canRelay) {
        const payload = await requestJson<InvokePayload>("/api/invoke", {
          contractId,
          functionName: options.functionName,
          args: options.args,
        });
        output = payload.output;
      } else {
        await wait(900);
      }

      options.onSuccess();
      updateTransaction(txId, {
        status: "confirmed",
        detail: options.successDetail,
        hash: buildTxHash(),
        output,
      });
    } catch (error) {
      updateTransaction(txId, {
        status: "failed",
        detail: formatApiError(error),
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  function failFast(title: string, detail: string) {
    pushTransaction({
      id: crypto.randomUUID(),
      title,
      status: "failed",
      detail,
      createdAt: currentIsoTime(),
    });
  }

  async function handleRegisterAsset() {
    const symbol = registerForm.symbol.trim();
    const name = registerForm.name.trim();
    const price = Number(registerForm.price);

    if (!symbol || !name || !Number.isFinite(price) || price <= 0) {
      failFast("Register Asset", "Provide a valid symbol, name, and positive price.");
      return;
    }

    if (assetFor(assets, symbol)) {
      failFast("Register Asset", `${symbol} is already registered.`);
      return;
    }

    await runAction({
      title: `Register ${symbol}`,
      functionName: "register_synthetic_asset",
      args: {
        asset_symbol: symbol,
        asset_name: name,
        decimals: "8",
        initial_price: price.toString(),
      },
      successDetail: `${symbol} registered and ready for minting.`,
      onSuccess: () => {
        setAssets((prev) => [
          {
            symbol,
            name,
            price,
            change24h: 0,
            confidence: 95,
            totalSupply: 0,
            volume24h: 0,
            sparkline: Array.from({ length: 12 }, () => price),
          },
          ...prev,
        ]);
        setMintForm((prev) => ({ ...prev, assetSymbol: symbol }));
        setOracleForm((prev) => ({
          ...prev,
          assetSymbol: symbol,
          price: price.toString(),
        }));
      },
    });
  }

  async function handleMint() {
    const collateral = Number(mintForm.collateral);
    const mintAmount = Number(mintForm.mintAmount);
    const asset = assetFor(assets, mintForm.assetSymbol);

    if (!asset) {
      failFast("Mint Synthetic", "Select a registered asset before minting.");
      return;
    }

    if (!Number.isFinite(collateral) || !Number.isFinite(mintAmount) || collateral <= 0 || mintAmount <= 0) {
      failFast("Mint Synthetic", "Enter positive collateral and mint amounts.");
      return;
    }

    const ratio = (collateral / (mintAmount * asset.price)) * 100;
    if (ratio < MIN_COLLATERAL_RATIO) {
      failFast(
        "Mint Synthetic",
        `Collateral ratio ${ratio.toFixed(1)}% is below the ${MIN_COLLATERAL_RATIO}% minimum.`,
      );
      return;
    }

    await runAction({
      title: `Mint ${mintForm.assetSymbol}`,
      functionName: "mint_synthetic",
      args: {
        user: activeAccount,
        asset_symbol: mintForm.assetSymbol,
        collateral_amount: collateral.toString(),
        mint_amount: mintAmount.toString(),
      },
      successDetail: `Minted ${formatAmount(mintAmount)} ${mintForm.assetSymbol} against ${formatUsd(collateral)} in collateral.`,
      onSuccess: () => {
        setPositions((prev) => [
          {
            id: (prev[0]?.id || 0) + 1,
            user: activeAccount,
            assetSymbol: mintForm.assetSymbol,
            collateral,
            minted: mintAmount,
          },
          ...prev,
        ]);
        setAssets((prev) =>
          prev.map((item) =>
            item.symbol === mintForm.assetSymbol
              ? { ...item, totalSupply: item.totalSupply + mintAmount }
              : item,
          ),
        );
      },
    });
  }

  async function handleAddCollateral() {
    const positionId = Number(collateralForm.positionId);
    const additionalCollateral = Number(collateralForm.additionalCollateral);
    const targetPosition = filteredPositions.find((position) => position.id === positionId);

    if (!targetPosition) {
      failFast("Add Collateral", "Select a valid position to top up.");
      return;
    }

    if (!Number.isFinite(additionalCollateral) || additionalCollateral <= 0) {
      failFast("Add Collateral", "Enter a positive collateral amount.");
      return;
    }

    await runAction({
      title: `Add Collateral #${positionId}`,
      functionName: "add_collateral",
      args: {
        user: activeAccount,
        position_id: positionId.toString(),
        additional_collateral: additionalCollateral.toString(),
      },
      successDetail: `Position #${positionId} received ${formatUsd(additionalCollateral)} in additional collateral.`,
      onSuccess: () => {
        setPositions((prev) =>
          prev.map((position) =>
            position.id === positionId
              ? {
                  ...position,
                  collateral: position.collateral + additionalCollateral,
                }
              : position,
          ),
        );
      },
    });
  }

  async function handleOpenTrade() {
    const margin = Number(tradeForm.margin);
    const leverage = Number(tradeForm.leverage);
    const asset = assetFor(assets, tradeForm.assetSymbol);

    if (!asset) {
      failFast("Open Trade", "Select a registered asset before trading.");
      return;
    }

    if (!Number.isFinite(margin) || !Number.isFinite(leverage) || margin <= 0 || leverage < 1 || leverage > 10) {
      failFast("Open Trade", "Margin must be positive and leverage must stay between 1x and 10x.");
      return;
    }

    if (margin < MIN_TRADE_MARGIN) {
      failFast(
        "Open Trade",
        `Margin ${formatUsd(margin)} is below the ${formatUsd(MIN_TRADE_MARGIN)} minimum trade floor.`,
      );
      return;
    }

    await runAction({
      title: `${tradeForm.direction} ${tradeForm.assetSymbol}`,
      functionName: "open_trade",
      args: {
        user: activeAccount,
        asset_symbol: tradeForm.assetSymbol,
        direction: tradeForm.direction.toLowerCase(),
        margin: margin.toString(),
        leverage: leverage.toString(),
      },
      successDetail: `${tradeForm.direction} trade opened on ${tradeForm.assetSymbol} at ${formatUsd(asset.price)}.`,
      onSuccess: () => {
        setTrades((prev) => [
          {
            id: (prev[0]?.id || 0) + 1,
            user: activeAccount,
            assetSymbol: tradeForm.assetSymbol,
            direction: tradeForm.direction,
            margin,
            leverage,
            entryPrice: asset.price,
          },
          ...prev,
        ]);
      },
    });
  }

  async function handlePriceUpdate() {
    const price = Number(oracleForm.price);
    const confidence = Number(oracleForm.confidence);
    const asset = assetFor(assets, oracleForm.assetSymbol);

    if (!asset) {
      failFast("Update Price", "Select a registered asset before updating the oracle price.");
      return;
    }

    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(confidence) || confidence < 50 || confidence > 100) {
      failFast(
        "Update Price",
        "Price must be positive and confidence must stay between 50 and 100.",
      );
      return;
    }

    const change24h = clamp(((price - asset.price) / asset.price) * 100, -20, 20);

    await runAction({
      title: `Oracle Update ${oracleForm.assetSymbol}`,
      functionName: "update_price",
      args: {
        asset_symbol: oracleForm.assetSymbol,
        new_price: price.toString(),
        confidence: confidence.toString(),
      },
      successDetail: `${oracleForm.assetSymbol} marked at ${formatUsd(price)} with ${confidence}% confidence.`,
      onSuccess: () => {
        setAssets((prev) =>
          prev.map((item) =>
            item.symbol === oracleForm.assetSymbol
              ? {
                  ...item,
                  price,
                  change24h,
                  confidence,
                  sparkline: pushSparkline(item.sparkline, price),
                }
              : item,
          ),
        );
      },
    });
  }

  return (
    <div className="min-h-screen px-4 py-5 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-2.5rem)] max-w-[1600px] flex-col overflow-hidden rounded-[30px] border border-white/10 bg-slate-950/70 shadow-[0_32px_120px_rgba(5,10,24,0.8)] backdrop-blur">
        <header className="border-b border-white/10 px-6 py-6">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-4xl">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.26em] text-amber-100">
                <Waves size={12} />
                Synthetic Assets Command Deck
              </div>
              <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                Track prices, manage collateral, and stage synthetic trades from one desk.
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
                This screen is wired for the synthetic-assets contract flow: oracle marks,
                collateralized minting, leveraged positions, Freighter connection, and a
                transaction timeline that can relay through the existing backend routes or
                keep running locally in simulation mode.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:min-w-[480px]">
              <StatusCard
                label="Backend"
                value={DEFAULT_API_BASE_URL}
                tone={
                  healthState === "online"
                    ? "text-emerald-300"
                    : healthState === "offline"
                      ? "text-rose-300"
                      : "text-amber-300"
                }
                icon={
                  healthState === "checking" ? (
                    <LoaderCircle size={14} className="animate-spin" />
                  ) : (
                    <RadioTower size={14} />
                  )
                }
                helper={healthMessage}
              />
              <StatusCard
                label="Contract Route"
                value={contractId || "Contract ID not provided"}
                tone={
                  routeMode === "Backend relay"
                    ? "text-cyan-300"
                    : "text-amber-200"
                }
                icon={<Signature size={14} />}
                helper={`${routeMode} - ${wallet.address ? shortAddress(wallet.address) : "demo account active"}`}
              />
            </div>
          </div>
        </header>

        <main className="grid flex-1 gap-0 xl:grid-cols-[minmax(0,1.1fr)_420px]">
          <section className="space-y-5 border-b border-white/10 p-5 xl:border-b-0 xl:border-r">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label="Total Collateral"
                value={formatUsd(totalCollateral)}
                helper="Stable collateral parked across open mint positions"
                icon={<Shield size={18} />}
              />
              <MetricCard
                label="Minted Exposure"
                value={formatUsd(mintedExposure)}
                helper="Marked to current oracle prices"
                icon={<Coins size={18} />}
              />
              <MetricCard
                label="Open Interest"
                value={formatUsd(openInterest)}
                helper="Gross notional across open trades"
                icon={<TrendingUp size={18} />}
              />
              <MetricCard
                label="Protocol Supply"
                value={formatUsd(totalSupplyValue)}
                helper="Aggregate value of all registered synth supply"
                icon={<BadgeDollarSign size={18} />}
              />
            </div>

            <Panel
              title="Live Markets"
              eyebrow="Oracle tape"
              action={
                <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-100">
                  Refreshes every 4.5s
                </span>
              }
            >
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {assets.map((asset) => {
                  const points = buildSparklinePoints(asset.sparkline);
                  const positive = asset.change24h >= 0;

                  return (
                    <div
                      key={asset.symbol}
                      className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4 shadow-[0_12px_40px_rgba(15,23,42,0.22)]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                            {asset.name}
                          </p>
                          <h3 className="mt-2 text-2xl font-semibold text-white">
                            {asset.symbol}
                          </h3>
                        </div>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                            positive
                              ? "bg-emerald-400/10 text-emerald-200"
                              : "bg-rose-400/10 text-rose-200"
                          }`}
                        >
                          {positive ? (
                            <ArrowUpRight size={14} />
                          ) : (
                            <ArrowDownRight size={14} />
                          )}
                          {formatPercent(asset.change24h)}
                        </span>
                      </div>

                      <div className="mt-4 flex items-end justify-between">
                        <div>
                          <p className="text-3xl font-semibold text-white">
                            {formatUsd(asset.price)}
                          </p>
                          <p className="mt-1 text-xs text-slate-400">
                            Confidence {asset.confidence}%
                          </p>
                        </div>
                        <div className="text-right text-xs text-slate-400">
                          <p>Supply {formatAmount(asset.totalSupply, 0)}</p>
                          <p>Volume {formatUsd(asset.volume24h)}</p>
                        </div>
                      </div>

                      <div className="mt-4 overflow-hidden rounded-2xl border border-white/6 bg-slate-950/70 p-2">
                        <svg viewBox="0 0 160 62" className="h-20 w-full">
                          <defs>
                            <linearGradient
                              id={`gradient-${asset.symbol}`}
                              x1="0%"
                              y1="0%"
                              x2="100%"
                              y2="0%"
                            >
                              <stop offset="0%" stopColor="#f59e0b" />
                              <stop offset="100%" stopColor="#22d3ee" />
                            </linearGradient>
                          </defs>
                          <polyline
                            fill="none"
                            stroke={`url(#gradient-${asset.symbol})`}
                            strokeWidth="3"
                            points={points}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <Panel title="Collateral Positions" eyebrow="Health monitor">
                <div className="space-y-3">
                  {filteredPositions.length === 0 ? (
                    <EmptyState label="No collateral positions yet." />
                  ) : (
                    filteredPositions.map((position) => {
                      const asset = assetFor(assets, position.assetSymbol);
                      const ratio = collateralRatio(position, asset);
                      const liquidatable = ratio <= LIQUIDATION_THRESHOLD;

                      return (
                        <div
                          key={position.id}
                          className="rounded-[20px] border border-white/8 bg-white/[0.03] p-4"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-white">
                                Position #{position.id} - {position.assetSymbol}
                              </p>
                              <p className="text-xs text-slate-400">
                                {formatUsd(position.collateral)} collateral for{" "}
                                {formatAmount(position.minted)} minted
                              </p>
                            </div>
                            <span
                              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                                liquidatable
                                  ? "bg-rose-400/10 text-rose-200"
                                  : ratio < MIN_COLLATERAL_RATIO + 20
                                    ? "bg-amber-300/10 text-amber-100"
                                    : "bg-emerald-400/10 text-emerald-200"
                              }`}
                            >
                              {liquidatable ? "Liquidatable" : "Healthy"}
                            </span>
                          </div>

                          <div className="mt-4">
                            <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
                              <span>Collateral ratio</span>
                              <span>{ratio.toFixed(1)}%</span>
                            </div>
                            <div className="h-2 rounded-full bg-slate-900">
                              <div
                                className={`h-2 rounded-full ${
                                  liquidatable
                                    ? "bg-rose-400"
                                    : ratio < MIN_COLLATERAL_RATIO + 20
                                      ? "bg-amber-300"
                                      : "bg-emerald-400"
                                }`}
                                style={{ width: `${clamp(ratio / 2, 8, 100)}%` }}
                              />
                            </div>
                            <div className="mt-2 flex justify-between text-[11px] uppercase tracking-[0.18em] text-slate-500">
                              <span>Liquidation {LIQUIDATION_THRESHOLD}%</span>
                              <span>Minimum {MIN_COLLATERAL_RATIO}%</span>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </Panel>

              <Panel title="Trading Book" eyebrow="PnL monitor">
                <div className="space-y-3">
                  {filteredTrades.length === 0 ? (
                    <EmptyState label="No open trades yet." />
                  ) : (
                    filteredTrades.map((trade) => {
                      const asset = assetFor(assets, trade.assetSymbol);
                      const pnl = tradePnl(trade, asset);
                      const liquidationPrice = tradeLiquidationPrice(trade);
                      const underwater = trade.margin + pnl <= 0;

                      return (
                        <div
                          key={trade.id}
                          className="rounded-[20px] border border-white/8 bg-white/[0.03] p-4"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-white">
                                {trade.direction} {trade.assetSymbol} #{trade.id}
                              </p>
                              <p className="text-xs text-slate-400">
                                {trade.leverage.toFixed(1)}x leverage with {formatUsd(trade.margin)} margin
                              </p>
                            </div>
                            <span
                              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                                pnl >= 0
                                  ? "bg-emerald-400/10 text-emerald-200"
                                  : "bg-rose-400/10 text-rose-200"
                              }`}
                            >
                              {pnl >= 0 ? "+" : ""}
                              {formatUsd(pnl)}
                            </span>
                          </div>

                          <div className="mt-4 grid gap-3 text-xs text-slate-300 sm:grid-cols-3">
                            <StatCell label="Entry" value={formatUsd(trade.entryPrice)} />
                            <StatCell label="Mark" value={formatUsd(asset?.price || 0)} />
                            <StatCell
                              label="Liq. Price"
                              value={formatUsd(liquidationPrice)}
                            />
                          </div>

                          {underwater ? (
                            <p className="mt-3 flex items-center gap-2 text-xs text-rose-200">
                              <AlertTriangle size={14} />
                              Margin exhausted. Close or recapitalize this trade.
                            </p>
                          ) : (
                            <p className="mt-3 text-xs text-slate-400">
                              Gross notional {formatUsd(tradeNotional(trade))} across the current mark.
                            </p>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </Panel>
            </div>
          </section>

          <aside className="flex flex-col gap-5 bg-slate-950/55 p-5">
            <Panel
              title="Wallet and Routing"
              eyebrow="Freighter"
              action={
                <button
                  type="button"
                  onClick={() => void loadWalletState(true)}
                  disabled={wallet.isLoading}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-100 transition hover:border-cyan-400/40 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {wallet.isLoading ? (
                    <LoaderCircle size={14} className="animate-spin" />
                  ) : (
                    <Wallet size={14} />
                  )}
                  {wallet.address ? "Reconnect" : "Connect Wallet"}
                </button>
              }
            >
              <div className="space-y-4">
                <div className="rounded-[20px] border border-white/8 bg-white/[0.03] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">
                        {wallet.address ? shortAddress(wallet.address) : "Demo operator"}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        {wallet.installed
                          ? wallet.address
                            ? `Freighter connected on ${wallet.network}`
                            : "Freighter detected but this app is not yet authorized."
                          : "Freighter not detected. The dashboard remains usable in simulation mode."}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        wallet.address
                          ? "bg-emerald-400/10 text-emerald-200"
                          : wallet.installed
                            ? "bg-amber-300/10 text-amber-100"
                            : "bg-slate-700 text-slate-200"
                      }`}
                    >
                      {wallet.address
                        ? "Connected"
                        : wallet.installed
                          ? "Needs access"
                          : "Simulation"}
                    </span>
                  </div>

                  <div className="mt-4 grid gap-3 text-xs text-slate-300">
                    <StatCell label="Network" value={wallet.network || "TESTNET"} />
                    <StatCell
                      label="Soroban RPC"
                      value={wallet.rpcUrl || "Use Freighter network defaults"}
                    />
                    <StatCell
                      label="Passphrase"
                      value={
                        wallet.networkPassphrase
                          ? wallet.networkPassphrase
                          : "Request access to inspect the active passphrase"
                      }
                    />
                  </div>

                  {wallet.error ? (
                    <p className="mt-4 flex items-center gap-2 text-xs text-amber-100">
                      <AlertTriangle size={14} />
                      {wallet.error}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <FieldLabel htmlFor="contractId">Contract ID</FieldLabel>
                  <input
                    id="contractId"
                    value={contractId}
                    onChange={(event) => setContractId(event.target.value.trim().toUpperCase())}
                    placeholder="C..."
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/50"
                  />
                  <p className="text-xs text-slate-400">
                    A valid contract ID plus an online backend switches the action composer into relay mode.
                  </p>
                </div>
              </div>
            </Panel>

            <Panel title="Contract Composer" eyebrow="Actions">
              <div className="space-y-4">
                <div className="grid grid-cols-5 gap-2">
                  {(["register", "mint", "collateral", "trade", "oracle"] as ActionMode[]).map(
                    (mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setActiveComposer(mode)}
                        className={`rounded-2xl px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] transition ${
                          activeComposer === mode
                            ? "bg-gradient-to-r from-amber-400 to-cyan-400 text-slate-950"
                            : "border border-white/8 bg-white/[0.03] text-slate-300 hover:border-cyan-400/30 hover:text-cyan-100"
                        }`}
                      >
                        {mode === "collateral" ? "Top Up" : mode}
                      </button>
                    ),
                  )}
                </div>

                {activeComposer === "register" ? (
                  <ComposerShell
                    title="Register a synthetic asset"
                    description="Seed a new symbol for minting and oracle updates."
                    submitLabel="Register Asset"
                    isSubmitting={isSubmitting}
                    onSubmit={() => void handleRegisterAsset()}
                  >
                    <InputGrid>
                      <InputField
                        label="Symbol"
                        value={registerForm.symbol}
                        onChange={(value) =>
                          setRegisterForm((prev) => ({ ...prev, symbol: value.toUpperCase() }))
                        }
                      />
                      <InputField
                        label="Initial Price"
                        value={registerForm.price}
                        onChange={(value) =>
                          setRegisterForm((prev) => ({ ...prev, price: value }))
                        }
                      />
                    </InputGrid>
                    <InputField
                      label="Display Name"
                      value={registerForm.name}
                      onChange={(value) =>
                        setRegisterForm((prev) => ({ ...prev, name: value }))
                      }
                    />
                  </ComposerShell>
                ) : null}

                {activeComposer === "mint" ? (
                  <ComposerShell
                    title="Mint against collateral"
                    description="Match the contract's minimum ratio before opening a position."
                    submitLabel="Mint Synthetic"
                    isSubmitting={isSubmitting}
                    onSubmit={() => void handleMint()}
                  >
                    <InputGrid>
                      <SelectField
                        label="Asset"
                        value={mintForm.assetSymbol}
                        options={assets.map((asset) => ({
                          label: asset.symbol,
                          value: asset.symbol,
                        }))}
                        onChange={(value) =>
                          setMintForm((prev) => ({ ...prev, assetSymbol: value }))
                        }
                      />
                      <InputField
                        label="Mint Amount"
                        value={mintForm.mintAmount}
                        onChange={(value) =>
                          setMintForm((prev) => ({ ...prev, mintAmount: value }))
                        }
                      />
                    </InputGrid>
                    <InputField
                      label="Collateral Amount (USD)"
                      value={mintForm.collateral}
                      onChange={(value) =>
                        setMintForm((prev) => ({ ...prev, collateral: value }))
                      }
                    />
                  </ComposerShell>
                ) : null}

                {activeComposer === "collateral" ? (
                  <ComposerShell
                    title="Top up an existing position"
                    description="Use this before health drops into the liquidation band."
                    submitLabel="Add Collateral"
                    isSubmitting={isSubmitting}
                    onSubmit={() => void handleAddCollateral()}
                  >
                    <InputGrid>
                      <SelectField
                        label="Position"
                        value={collateralForm.positionId}
                        options={filteredPositions.map((position) => ({
                          label: `#${position.id} ${position.assetSymbol}`,
                          value: String(position.id),
                        }))}
                        onChange={(value) =>
                          setCollateralForm((prev) => ({ ...prev, positionId: value }))
                        }
                      />
                      <InputField
                        label="Additional Collateral"
                        value={collateralForm.additionalCollateral}
                        onChange={(value) =>
                          setCollateralForm((prev) => ({
                            ...prev,
                            additionalCollateral: value,
                          }))
                        }
                      />
                    </InputGrid>
                  </ComposerShell>
                ) : null}

                {activeComposer === "trade" ? (
                  <ComposerShell
                    title="Open a leveraged trade"
                    description="The desk mirrors the contract's 1x to 10x leverage band and minimum margin floor."
                    submitLabel="Open Trade"
                    isSubmitting={isSubmitting}
                    onSubmit={() => void handleOpenTrade()}
                  >
                    <InputGrid>
                      <SelectField
                        label="Asset"
                        value={tradeForm.assetSymbol}
                        options={assets.map((asset) => ({
                          label: asset.symbol,
                          value: asset.symbol,
                        }))}
                        onChange={(value) =>
                          setTradeForm((prev) => ({ ...prev, assetSymbol: value }))
                        }
                      />
                      <SelectField
                        label="Direction"
                        value={tradeForm.direction}
                        options={[
                          { label: "Long", value: "Long" },
                          { label: "Short", value: "Short" },
                        ]}
                        onChange={(value) =>
                          setTradeForm((prev) => ({
                            ...prev,
                            direction: value as Direction,
                          }))
                        }
                      />
                    </InputGrid>
                    <InputGrid>
                      <InputField
                        label="Margin"
                        value={tradeForm.margin}
                        onChange={(value) =>
                          setTradeForm((prev) => ({ ...prev, margin: value }))
                        }
                      />
                      <InputField
                        label="Leverage"
                        value={tradeForm.leverage}
                        onChange={(value) =>
                          setTradeForm((prev) => ({ ...prev, leverage: value }))
                        }
                      />
                    </InputGrid>
                  </ComposerShell>
                ) : null}

                {activeComposer === "oracle" ? (
                  <ComposerShell
                    title="Publish an oracle mark"
                    description="Push a new mark and confidence score into the live market board."
                    submitLabel="Update Price"
                    isSubmitting={isSubmitting}
                    onSubmit={() => void handlePriceUpdate()}
                  >
                    <InputGrid>
                      <SelectField
                        label="Asset"
                        value={oracleForm.assetSymbol}
                        options={assets.map((asset) => ({
                          label: asset.symbol,
                          value: asset.symbol,
                        }))}
                        onChange={(value) =>
                          setOracleForm((prev) => ({ ...prev, assetSymbol: value }))
                        }
                      />
                      <InputField
                        label="Confidence"
                        value={oracleForm.confidence}
                        onChange={(value) =>
                          setOracleForm((prev) => ({ ...prev, confidence: value }))
                        }
                      />
                    </InputGrid>
                    <InputField
                      label="New Price"
                      value={oracleForm.price}
                      onChange={(value) =>
                        setOracleForm((prev) => ({ ...prev, price: value }))
                      }
                    />
                  </ComposerShell>
                ) : null}
              </div>
            </Panel>

            <Panel title="Transaction Timeline" eyebrow="Status tracking">
              <div className="space-y-3">
                {transactions.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-[20px] border border-white/8 bg-white/[0.03] p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white">{item.title}</p>
                        <p className="mt-1 text-xs text-slate-400">{item.detail}</p>
                      </div>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${txTone(item.status)}`}
                      >
                        {item.status === "confirmed" ? (
                          <CheckCircle2 size={14} />
                        ) : item.status === "failed" ? (
                          <AlertTriangle size={14} />
                        ) : item.status === "submitted" ? (
                          <Activity size={14} />
                        ) : item.status === "awaiting_wallet" ? (
                          <Wallet size={14} />
                        ) : (
                          <Boxes size={14} />
                        )}
                        {item.status.replace("_", " ")}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-3 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                      <span>{new Date(item.createdAt).toLocaleTimeString()}</span>
                      {item.hash ? <span>{item.hash}</span> : null}
                      {item.output ? <span>Output {item.output}</span> : null}
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          </aside>
        </main>
      </div>
    </div>
  );
}

function Panel({
  eyebrow,
  title,
  action,
  children,
}: {
  eyebrow: string;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[26px] border border-white/10 bg-slate-950/70 p-4 shadow-[0_16px_60px_rgba(2,8,23,0.34)]">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
            {eyebrow}
          </p>
          <h2 className="mt-2 text-lg font-semibold text-white">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function MetricCard({
  label,
  value,
  helper,
  icon,
}: {
  label: string;
  value: string;
  helper: string;
  icon: ReactNode;
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
          {label}
        </p>
        <div className="rounded-2xl bg-white/5 p-2 text-cyan-200">{icon}</div>
      </div>
      <p className="mt-4 text-3xl font-semibold text-white">{value}</p>
      <p className="mt-2 text-xs leading-5 text-slate-400">{helper}</p>
    </div>
  );
}

function StatusCard({
  label,
  value,
  helper,
  icon,
  tone,
}: {
  label: string;
  value: string;
  helper: string;
  icon: ReactNode;
  tone: string;
}) {
  return (
    <div className="rounded-[22px] border border-white/10 bg-white/[0.03] p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
        {label}
      </p>
      <p className="mt-2 truncate font-mono text-sm text-slate-100">{value}</p>
      <p className={`mt-3 flex items-center gap-2 text-xs ${tone}`}>
        {icon}
        {helper}
      </p>
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-slate-950/80 px-3 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </p>
      <p className="mt-2 break-words text-sm text-white">{value}</p>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-[20px] border border-dashed border-white/12 bg-white/[0.02] px-4 py-8 text-center text-sm text-slate-400">
      {label}
    </div>
  );
}

function ComposerShell({
  title,
  description,
  submitLabel,
  isSubmitting,
  onSubmit,
  children,
}: {
  title: string;
  description: string;
  submitLabel: string;
  isSubmitting: boolean;
  onSubmit: () => void;
  children: ReactNode;
}) {
  return (
    <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
      <div className="mb-4">
        <p className="text-sm font-semibold text-white">{title}</p>
        <p className="mt-1 text-xs leading-5 text-slate-400">{description}</p>
      </div>
      <div className="space-y-3">{children}</div>
      <button
        type="button"
        onClick={onSubmit}
        disabled={isSubmitting}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-amber-400 to-cyan-400 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? <LoaderCircle size={16} className="animate-spin" /> : <Activity size={16} />}
        {submitLabel}
      </button>
    </div>
  );
}

function InputGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>;
}

function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400"
    >
      {children}
    </label>
  );
}

function InputField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <FieldLabel>{label}</FieldLabel>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/50"
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ label: string; value: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <FieldLabel>{label}</FieldLabel>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/50"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
