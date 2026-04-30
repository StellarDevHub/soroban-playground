const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ||
  "http://localhost:5000/api";

export type OptimizerPosition = {
  user: string;
  shares: number;
  principal: number;
  currentBalance: number;
  lastActionTs: number;
};

export type OptimizerStrategy = {
  id: number;
  name: string;
  protocol: string;
  apyBps: number;
  feeBps: number;
  tvl: number;
  totalShares: number;
  isActive: boolean;
  compoundInterval: number;
  lastCompoundTs: number;
  createdAt: string;
  updatedAt: string;
  positions: OptimizerPosition[];
};

export type OptimizerBacktest = {
  strategyId: number | null;
  depositAmount: number;
  days: number;
  projectedFinalBalance: number;
  projectedYield: number;
  projectedApyPercent: number;
  maxDrawdownPercent: number;
  feesPaid: number;
  compoundEveryDays: number;
  assumptions: {
    deterministicSeries: boolean;
    source: string;
  };
  series: Array<{
    day: number;
    equity: number;
  }>;
};

export type OptimizerDashboard = {
  strategies: OptimizerStrategy[];
  history: Array<{
    id: number;
    timestamp: string;
    actor: string;
    action: string;
    strategyId?: number;
    details?: Record<string, unknown>;
  }>;
  metrics: {
    strategyCount: number;
    totalTvl: number;
    averageApyBps: number;
    totalUsers: number;
  };
  config: {
    adminAddress: string;
    executorAddress: string;
  };
};

async function request<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });

  const payload = (await response.json().catch(() => ({}))) as {
    data?: T;
    message?: string;
    details?: string[] | string;
  };

  if (!response.ok) {
    const details = Array.isArray(payload.details)
      ? payload.details.join(", ")
      : payload.details || "";
    throw new Error([payload.message, details].filter(Boolean).join(": "));
  }

  return payload.data as T;
}

class YieldOptimizerService {
  getDashboard() {
    return request<OptimizerDashboard>("/optimizer");
  }

  getHealth() {
    return request<{ status: string; strategies: number; totalTvl: number }>(
      "/optimizer/health"
    );
  }

  createStrategy(payload: {
    actor: string;
    name: string;
    protocol: string;
    apyBps: number;
    feeBps: number;
    compoundInterval: number;
  }) {
    return request<OptimizerStrategy>("/optimizer/strategies", {
      method: "POST",
      headers: {
        "x-actor-address": payload.actor,
      },
      body: JSON.stringify(payload),
    });
  }

  updateStrategy(
    strategyId: number,
    actor: string,
    payload: {
      apyBps: number;
      feeBps: number;
      compoundInterval: number;
      isActive: boolean;
    }
  ) {
    return request<OptimizerStrategy>(`/optimizer/strategies/${strategyId}`, {
      method: "PATCH",
      headers: {
        "x-actor-address": actor,
      },
      body: JSON.stringify(payload),
    });
  }

  deposit(strategyId: number, actor: string, amount: number) {
    return request<{
      sharesMinted: number;
      strategy: OptimizerStrategy;
      position: OptimizerPosition;
    }>(`/optimizer/strategies/${strategyId}/deposit`, {
      method: "POST",
      headers: {
        "x-actor-address": actor,
      },
      body: JSON.stringify({ amount }),
    });
  }

  withdraw(strategyId: number, actor: string, amount: number) {
    return request<{
      withdrawnAmount: number;
      strategy: OptimizerStrategy;
      position: OptimizerPosition | null;
    }>(`/optimizer/strategies/${strategyId}/withdraw`, {
      method: "POST",
      headers: {
        "x-actor-address": actor,
      },
      body: JSON.stringify({ amount }),
    });
  }

  compound(strategyId: number, actor: string) {
    return request<{
      compoundedTvl: number;
      netReward: number;
      feeAmount: number;
      strategy: OptimizerStrategy;
    }>(`/optimizer/strategies/${strategyId}/compound`, {
      method: "POST",
      headers: {
        "x-actor-address": actor,
      },
      body: JSON.stringify({}),
    });
  }

  backtest(payload: {
    strategyId?: number;
    depositAmount: number;
    days: number;
    apyBps?: number;
    feeBps?: number;
    compoundEveryDays?: number;
  }) {
    return request<OptimizerBacktest>("/optimizer/backtest", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }
}

export default new YieldOptimizerService();
