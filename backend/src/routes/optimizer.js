import express from "express";

import yieldOptimizerService from "../services/yieldOptimizerService.js";

const router = express.Router();

function actorFrom(req) {
  const headerActor = req.headers["x-actor-address"];
  if (typeof headerActor === "string" && headerActor.trim()) {
    return headerActor.trim();
  }
  if (typeof req.body?.actor === "string" && req.body.actor.trim()) {
    return req.body.actor.trim();
  }
  return "";
}

function isText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function errorResponse(res, statusCode, message, details) {
  return res.status(statusCode).json({
    success: false,
    status: "error",
    message,
    ...(details ? { details } : {}),
  });
}

router.get("/", async (_req, res) => {
  return res.json({
    success: true,
    status: "success",
    message: "Yield optimizer dashboard loaded",
    data: await yieldOptimizerService.getDashboard(),
  });
});

router.get("/health", async (_req, res) => {
  const dashboard = await yieldOptimizerService.getDashboard();
  return res.json({
    success: true,
    status: "success",
    message: "Yield optimizer service healthy",
    data: {
      status: "ok",
      strategies: dashboard.metrics.strategyCount,
      totalTvl: dashboard.metrics.totalTvl,
      timestamp: new Date().toISOString(),
      service: "soroban-playground-yield-optimizer",
    },
  });
});

router.get("/strategies", async (_req, res) => {
  return res.json({
    success: true,
    status: "success",
    message: "Strategies loaded",
    data: await yieldOptimizerService.listStrategies(),
  });
});

router.post("/strategies", async (req, res) => {
  const actor = actorFrom(req);
  const body = {
    ...req.body,
    apyBps: Number(req.body?.apyBps),
    feeBps: Number(req.body?.feeBps),
    compoundInterval: Number(req.body?.compoundInterval),
  };
  const errors = [];

  if (!actor) errors.push("actor is required");
  if (!isText(body.name)) errors.push("name is required");
  if (!isText(body.protocol)) errors.push("protocol is required");
  if (!Number.isFinite(body.apyBps) || body.apyBps < 0) {
    errors.push("apyBps must be a non-negative number");
  }
  if (!Number.isFinite(body.feeBps) || body.feeBps < 0) {
    errors.push("feeBps must be a non-negative number");
  }
  if (!Number.isFinite(body.compoundInterval) || body.compoundInterval <= 0) {
    errors.push("compoundInterval must be a positive number");
  }

  if (errors.length > 0) {
    return errorResponse(res, 400, "Validation failed", errors);
  }

  try {
    const strategy = await yieldOptimizerService.createStrategy({
      actor,
      name: body.name.trim(),
      protocol: body.protocol.trim(),
      apyBps: body.apyBps,
      feeBps: body.feeBps,
      compoundInterval: body.compoundInterval,
    });

    return res.status(201).json({
      success: true,
      status: "success",
      message: "Strategy created successfully",
      data: strategy,
    });
  } catch (error) {
    return errorResponse(res, error.statusCode || 500, error.message);
  }
});

router.patch("/strategies/:id", async (req, res) => {
  const actor = actorFrom(req);
  const body = {
    ...req.body,
    apyBps: Number(req.body?.apyBps),
    feeBps: Number(req.body?.feeBps),
    compoundInterval: Number(req.body?.compoundInterval),
    isActive: Boolean(req.body?.isActive),
  };

  if (!actor) {
    return errorResponse(res, 400, "Validation failed", ["actor is required"]);
  }

  try {
    const strategy = await yieldOptimizerService.updateStrategy(req.params.id, actor, body);
    if (!strategy) {
      return errorResponse(res, 404, "Strategy not found");
    }
    return res.json({
      success: true,
      status: "success",
      message: "Strategy settings updated",
      data: strategy,
    });
  } catch (error) {
    return errorResponse(res, error.statusCode || 500, error.message);
  }
});

router.post("/strategies/:id/deposit", async (req, res) => {
  const actor = actorFrom(req);
  const amount = Number(req.body?.amount);

  if (!actor || !Number.isFinite(amount) || amount <= 0) {
    return errorResponse(res, 400, "Validation failed", [
      "actor is required",
      "amount must be a positive number",
    ]);
  }

  try {
    const result = await yieldOptimizerService.deposit(req.params.id, actor, amount);
    if (!result) {
      return errorResponse(res, 404, "Strategy not found");
    }
    return res.json({
      success: true,
      status: "success",
      message: "Deposit completed successfully",
      data: result,
    });
  } catch (error) {
    return errorResponse(res, error.statusCode || 500, error.message);
  }
});

router.post("/strategies/:id/withdraw", async (req, res) => {
  const actor = actorFrom(req);
  const amount = Number(req.body?.amount);

  if (!actor || !Number.isFinite(amount) || amount <= 0) {
    return errorResponse(res, 400, "Validation failed", [
      "actor is required",
      "amount must be a positive number",
    ]);
  }

  try {
    const result = await yieldOptimizerService.withdraw(req.params.id, actor, amount);
    if (!result) {
      return errorResponse(res, 404, "Strategy not found");
    }
    return res.json({
      success: true,
      status: "success",
      message: "Withdrawal completed successfully",
      data: result,
    });
  } catch (error) {
    return errorResponse(res, error.statusCode || 500, error.message);
  }
});

router.post("/strategies/:id/compound", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) {
    return errorResponse(res, 400, "Validation failed", ["actor is required"]);
  }

  try {
    const result = await yieldOptimizerService.compound(req.params.id, actor);
    if (!result) {
      return errorResponse(res, 404, "Strategy not found");
    }
    return res.json({
      success: true,
      status: "success",
      message: "Compound executed successfully",
      data: result,
    });
  } catch (error) {
    return errorResponse(res, error.statusCode || 500, error.message);
  }
});

router.post("/backtest", async (req, res) => {
  const body = {
    strategyId: req.body?.strategyId != null ? Number(req.body.strategyId) : null,
    depositAmount: Number(req.body?.depositAmount),
    days: Number(req.body?.days),
    apyBps: Number(req.body?.apyBps),
    feeBps: Number(req.body?.feeBps),
    compoundEveryDays: Number(req.body?.compoundEveryDays),
  };

  const errors = [];
  if (!Number.isFinite(body.depositAmount) || body.depositAmount <= 0) {
    errors.push("depositAmount must be a positive number");
  }
  if (!Number.isFinite(body.days) || body.days <= 0) {
    errors.push("days must be a positive number");
  }
  if (body.strategyId == null) {
    if (!Number.isFinite(body.apyBps) || body.apyBps < 0) {
      errors.push("apyBps must be provided when strategyId is omitted");
    }
    if (!Number.isFinite(body.feeBps) || body.feeBps < 0) {
      errors.push("feeBps must be provided when strategyId is omitted");
    }
    if (!Number.isFinite(body.compoundEveryDays) || body.compoundEveryDays <= 0) {
      errors.push("compoundEveryDays must be provided when strategyId is omitted");
    }
  }

  if (errors.length > 0) {
    return errorResponse(res, 400, "Validation failed", errors);
  }

  return res.json({
    success: true,
    status: "success",
    message: "Backtest completed successfully",
    data: await yieldOptimizerService.backtest(body),
  });
});

export default router;
