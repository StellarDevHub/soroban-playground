import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import os from "os";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import compileRoute from "./routes/compile.js";
import deployRoute from "./routes/deploy.js";
import invokeRoute from "./routes/invoke.js";
import { notFoundHandler, errorHandler } from "./middleware/errorHandler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

// Load package.json for version info
let packageJson = {};
try {
  packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "../../package.json"), "utf8"));
} catch {
  try {
    packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "../package.json"), "utf8"));
  } catch {
    packageJson = { version: "unknown", name: "soroban-playground-backend" };
  }
}

// Basic middleware
app.use(cors());
app.use(express.json());

// Rate limiting - global limiter
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      status: 429,
      error: "Too Many Requests",
      message: "Too many requests from this IP, please try again later.",
    });
  },
});

// Strict limiter for the heavy /api/compile endpoint
const compileLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      status: 429,
      error: "Too Many Requests",
      message: "Compile endpoint rate limit exceeded. Please wait and try again later.",
    });
  },
});

app.use(globalLimiter);

// Routes
app.use("/api/compile", compileLimiter, compileRoute);
app.use("/api/deploy", deployRoute);
app.use("/api/invoke", invokeRoute);

// ─── Health Check Helpers ────────────────────────────────────────────────────

function getCpuUsage() {
  return os.cpus().map((cpu, index) => {
    const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
    const idle = cpu.times.idle;
    return { core: index, model: cpu.model, speedMHz: cpu.speed, usedPercent: total > 0 ? +((1 - idle / total) * 100).toFixed(1) : 0 };
  });
}

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

function getRuntimeInfo() {
  return { node: process.version, platform: process.platform, arch: process.arch, pid: process.pid };
}

// ─── Health Check Endpoint ───────────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  try {
    const memory = getMemoryInfo();
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
    return res.status(200).json({ success: true, data: payload });
  } catch (err) {
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

// Error handlers (must be after routes)
app.use(notFoundHandler);
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});

export default app;
