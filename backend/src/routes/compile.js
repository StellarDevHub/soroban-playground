import express from 'express';
import { exec } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

const router = express.Router();

router.post('/', async (req, res) => {
  const { code } = req.body;
  if (!code) {
    return res.status(400).json({ error: 'No code provided' });
  }

  // Define a temporary working directory for this compilation
  const tempDir = path.resolve(process.cwd(), '.tmp_compile_' + Date.now());

  try {
    // Scaffold a temp Rust project
    await fs.mkdir(tempDir, { recursive: true });
    await fs.mkdir(path.join(tempDir, 'src'), { recursive: true });

    // Write Cargo.toml
    const cargoToml = `
[package]
name = "soroban_contract"
version = "0.0.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
soroban-sdk = "20.0.0"

[profile.release]
opt-level = "z"
overflow-checks = true
debug = 0
strip = "symbols"
debug-assertions = false
panic = "abort"
codegen-units = 1
lto = true
`;
    await fs.writeFile(path.join(tempDir, 'Cargo.toml'), cargoToml);

    // Write the contract code
    await fs.writeFile(path.join(tempDir, 'src', 'lib.rs'), code);

    // Execute Soroban CLI (or cargo block)
    // Note: In a real server you might queue these or containerize. Here we spawn.
    const command = `cargo build --target wasm32-unknown-unknown --release`;

    exec(
      command,
      { cwd: tempDir, timeout: 30000 },
      async (err, stdout, stderr) => {
        // Setup cleanup task
        const cleanUp = async () => {
          try {
            await fs.rm(tempDir, { recursive: true, force: true });
          } catch (e) {
<<<<<<< HEAD
            console.error('Failed to clean up:', e);
=======
            console.error("Failed to clean up:", e);
>>>>>>> main
          }
        };

        if (err) {
          await cleanUp();
          return res.status(500).json({
<<<<<<< HEAD
            error: 'Compilation failed',
            status: 'error',
            details: stderr || err.message,
            logs: stderr ? stderr.split('\n').filter((l) => l.trim()) : [],
=======
            error: "Compilation failed",
            status: "error",
            details: stderr || err.message,
            logs: stderr ? stderr.split("\n").filter((l) => l.trim()) : [],
>>>>>>> main
          });
        }

        // Check if wasm exists
        const wasmPath = path.join(
          tempDir,
<<<<<<< HEAD
          'target',
          'wasm32-unknown-unknown',
          'release',
          'soroban_contract.wasm'
=======
          "target",
          "wasm32-unknown-unknown",
          "release",
          "soroban_contract.wasm",
>>>>>>> main
        );
        try {
          const fileStats = await fs.stat(wasmPath);
          // It's built successfully
          await cleanUp();
          return res.json({
            success: true,
<<<<<<< HEAD
            status: 'success',
            message: 'Contract compiled successfully',
            logs: (stdout + (stderr ? '\n' + stderr : ''))
              .split('\n')
              .filter((l) => l.trim()),
            artifact: {
              name: 'soroban_contract.wasm',
=======
            status: "success",
            message: "Contract compiled successfully",
            logs: (stdout + (stderr ? "\n" + stderr : ""))
              .split("\n")
              .filter((l) => l.trim()),
            artifact: {
              name: "soroban_contract.wasm",
>>>>>>> main
              sizeBytes: fileStats.size,
              createdAt: fileStats.birthtime,
            },
          });
        } catch (e) {
          await cleanUp();
          return res.status(500).json({
<<<<<<< HEAD
            error: 'WASM file not generated',
            status: 'error',
            details: stderr || e.message,
            logs: stderr ? stderr.split('\n').filter((l) => l.trim()) : [],
          });
        }
      }
=======
            error: "WASM file not generated",
            status: "error",
            details: stderr || e.message,
            logs: stderr ? stderr.split("\n").filter((l) => l.trim()) : [],
          });
        }
      },
>>>>>>> main
    );
  } catch (err) {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (cleanupErr) {}
    res
      .status(500)
<<<<<<< HEAD
      .json({ error: 'Internal server error', details: err.message });
=======
      .json({ error: "Internal server error", details: err.message });
>>>>>>> main
  }
});

export default router;
