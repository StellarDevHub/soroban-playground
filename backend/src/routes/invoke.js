import express from "express";

const router = express.Router();

function validateInvokeRequest(body) {
  const { contractId, functionName, args } = body || {};
  const errors = [];

  if (!contractId) {
    errors.push("contractId is required");
  } else if (typeof contractId !== "string") {
    errors.push("contractId must be a string");
  } else if (!/^C[A-Z0-9]{55}$/.test(contractId)) {
    errors.push("contractId must be a valid Stellar contract ID (56 characters, starting with 'C')");
  }

  if (!functionName) {
    errors.push("functionName is required");
  } else if (typeof functionName !== "string") {
    errors.push("functionName must be a string");
  } else if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(functionName)) {
    errors.push("functionName must be a valid identifier (alphanumeric and underscore, starting with letter or underscore)");
  }

  if (args !== undefined && args !== null) {
    if (typeof args !== "object" || Array.isArray(args)) {
      errors.push("args must be an object");
    }
  }

  if (errors.length > 0) {
    return { error: "Validation failed", details: errors };
  }
  return null;
}

function normalizeArgs(args) {
  if (args === null || args === undefined || typeof args !== "object" || Array.isArray(args)) {
    return {};
  }
  return args;
}

router.post("/", async (req, res) => {
  const validationError = validateInvokeRequest(req.body);
  if (validationError) {
    return res.status(400).json({ success: false, status: "error", ...validationError });
  }

  const { contractId, functionName, args } = req.body;
  const normalizedArgs = normalizeArgs(args);

  console.log(`Invoking ${contractId} -> ${functionName} with args:`, normalizedArgs);

  setTimeout(() => {
    res.json({
      success: true,
      status: "success",
      contractId,
      functionName,
      args: normalizedArgs,
      output: normalizedArgs && normalizedArgs.name ? normalizedArgs.name : "Success",
      message: `Function "${functionName}" invoked successfully`,
      invokedAt: new Date().toISOString(),
    });
  }, 1000);
});

export default router;
