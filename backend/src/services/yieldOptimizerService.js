const DEFAULT_ADMIN =
  process.env.OPTIMIZER_ADMIN_ADDRESS ||
  "GOPTIMIZERADMIN000000000000000000000000000000000000";
const DEFAULT_EXECUTOR =
  process.env.OPTIMIZER_EXECUTOR_ADDRESS ||
  "GOPTIMIZEREXECUTOR000000000000000000000000000000000";
const SECONDS_PER_YEAR = 31_536_000;
const BPS_DENOM = 10_000;

function nowIso() {
  return new Date().toISOString();
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class YieldOptimizerService {
  constructor() {
    this.reset();
  }

  reset() {
    this.strategies = [];
    this.history = [];
    this.strategySeq = 1;
    this.historySeq = 1;
    this.cachedDashboard = null;
    this.cacheExpiresAt = 0;
  }

  getConfig() {
    return {
      adminAddress: DEFAULT_ADMIN,
      executorAddress: DEFAULT_EXECUTOR,
    };
  }

  async getDashboard() {
    if (this.cachedDashboard && Date.now() < this.cacheExpiresAt) {
      return clone(this.cachedDashboard);
    }

    const strategies = await this.listStrategies();
    const payload = {
      strategies,
      history: await this.listHistory(),
      metrics: {
        strategyCount: strategies.length,
        totalTvl: strategies.reduce((sum, strategy) => sum + strategy.tvl, 0),
        averageApyBps:
          strategies.length === 0
            ? 0
            : Math.round(
                strategies.reduce((sum, strategy) => sum + strategy.apyBps, 0) /
                  strategies.length
              ),
        totalUsers: strategies.reduce(
          (sum, strategy) => sum + strategy.positions.length,
          0
        ),
      },
      config: this.getConfig(),
    };

    this.cachedDashboard = payload;
    this.cacheExpiresAt = Date.now() + 30_000;
    return clone(payload);
  }

  async listStrategies() {
    return clone(
      this.strategies
        .map((strategy) => this.serializeStrategy(strategy))
        .sort((a, b) => b.id - a.id)
    );
  }

  async getStrategy(id) {
    const strategy = this.findStrategy(id);
    return strategy ? clone(this.serializeStrategy(strategy)) : null;
  }

  async createStrategy(input) {
    this.assertAdmin(input.actor);
    const timestamp = nowSeconds();
    const strategy = {
      id: this.strategySeq++,
      name: input.name,
      protocol: input.protocol,
      apyBps: input.apyBps,
      feeBps: input.feeBps,
      compoundInterval: input.compoundInterval,
      isActive: true,
      totalDeposited: 0,
      totalShares: 0,
      lastCompoundTs: timestamp,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      positions: [],
    };

    this.strategies.push(strategy);
    this.recordHistory({
      actor: input.actor,
      action: "strategy.created",
      strategyId: strategy.id,
      details: {
        name: strategy.name,
        protocol: strategy.protocol,
      },
    });
    this.invalidateCache();
    return clone(this.serializeStrategy(strategy));
  }

  async updateStrategy(id, actor, patch) {
    this.assertAdmin(actor);
    const strategy = this.findStrategy(id);
    if (!strategy) {
      return null;
    }

    strategy.apyBps = patch.apyBps;
    strategy.feeBps = patch.feeBps;
    strategy.compoundInterval = patch.compoundInterval;
    strategy.isActive = patch.isActive;
    strategy.updatedAt = nowIso();

    this.recordHistory({
      actor,
      action: "strategy.updated",
      strategyId: strategy.id,
      details: {
        apyBps: strategy.apyBps,
        feeBps: strategy.feeBps,
        isActive: strategy.isActive,
      },
    });
    this.invalidateCache();
    return clone(this.serializeStrategy(strategy));
  }

  async deposit(id, actor, amount) {
    const strategy = this.findStrategy(id);
    if (!strategy) {
      return null;
    }
    if (!strategy.isActive) {
      const error = new Error("Strategy is paused");
      error.statusCode = 409;
      throw error;
    }

    const mintedShares =
      strategy.totalShares === 0 || strategy.totalDeposited === 0
        ? amount
        : Math.floor((amount * strategy.totalShares) / strategy.totalDeposited);

    const position = this.findOrCreatePosition(strategy, actor);
    position.shares += mintedShares;
    position.principal += amount;
    position.lastActionTs = nowSeconds();

    strategy.totalShares += mintedShares;
    strategy.totalDeposited += amount;
    strategy.updatedAt = nowIso();

    this.recordHistory({
      actor,
      action: "strategy.deposit",
      strategyId: strategy.id,
      details: {
        amount,
        shares: mintedShares,
      },
    });
    this.invalidateCache();
    return {
      sharesMinted: mintedShares,
      strategy: clone(this.serializeStrategy(strategy)),
      position: clone(this.serializePosition(strategy, position)),
    };
  }

  async withdraw(id, actor, amount) {
    const strategy = this.findStrategy(id);
    if (!strategy) {
      return null;
    }
    const position = strategy.positions.find((item) => item.user === actor);
    if (!position) {
      const error = new Error("User has no position in this strategy");
      error.statusCode = 404;
      throw error;
    }

    const currentBalance = this.positionValue(strategy, position.shares);
    if (amount > currentBalance) {
      const error = new Error("Withdrawal exceeds current strategy balance");
      error.statusCode = 409;
      throw error;
    }

    const sharesToBurn =
      strategy.totalDeposited === 0 || strategy.totalShares === 0
        ? amount
        : Math.ceil((amount * strategy.totalShares) / strategy.totalDeposited);

    position.shares -= sharesToBurn;
    position.principal -= Math.min(position.principal, amount);
    position.lastActionTs = nowSeconds();
    strategy.totalShares -= sharesToBurn;
    strategy.totalDeposited -= amount;
    strategy.updatedAt = nowIso();

    if (position.shares <= 0) {
      strategy.positions = strategy.positions.filter((item) => item.user !== actor);
    }

    this.recordHistory({
      actor,
      action: "strategy.withdraw",
      strategyId: strategy.id,
      details: {
        amount,
        sharesBurned: sharesToBurn,
      },
    });
    this.invalidateCache();

    return {
      withdrawnAmount: amount,
      strategy: clone(this.serializeStrategy(strategy)),
      position:
        strategy.positions.find((item) => item.user === actor) != null
          ? clone(
              this.serializePosition(
                strategy,
                strategy.positions.find((item) => item.user === actor)
              )
            )
          : null,
    };
  }

  async compound(id, actor) {
    if (![DEFAULT_ADMIN, DEFAULT_EXECUTOR].includes(actor)) {
      const error = new Error("Only the admin or executor can compound a strategy");
      error.statusCode = 403;
      throw error;
    }

    const strategy = this.findStrategy(id);
    if (!strategy) {
      return null;
    }

    const now = nowSeconds();
    const elapsed = now - strategy.lastCompoundTs;
    if (elapsed < strategy.compoundInterval) {
      const error = new Error("Compound interval has not elapsed yet");
      error.statusCode = 409;
      throw error;
    }

    const grossReward = Math.floor(
      (strategy.totalDeposited * strategy.apyBps * elapsed) /
        (BPS_DENOM * SECONDS_PER_YEAR)
    );
    const feeAmount = Math.floor((grossReward * strategy.feeBps) / BPS_DENOM);
    const netReward = grossReward - feeAmount;

    strategy.totalDeposited += netReward;
    strategy.lastCompoundTs = now;
    strategy.updatedAt = nowIso();

    this.recordHistory({
      actor,
      action: "strategy.compound",
      strategyId: strategy.id,
      details: {
        netReward,
        feeAmount,
      },
    });
    this.invalidateCache();

    return {
      compoundedTvl: strategy.totalDeposited,
      netReward,
      feeAmount,
      strategy: clone(this.serializeStrategy(strategy)),
    };
  }

  async listHistory() {
    return clone([...this.history].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)));
  }

  async backtest(input) {
    const strategy =
      input.strategyId != null ? this.findStrategy(input.strategyId) : null;
    const depositAmount = input.depositAmount;
    const days = input.days;
    const apyBps = strategy ? strategy.apyBps : input.apyBps;
    const feeBps = strategy ? strategy.feeBps : input.feeBps;
    const compoundEveryDays = strategy
      ? Math.max(1, Math.round(strategy.compoundInterval / 86_400))
      : input.compoundEveryDays;

    let equity = depositAmount;
    let peak = depositAmount;
    let maxDrawdown = 0;
    let feesPaid = 0;
    const series = [];
    const baseDailyRate = apyBps / BPS_DENOM / 365;
    const seed = (strategy?.id || 7) * 37;

    for (let day = 1; day <= days; day += 1) {
      const wave = (((day + seed) % 9) - 4) / 10_000;
      const protocolBias = ((seed % 5) - 2) / 20_000;
      const dailyReturn = baseDailyRate + wave + protocolBias;
      equity = equity * (1 + dailyReturn);

      if (day % compoundEveryDays === 0) {
        const gain = equity - depositAmount;
        const fee = gain > 0 ? gain * (feeBps / BPS_DENOM) * 0.1 : 0;
        equity -= fee;
        feesPaid += fee;
      }

      if (equity > peak) {
        peak = equity;
      }
      const drawdown = peak === 0 ? 0 : ((peak - equity) / peak) * 100;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }

      series.push({
        day,
        equity: Number(equity.toFixed(2)),
      });
    }

    const projectedYield = Number((equity - depositAmount).toFixed(2));
    const effectiveApy =
      depositAmount <= 0
        ? 0
        : Number(((((equity / depositAmount) ** (365 / days)) - 1) * 100).toFixed(2));

    return {
      strategyId: strategy?.id || null,
      depositAmount,
      days,
      projectedFinalBalance: Number(equity.toFixed(2)),
      projectedYield,
      projectedApyPercent: effectiveApy,
      maxDrawdownPercent: Number(maxDrawdown.toFixed(2)),
      feesPaid: Number(feesPaid.toFixed(2)),
      compoundEveryDays,
      assumptions: {
        deterministicSeries: true,
        source: strategy
          ? `Mocked historical blend for ${strategy.protocol}`
          : "Mocked historical protocol basket",
      },
      series,
    };
  }

  findStrategy(id) {
    return this.strategies.find((strategy) => strategy.id === Number(id)) || null;
  }

  findOrCreatePosition(strategy, user) {
    let position = strategy.positions.find((item) => item.user === user);
    if (!position) {
      position = {
        user,
        shares: 0,
        principal: 0,
        lastActionTs: nowSeconds(),
      };
      strategy.positions.push(position);
    }
    return position;
  }

  positionValue(strategy, shares) {
    if (strategy.totalShares === 0 || shares === 0) {
      return 0;
    }
    return Math.floor((shares * strategy.totalDeposited) / strategy.totalShares);
  }

  serializePosition(strategy, position) {
    return {
      user: position.user,
      shares: position.shares,
      principal: position.principal,
      currentBalance: this.positionValue(strategy, position.shares),
      lastActionTs: position.lastActionTs,
    };
  }

  serializeStrategy(strategy) {
    return {
      id: strategy.id,
      name: strategy.name,
      protocol: strategy.protocol,
      apyBps: strategy.apyBps,
      feeBps: strategy.feeBps,
      tvl: strategy.totalDeposited,
      totalShares: strategy.totalShares,
      isActive: strategy.isActive,
      compoundInterval: strategy.compoundInterval,
      lastCompoundTs: strategy.lastCompoundTs,
      createdAt: strategy.createdAt,
      updatedAt: strategy.updatedAt,
      positions: strategy.positions.map((position) =>
        this.serializePosition(strategy, position)
      ),
    };
  }

  recordHistory(event) {
    this.history.push({
      id: this.historySeq++,
      timestamp: nowIso(),
      ...event,
    });
  }

  assertAdmin(actor) {
    if (actor !== DEFAULT_ADMIN) {
      const error = new Error("Only the configured admin can update strategies");
      error.statusCode = 403;
      throw error;
    }
  }

  invalidateCache() {
    this.cachedDashboard = null;
    this.cacheExpiresAt = 0;
  }
}

const yieldOptimizerService = new YieldOptimizerService();

export default yieldOptimizerService;
