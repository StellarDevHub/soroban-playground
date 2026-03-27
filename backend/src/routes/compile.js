import express from "express";
import { exec } from "child_process";
import fs from "fs/promises";
import path from "path";
import { sanitizeDependenciesInput, buildCargoToml } from "./compile_utils.js";
import { asyncHandler, createHttpError } from "../middleware/errorHandler.js";
import config from "../config/index.js";

const router = express.Router();

router.post("/", asyncHandler(async (req, res, next) => {
  const { code, dependencies } = req.body || {};
  if (!code) {
    return next(createHttpError(400, "No code provided"));
  }

  // Validate dependencies (optional and backward compatible)
  const depValidation = sanitizeDependenciesInput(dependencies);
  if (!depValidation.ok) {
    return next(createHttpError(400, depValidation.error, depValidation.details));
  }

  // Unique temp directory per compile
  const uniqueSuffix = Date.now() + "_" + Math.random().toString(36).substring(2, 8);
  const tempDir = path.resolve(process.cwd(), ".tmp_compile_" + uniqueSuffix);

  try {
    await fs.mkdir(tempDir, { recursive: true });
    await fs.mkdir(path.join(tempDir, "src"), { recursive: true });

    // Write Cargo.toml (with injected dependencies)
    let cargoToml;
    try {
      cargoToml = buildCargoToml(depValidation.deps);
    } catch (injectionErr) {
      return next(createHttpError(400, "Failed to build Cargo.toml from dependencies", injectionErr.message));
    }
    await fs.writeFile(path.join(tempDir, "Cargo.toml"), cargoToml);
    await fs.writeFile(path.join(tempDir, "src", "lib.rs"), code);

    const command = `cargo build --target wasm32-unknown-unknown --release`;

    exec(command, { cwd: tempDir, timeout: 30000 }, async (err, stdout, stderr) => {
      const cleanUp = async () => {
        try {
          await fs.rm(tempDir, { recursive: true, force: true });
        } catch (e) {
          console.error("Failed to clean up:", e);
        }
      };

      if (err) {
        await cleanUp();
        return next(createHttpError(500, "Compilation failed", {
          details: stderr || err.message,
          logs: stderr ? stderr.split("\n").filter((l) => l.trim()) : []
        }));
      }

      const wasmPath = path.join(tempDir, "target", "wasm32-unknown-unknown", "release", "soroban_contract.wasm");
      try {
        const fileStats = await fs.stat(wasmPath);
        await cleanUp();
        return res.json({
          success: true,
          status: "success",
          message: "Contract compiled successfully",
          logs: (stdout + (stderr ? "\n" + stderr : "")).split("\n").filter(l => l.trim()),
          artifact: {
            name: "soroban_contract.wasm",
            sizeBytes: fileStats.size,
            createdAt: fileStats.birthtime,
          },
        });
      } catch (e) {
        await cleanUp();
        return next(createHttpError(500, "WASM file not generated", {
          details: stderr || e.message,
          logs: stderr ? stderr.split("\n").filter((l) => l.trim()) : []
        }));
      }
    });
  } catch (err) {
    try { await fs.rm(tempDir, { recursive: true, force: true }); } catch (cleanupErr) {}
    return next(createHttpError(500, "Internal server error", err.message));
  }
}));

export default router;
