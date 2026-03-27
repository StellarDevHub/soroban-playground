import express from "express";
import cors from "cors";
import os from "os";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import compileRoute from "./routes/compile.js";
import deployRoute from "./routes/deploy.js";
import invokeRoute from "./routes/invoke.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

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

app.use(cors());
app.use(express.json());

app.use("/api/compile", compileRoute);
app.use("/api/deploy", deployRoute);
app.use("/api/invoke", invokeRoute);

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
  return { totalMB: toMB(totalBytes), freeMB: toMB(freeBytes), usedMB: toMB(usedBytes), usedPercent: +((usedBytes / totalBytes) * 100).toFixed(1) };
}

function getUptimeInfo() {
  const fmt = (s) => [Math.floor(s / 86400) && `${Math.floor(s / 86400)}d`, Math.floor((s % 86400) / 3600) && `${Math.floor((s % 86400) / 3600)}h`, Math.floor((s % 3600) / 60) && `${Math.floor((s % 3600) / 60)}m`, `${Math.floor(s % 60)}s`].filter(Boolean).join(" ");
  return { processSec: Math.floor(process.uptime()), processHuman: fmt(process.uptime()), systemSec: Math.floor(os.uptime()), systemHuman: fmt(os.uptime()) };
}

function getRuntimeInfo() {
  return { node: process.version, platform: process.platform, arch: process.arch, pid: process.pid };
}

app.get("/api/health", (_req, res) => {
  try {
    const memory = getMemoryInfo();
    const status = memory.usedPercent > 95 ? "degraded" : "ok";
    return res.status(200).json({
      success: true,
      data: { status, version: packageJson.version ?? "unknown", service: packageJson.name ?? "soroban-playground-backend", timestamp: new Date().toISOString(), uptime: getUptimeInfo(), cpu: getCpuUsage(), memory, runtime: getRuntimeInfo() },
    });
  } catch (err) {
    return res.status(500).json({ success: false, data: { status: "error", version: packageJson.version ?? "unknown", timestamp: new Date().toISOString(), error: err.message } });
  }
});

app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});

export default app;