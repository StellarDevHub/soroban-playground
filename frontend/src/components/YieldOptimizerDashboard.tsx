"use client";

import { useEffect, useState } from "react";

import yieldOptimizerService, {
  type OptimizerBacktest,
  type OptimizerDashboard,
} from "@/services/yieldOptimizerService";

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  }).format(value);
}

function bpsToPercent(value: number) {
  return `${(value / 100).toFixed(2)}%`;
}

export default function YieldOptimizerDashboard() {
  const [dashboard, setDashboard] = useState<OptimizerDashboard | null>(null);
  const [selectedStrategyId, setSelectedStrategyId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string>("");
  const [backtest, setBacktest] = useState<OptimizerBacktest | null>(null);

  const [strategyForm, setStrategyForm] = useState({
    name: "Cross-Protocol Stable Vault",
    protocol: "Blend + Aquarius",
    apyBps: "1200",
    feeBps: "250",
    compoundInterval: "86400",
  });

  const [flowForm, setFlowForm] = useState({
    actor: "GDEMOYIELDUSER000000000000000000000000000000000000",
    amount: "2000",
  });

  const [settingsForm, setSettingsForm] = useState({
    apyBps: "1200",
    feeBps: "250",
    compoundInterval: "86400",
    isActive: true,
  });

  const [backtestForm, setBacktestForm] = useState({
    depositAmount: "10000",
    days: "30",
  });

  const selectedStrategy =
    dashboard?.strategies.find((s) => s.id === selectedStrategyId) ||
    dashboard?.strategies[0] ||
    null;

  async function refreshDashboard() {
    const data = await yieldOptimizerService.getDashboard();
    setDashboard(data);
    const fallback = selectedStrategyId ?? data.strategies[0]?.id ?? null;
    setSelectedStrategyId(fallback);

    const selected = data.strategies.find((s) => s.id === fallback);
    if (selected) {
      setSettingsForm({
        apyBps: String(selected.apyBps),
        feeBps: String(selected.feeBps),
        compoundInterval: String(selected.compoundInterval),
        isActive: selected.isActive,
      });
    }
  }

  useEffect(() => {
    async function boot() {
      try {
        await yieldOptimizerService.getHealth();
        await refreshDashboard();
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "Failed to connect to backend.");
      } finally {
        setLoading(false);
      }
    }

    void boot();
  }, []);

  async function runAction(action: () => Promise<void>, successText: string) {
    setBusy(true);
    setFeedback("");

    try {
      await action();
      await refreshDashboard();
      setFeedback(successText);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">Yield Optimizer</p>
              <h1 className="mt-2 text-3xl font-semibold text-white">Cross-Protocol Strategy Hub</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-300">
                Create strategies, manage user flows, execute auto-compounds, and run deterministic backtests.
              </p>
            </div>
            <a
              href="/"
              className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:border-cyan-400"
            >
              Back to IDE
            </a>
          </div>
          {feedback ? (
            <p className="mt-4 rounded-xl border border-cyan-500/25 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-100">
              {feedback}
            </p>
          ) : null}
        </header>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Strategies" value={String(dashboard?.metrics.strategyCount || 0)} />
          <Metric label="TVL" value={money(dashboard?.metrics.totalTvl || 0)} />
          <Metric label="Average APY" value={bpsToPercent(dashboard?.metrics.averageApyBps || 0)} />
          <Metric label="Users" value={String(dashboard?.metrics.totalUsers || 0)} />
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
          <div className="space-y-6">
            <Card title="Create Strategy">
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Name" value={strategyForm.name} onChange={(value) => setStrategyForm((p) => ({ ...p, name: value }))} />
                <Field label="Protocol" value={strategyForm.protocol} onChange={(value) => setStrategyForm((p) => ({ ...p, protocol: value }))} />
                <Field label="APY (bps)" value={strategyForm.apyBps} onChange={(value) => setStrategyForm((p) => ({ ...p, apyBps: value }))} />
                <Field label="Fee (bps)" value={strategyForm.feeBps} onChange={(value) => setStrategyForm((p) => ({ ...p, feeBps: value }))} />
                <div className="md:col-span-2">
                  <Field
                    label="Compound Interval (seconds)"
                    value={strategyForm.compoundInterval}
                    onChange={(value) => setStrategyForm((p) => ({ ...p, compoundInterval: value }))}
                  />
                </div>
              </div>
              <button
                type="button"
                disabled={busy || loading || !dashboard}
                className="mt-4 rounded-xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() =>
                  void runAction(async () => {
                    if (!dashboard) return;
                    const strategy = await yieldOptimizerService.createStrategy({
                      actor: dashboard.config.adminAddress,
                      name: strategyForm.name.trim(),
                      protocol: strategyForm.protocol.trim(),
                      apyBps: Number(strategyForm.apyBps),
                      feeBps: Number(strategyForm.feeBps),
                      compoundInterval: Number(strategyForm.compoundInterval),
                    });
                    setSelectedStrategyId(strategy.id);
                  }, "Strategy created")
                }
              >
                Create Strategy
              </button>
            </Card>

            <Card title="Deposit / Withdraw">
              <div className="grid gap-3 md:grid-cols-2">
                <Field
                  label="User Address"
                  value={flowForm.actor}
                  onChange={(value) => setFlowForm((p) => ({ ...p, actor: value }))}
                />
                <Field
                  label="Amount"
                  value={flowForm.amount}
                  onChange={(value) => setFlowForm((p) => ({ ...p, amount: value }))}
                />
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={busy || !selectedStrategy}
                  className="rounded-xl bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() =>
                    void runAction(
                      async () => {
                        if (!selectedStrategy) return;
                        await yieldOptimizerService.deposit(
                          selectedStrategy.id,
                          flowForm.actor.trim(),
                          Number(flowForm.amount)
                        );
                      },
                      "Deposit complete"
                    )
                  }
                >
                  Deposit
                </button>
                <button
                  type="button"
                  disabled={busy || !selectedStrategy}
                  className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() =>
                    void runAction(
                      async () => {
                        if (!selectedStrategy) return;
                        await yieldOptimizerService.withdraw(
                          selectedStrategy.id,
                          flowForm.actor.trim(),
                          Number(flowForm.amount)
                        );
                      },
                      "Withdraw complete"
                    )
                  }
                >
                  Withdraw
                </button>
              </div>
            </Card>

            <Card title="Auto-Compound & Backtest">
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="APY (bps)" value={settingsForm.apyBps} onChange={(value) => setSettingsForm((p) => ({ ...p, apyBps: value }))} />
                <Field label="Fee (bps)" value={settingsForm.feeBps} onChange={(value) => setSettingsForm((p) => ({ ...p, feeBps: value }))} />
                <Field
                  label="Compound Interval (seconds)"
                  value={settingsForm.compoundInterval}
                  onChange={(value) => setSettingsForm((p) => ({ ...p, compoundInterval: value }))}
                />
                <label className="flex items-center gap-2 rounded-xl border border-slate-800 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={settingsForm.isActive}
                    onChange={(event) =>
                      setSettingsForm((p) => ({ ...p, isActive: event.target.checked }))
                    }
                  />
                  Strategy Active
                </label>
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={busy || !selectedStrategy || !dashboard}
                  className="rounded-xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() =>
                    void runAction(
                      async () => {
                        if (!selectedStrategy || !dashboard) return;
                        await yieldOptimizerService.updateStrategy(
                          selectedStrategy.id,
                          dashboard.config.adminAddress,
                          {
                            apyBps: Number(settingsForm.apyBps),
                            feeBps: Number(settingsForm.feeBps),
                            compoundInterval: Number(settingsForm.compoundInterval),
                            isActive: settingsForm.isActive,
                          }
                        );
                      },
                      "Settings updated"
                    )
                  }
                >
                  Save Settings
                </button>
                <button
                  type="button"
                  disabled={busy || !selectedStrategy || !dashboard}
                  className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() =>
                    void runAction(
                      async () => {
                        if (!selectedStrategy || !dashboard) return;
                        await yieldOptimizerService.compound(
                          selectedStrategy.id,
                          dashboard.config.executorAddress
                        );
                      },
                      "Compound executed"
                    )
                  }
                >
                  Run Compound
                </button>
              </div>

              <div className="mt-5 rounded-xl border border-slate-800 p-4">
                <p className="text-sm font-semibold text-white">Backtest</p>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <Field
                    label="Deposit Amount"
                    value={backtestForm.depositAmount}
                    onChange={(value) => setBacktestForm((p) => ({ ...p, depositAmount: value }))}
                  />
                  <Field
                    label="Days"
                    value={backtestForm.days}
                    onChange={(value) => setBacktestForm((p) => ({ ...p, days: value }))}
                  />
                </div>
                <button
                  type="button"
                  disabled={busy || !selectedStrategy}
                  className="mt-4 rounded-xl bg-amber-300 px-4 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() =>
                    void runAction(
                      async () => {
                        if (!selectedStrategy) return;
                        const result = await yieldOptimizerService.backtest({
                          strategyId: selectedStrategy.id,
                          depositAmount: Number(backtestForm.depositAmount),
                          days: Number(backtestForm.days),
                        });
                        setBacktest(result);
                      },
                      "Backtest completed"
                    )
                  }
                >
                  Run Backtest
                </button>

                {backtest ? (
                  <div className="mt-4 grid gap-2 text-sm text-slate-200 sm:grid-cols-2">
                    <span>Projected Final: {money(backtest.projectedFinalBalance)}</span>
                    <span>Projected Yield: {money(backtest.projectedYield)}</span>
                    <span>Projected APY: {backtest.projectedApyPercent.toFixed(2)}%</span>
                    <span>Max Drawdown: {backtest.maxDrawdownPercent.toFixed(2)}%</span>
                    <span>Fees: {money(backtest.feesPaid)}</span>
                    <span>Compounding Every: {backtest.compoundEveryDays} days</span>
                  </div>
                ) : null}
              </div>
            </Card>
          </div>

          <div className="space-y-6">
            <Card title="Strategies">
              <div className="space-y-3">
                {dashboard?.strategies.length ? (
                  dashboard.strategies.map((strategy) => (
                    <button
                      key={strategy.id}
                      type="button"
                      onClick={() => setSelectedStrategyId(strategy.id)}
                      className={`w-full rounded-xl border p-3 text-left transition ${
                        strategy.id === selectedStrategy?.id
                          ? "border-cyan-400 bg-cyan-400/10"
                          : "border-slate-800 bg-slate-900/50 hover:border-slate-600"
                      }`}
                    >
                      <p className="text-sm font-semibold text-white">{strategy.name}</p>
                      <p className="text-xs text-slate-400">{strategy.protocol}</p>
                      <div className="mt-2 grid gap-1 text-xs text-slate-300 sm:grid-cols-2">
                        <span>APY: {bpsToPercent(strategy.apyBps)}</span>
                        <span>TVL: {money(strategy.tvl)}</span>
                        <span>Fee: {bpsToPercent(strategy.feeBps)}</span>
                        <span>{strategy.isActive ? "active" : "paused"}</span>
                      </div>
                    </button>
                  ))
                ) : (
                  <p className="text-sm text-slate-400">No strategies yet.</p>
                )}
              </div>
            </Card>

            <Card title="Recent History">
              <div className="space-y-3">
                {dashboard?.history.length ? (
                  dashboard.history.slice(0, 10).map((event) => (
                    <div key={event.id} className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
                      <p className="text-sm font-semibold text-white">{event.action}</p>
                      <p className="text-xs text-slate-400">{new Date(event.timestamp).toLocaleString()}</p>
                      <p className="text-xs text-slate-500">Actor: {event.actor.slice(0, 8)}...</p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-400">History will appear as actions run.</p>
                )}
              </div>
            </Card>
          </div>
        </section>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <p className="text-xs uppercase tracking-[0.14em] text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <h2 className="mb-4 text-lg font-semibold text-white">{title}</h2>
      {children}
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-[0.12em] text-slate-400">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400"
      />
    </label>
  );
}
