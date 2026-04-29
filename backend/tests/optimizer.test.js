import assert from "node:assert/strict";
import test from "node:test";

import yieldOptimizerService from "../src/services/yieldOptimizerService.js";

const { adminAddress, executorAddress } = yieldOptimizerService.getConfig();

test("create strategy + deposit + withdraw lifecycle", async () => {
  yieldOptimizerService.reset();

  const strategy = await yieldOptimizerService.createStrategy({
    actor: adminAddress,
    name: "Cross-Protocol Stable Blend",
    protocol: "Blend + Aquarius",
    apyBps: 1320,
    feeBps: 250,
    compoundInterval: 86400,
  });

  assert.equal(strategy.name, "Cross-Protocol Stable Blend");

  const deposited = await yieldOptimizerService.deposit(strategy.id, "GUSEROPT1", 5000);
  assert.equal(deposited.sharesMinted, 5000);

  const withdrawn = await yieldOptimizerService.withdraw(strategy.id, "GUSEROPT1", 1200);
  assert.equal(withdrawn.withdrawnAmount, 1200);
  assert.ok(withdrawn.strategy.tvl >= 3800);
});

test("compound restricted to admin or executor", async () => {
  yieldOptimizerService.reset();

  const strategy = await yieldOptimizerService.createStrategy({
    actor: adminAddress,
    name: "Keeper Compound Vault",
    protocol: "Blend + Wave",
    apyBps: 1500,
    feeBps: 300,
    compoundInterval: 1,
  });

  await yieldOptimizerService.deposit(strategy.id, "GUSEROPT2", 10000);

  await assert.rejects(
    () => yieldOptimizerService.compound(strategy.id, "GUNAUTHORIZED"),
    /Only the admin or executor can compound a strategy/
  );

  await new Promise((resolve) => setTimeout(resolve, 1100));
  const result = await yieldOptimizerService.compound(strategy.id, executorAddress);
  assert.ok(result.compoundedTvl >= 10000);
});

test("backtest is deterministic for same inputs", async () => {
  yieldOptimizerService.reset();

  const payload = {
    depositAmount: 10000,
    days: 30,
    apyBps: 1200,
    feeBps: 250,
    compoundEveryDays: 7,
  };

  const first = await yieldOptimizerService.backtest(payload);
  const second = await yieldOptimizerService.backtest(payload);

  assert.deepEqual(first, second);
  assert.equal(first.series.length, 30);
  assert.equal(first.assumptions.deterministicSeries, true);
});
