import express from "express";
import patentRegistryService from "../services/patentRegistryService.js";

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
    message: "Patent registry dashboard loaded",
    data: await patentRegistryService.getDashboard(),
  });
});

router.get("/health", async (_req, res) => {
  const dashboard = await patentRegistryService.getDashboard();
  return res.json({
    success: true,
    status: "success",
    message: "Patent registry service healthy",
    data: {
      status: "ok",
      patentCount: dashboard.metrics.patentCount,
      verifiedCount: dashboard.metrics.verifiedCount,
      licenseCount: dashboard.metrics.licenseCount,
      paused: dashboard.paused,
      timestamp: new Date().toISOString(),
      service: "soroban-playground-patent-registry",
    },
  });
});

router.post("/patents", async (req, res) => {
  const actor = actorFrom(req);
  const errors = [];

  if (!actor) errors.push("actor is required");
  if (!isText(req.body?.title)) errors.push("title is required");
  if (!isText(req.body?.metadata_uri)) errors.push("metadata_uri is required");
  if (!isText(req.body?.metadata_hash)) errors.push("metadata_hash is required");

  if (errors.length > 0) {
    return errorResponse(res, 400, "Validation failed", errors);
  }

  try {
    const patent = patentRegistryService.registerPatent(
      actor,
      req.body.title.trim(),
      req.body.metadata_uri.trim(),
      req.body.metadata_hash.trim()
    );

    return res.status(201).json({
      success: true,
      status: "success",
      message: "Patent registered successfully",
      data: patent,
    });
  } catch (error) {
    return errorResponse(res, 500, error.message);
  }
});

router.get("/patents", async (_req, res) => {
  try {
    const patents = patentRegistryService.listPatents();
    return res.json({
      success: true,
      status: "success",
      message: "Patents loaded",
      data: patents,
    });
  } catch (error) {
    return errorResponse(res, 500, error.message);
  }
});

router.get("/patents/:id", async (req, res) => {
  try {
    const patent = patentRegistryService.getPatent(Number(req.params.id));
    return res.json({
      success: true,
      status: "success",
      message: "Patent loaded",
      data: patent,
    });
  } catch (error) {
    return errorResponse(res, 404, error.message);
  }
});

router.patch("/patents/:id", async (req, res) => {
  const actor = actorFrom(req);
  const errors = [];

  if (!actor) errors.push("actor is required");
  if (!isText(req.body?.title)) errors.push("title is required");
  if (!isText(req.body?.metadata_uri)) errors.push("metadata_uri is required");
  if (!isText(req.body?.metadata_hash)) errors.push("metadata_hash is required");

  if (errors.length > 0) {
    return errorResponse(res, 400, "Validation failed", errors);
  }

  try {
    const patent = patentRegistryService.updatePatent(
      actor,
      Number(req.params.id),
      req.body.title.trim(),
      req.body.metadata_uri.trim(),
      req.body.metadata_hash.trim()
    );

    return res.json({
      success: true,
      status: "success",
      message: "Patent updated successfully",
      data: patent,
    });
  } catch (error) {
    return errorResponse(res, error.message === "Not patent owner" ? 403 : 500, error.message);
  }
});

router.post("/patents/:id/verify", async (req, res) => {
  const actor = actorFrom(req);

  if (!actor) {
    return errorResponse(res, 400, "Validation failed", ["actor is required"]);
  }

  try {
    const patent = patentRegistryService.verifyPatent(actor, Number(req.params.id));
    return res.json({
      success: true,
      status: "success",
      message: "Patent verified successfully",
      data: patent,
    });
  } catch (error) {
    return errorResponse(
      res,
      error.message === "Not verifier" ? 403 : 500,
      error.message
    );
  }
});

router.post("/patents/:id/licenses", async (req, res) => {
  const actor = actorFrom(req);
  const errors = [];

  if (!actor) errors.push("actor is required");
  if (!isText(req.body?.licensee)) errors.push("licensee is required");
  if (!isText(req.body?.terms)) errors.push("terms is required");
  if (!isText(req.body?.payment_currency)) errors.push("payment_currency is required");
  if (!Number.isFinite(req.body?.payment_amount) || req.body.payment_amount <= 0) {
    errors.push("payment_amount must be a positive number");
  }

  if (errors.length > 0) {
    return errorResponse(res, 400, "Validation failed", errors);
  }

  try {
    const license = patentRegistryService.createLicenseOffer(
      actor,
      Number(req.params.id),
      req.body.licensee.trim(),
      req.body.terms.trim(),
      Number(req.body.payment_amount),
      req.body.payment_currency.trim()
    );

    return res.status(201).json({
      success: true,
      status: "success",
      message: "License offer created successfully",
      data: license,
    });
  } catch (error) {
    return errorResponse(res, error.message === "Not patent owner" ? 403 : 500, error.message);
  }
});

router.get("/patents/:id/licenses", async (req, res) => {
  try {
    const licenses = patentRegistryService.getLicensesByPatent(Number(req.params.id));
    return res.json({
      success: true,
      status: "success",
      message: "Licenses loaded",
      data: licenses,
    });
  } catch (error) {
    return errorResponse(res, 500, error.message);
  }
});

router.patch("/patents/:patent_id/licenses/:license_id", async (req, res) => {
  const actor = actorFrom(req);
  const errors = [];

  if (!actor) errors.push("actor is required");
  if (!isText(req.body?.payment_reference)) errors.push("payment_reference is required");

  if (errors.length > 0) {
    return errorResponse(res, 400, "Validation failed", errors);
  }

  try {
    const license = patentRegistryService.acceptLicense(
      actor,
      Number(req.params.patent_id),
      Number(req.params.license_id),
      req.body.payment_reference.trim()
    );

    return res.json({
      success: true,
      status: "success",
      message: "License accepted successfully",
      data: license,
    });
  } catch (error) {
    return errorResponse(res, error.message === "Unauthorized" ? 403 : 500, error.message);
  }
});

router.get("/licenses", async (_req, res) => {
  try {
    const licenses = patentRegistryService.listLicenses();
    return res.json({
      success: true,
      status: "success",
      message: "Licenses loaded",
      data: licenses,
    });
  } catch (error) {
    return errorResponse(res, 500, error.message);
  }
});

router.get("/licenses/:id", async (req, res) => {
  try {
    const license = patentRegistryService.getLicense(Number(req.params.id));
    return res.json({
      success: true,
      status: "success",
      message: "License loaded",
      data: license,
    });
  } catch (error) {
    return errorResponse(res, 404, error.message);
  }
});

export default router;
