import express from "express";
import { exec } from "child_process";
import fs from "fs/promises";
import path from "path";
import { sanitizeDependenciesInput, buildCargoToml } from "./compile_utils.js";

const router = express.Router();

// Design notes for dependency injection:
// - Request format: { code: string, dependencies?: { [crate_name]: version_string } }
// - Injection point: all provided dependencies are injected under the [dependencies] section.
// - Critical dependencies: we always pin soroban-sdk to BASE_SDK_VERSION and ignore user overrides.
// - Validation:
//   - crate_name: ^[a-z0-9][a-z0-9_-]{0,63}$ (lowercase; digits; '-' and '_' allowed; max 64 chars)
//   - version_string: whitelist characters only: 0-9 a-z A-Z . ^ ~ * < > = , + - x X and spaces; max 50 chars
//   - dependencies object: at most MAX_DEPS items; keys/values must be strings; no quotes/newlines allowed
// - Safety:
//   - Reject any names/versions containing quotes, brackets, or newlines to avoid TOML injection.
//   - Never overwrite soroban-sdk; ensure duplicates are deduped deterministically (sorted by name).
//   - Keep TOML formatting minimal and deterministic to avoid build instability.

router.post("/", async (req, res) => {
  const { code, dependencies } = req.body || {};
  if (!code) {
    return res.status(400).json({ error: "No code provided" });
  }

  // Validate dependencies (optional and backward compatible)
  const depValidation = sanitizeDependenciesInput(dependencies);
  if (!depValidation.ok) {
    return res.status(400).json(depValidation.details ? { error: depValidation.error, details: depValidation.details } : { error: depValidation.error });
  }

  // Define a temporary working directory for this compilation
  const tempDir = path.resolve(process.cwd(), ".tmp_compile_" + Date.now());

  try {
    // Scaffold a temp Rust project
    await fs.mkdir(tempDir, { recursive: true });
    await fs.mkdir(path.join(tempDir, "src"), { recursive: true });

    // Write Cargo.toml (with injected dependencies)
    // Any formatting/injection error is treated as a client-side dependency payload issue.
    let cargoToml;
    try {
      cargoToml = buildCargoToml(depValidation.deps);
    } catch (injectionErr) {
      return res.status(400).json({
        error: "Failed to build Cargo.toml from dependencies",
        details: injectionErr.message
      });
    }
    await fs.writeFile(path.join(tempDir, "Cargo.toml"), cargoToml);

    // Write the contract code
    await fs.writeFile(path.join(tempDir, "src", "lib.rs"), code);

    // Execute Soroban CLI (or cargo block)
    // Note: In a real server you might queue these or containerize. Here we spawn.
    const command = `cargo build --target wasm32-unknown-unknown --release`;

    exec(command, { cwd: tempDir, timeout: 30000 }, async (err, stdout, stderr) => {
      // Setup cleanup task
      const cleanUp = async () => {
        try {
          await fs.rm(tempDir, { recursive: true, force: true });
        } catch (e) {
          console.error("Failed to clean up:", e);
        }
      };

      if (err) {
        await cleanUp();
        return res.status(500).json({ 
          error: "Compilation failed", 
          status: "error",
          details: stderr || err.message,
          logs: stderr ? stderr.split('\n').filter(l => l.trim()) : []
        });
      }

      // Check if wasm exists
      const wasmPath = path.join(tempDir, "target", "wasm32-unknown-unknown", "release", "soroban_contract.wasm");
      try {
        const fileStats = await fs.stat(wasmPath);
        // It's built successfully
        await cleanUp();
        return res.json({ 
          success: true, 
          status: "success",
          message: "Contract compiled successfully",
          logs: (stdout + (stderr ? "\n" + stderr : "")).split('\n').filter(l => l.trim()),
          artifact: {
            name: "soroban_contract.wasm",
            sizeBytes: fileStats.size,
            createdAt: fileStats.birthtime
          }
        });
      } catch (e) {
        await cleanUp();
        return res.status(500).json({ 
          error: "WASM file not generated", 
          status: "error",
          details: stderr || e.message,
          logs: stderr ? stderr.split('\n').filter(l => l.trim()) : []
        });
      }
    });

  } catch (err) {
    try { await fs.rm(tempDir, { recursive: true, force: true }); } catch (cleanupErr) {}
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

export default router;
