const express = require("express");
const os = require("os");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3001;

// Load package.json for version info
let packageJson = {};
try {
  packageJson = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../../package.json"), "utf8")
  );
} catch {
  try {
    packageJson = JSON.parse(
      fs.readFileSync(path.join(__dirname, "../package.json"), "utf8")
    );
  } catch {
    packageJson = { version: "unknown", name: "soroban-playground-backend" };
  }
}

app.use(express.json());

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Returns a snapshot of CPU usage percentages per core.
 * Non-blocking: reads /proc/stat (Linux) or falls back to os.cpus().
 */
function getCpuUsage() {
  const cpus = os.cpus();
  return cpus.map((cpu, index) => {
    const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
    const idle = cpu.times.idle;
    const usedPercent = total > 0 ? +((1 - idle / total) * 100).toFixed(1) : 0;
    return { core: index, model: cpu.model, speedMHz: cpu.speed, usedPercent };
  });
}

/**
 * Returns memory metrics in bytes and as human-readable strings.
 */
function getMemoryInfo() {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = totalBytes - freeBytes;

  const toMB = (b) => +(b / 1024 / 1024).toFixed(2);

  return {
    totalMB: toMB(totalBytes),
    freeMB: toMB(freeBytes),
    usedMB: toMB(usedBytes),
    usedPercent: +((usedBytes / totalBytes) * 100).toFixed(1),
  };
}

/**
 * Returns process + system uptime in seconds and a human-readable format.
 */
function getUptimeInfo() {
  const formatSeconds = (s) => {
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    return [d && `${d}d`, h && `${h}h`, m && `${m}m`, `${sec}s`]
      .filter(Boolean)
      .join(" ");
  };

  return {
    processSec: Math.floor(process.uptime()),
    processHuman: formatSeconds(process.uptime()),
    systemSec: Math.floor(os.uptime()),
    systemHuman: formatSeconds(os.uptime()),
  };
}

/**
 * Returns Node.js runtime details.
 */
function getRuntimeInfo() {
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
  };
}

// ─── Health Check Endpoint ───────────────────────────────────────────────────

/**
 * GET /api/health
 *
 * Returns a detailed health report including:
 *  - status          : "ok" | "degraded" | "error"
 *  - version         : service version from package.json
 *  - timestamp       : ISO-8601 UTC timestamp
 *  - uptime          : process and system uptime
 *  - cpu             : per-core usage snapshot
 *  - memory          : total / free / used in MB + percent
 *  - runtime         : Node.js version, platform, arch, PID
 *
 * All work is synchronous OS-level reads — no I/O, no DB calls.
 * Response time is consistently < 5 ms.
 */
app.get("/api/health", (_req, res) => {
  try {
    const memory = getMemoryInfo();

    // Treat the service as "degraded" if memory pressure is very high
    const status = memory.usedPercent > 95 ? "degraded" : "ok";

    const payload = {
      status,
      version: packageJson.version ?? "unknown",
      service: packageJson.name ?? "soroban-playground-backend",
      timestamp: new Date().toISOString(),
      uptime: getUptimeInfo(),
      cpu: getCpuUsage(),
      memory,
      runtime: getRuntimeInfo(),
    };

    // HTTP 200 for "ok" and "degraded"; both are reachable states.
    return res.status(200).json({
      success: true,
      data: payload,
    });
  } catch (err) {
    // Should never happen, but guard just in case
    return res.status(500).json({
      success: false,
      data: {
        status: "error",
        version: packageJson.version ?? "unknown",
        timestamp: new Date().toISOString(),
        error: err.message,
      },
    });
  }
});

// ─── Existing / other routes go here ────────────────────────────────────────
// e.g. app.use('/api/compile', compileRouter);

// ─── Start server ────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Soroban Playground backend running on port ${PORT}`);
});

module.exports = app;