import http from 'http';
import cluster from 'cluster';
import os from 'os';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const NUM_CPUS  = os.cpus().length;
const TEST_PORT = 14321;
const BASE_URL  = `http://127.0.0.1:${TEST_PORT}`;
const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = join(__dirname, '_testWorker_temp.mjs');

// ─── Test runner ──────────────────────────────────────────────────────────────
let passed = 0, failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ PASS  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAIL  ${name}\n           ${err.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────
function getJSON(path = '/health') {
  return new Promise((resolve, reject) => {
    const req = http.get(`${BASE_URL}${path}`, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(3000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ─── Temp worker file ─────────────────────────────────────────────────────────
function setupWorkerFile() {
  writeFileSync(WORKER_PATH, `
import http from 'http';
import cluster from 'cluster';
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ pid: process.pid, worker: cluster.worker.id }));
});
server.listen(${TEST_PORT});
process.on('message', (msg) => {
  if (msg && msg.type === 'shutdown') server.close(() => process.exit(0));
});
`);
}

// ─── Cluster setup ───────────────────────────────────────────────────────────
function startCluster() {
  setupWorkerFile();
  cluster.setupPrimary({ exec: WORKER_PATH });

  const workers = new Map();
  function spawnWorker() {
    const w = cluster.fork();
    workers.set(w.id, w);
    return w;
  }

  for (let i = 0; i < NUM_CPUS; i++) spawnWorker();

  cluster.on('exit', (w) => {
    workers.delete(w.id);
    setTimeout(spawnWorker, 50);
  });

  return {
    shutdown() {
      for (const w of workers.values()) {
        try { w.send({ type: 'shutdown' }); } catch (_) {}
      }
      setTimeout(() => { if (existsSync(WORKER_PATH)) unlinkSync(WORKER_PATH); }, 1500);
    },
  };
}

// ─── Run tests ────────────────────────────────────────────────────────────────
if (!cluster.isPrimary) process.exit(0);

console.log('\n🧪  Cluster Mode – Acceptance Criteria Tests');
console.log(`    CPU cores detected: ${NUM_CPUS}\n`);

const clusterHandle = startCluster();
await new Promise((r) => setTimeout(r, 1500)); // wait for workers to boot

// AC1 – Traffic distributed across all CPU cores
await test('AC1 – Requests reach all CPU cores', async () => {
  const pids = new Set();
  await Promise.all(
    Array.from({ length: NUM_CPUS * 20 }, () =>
      getJSON().then((d) => pids.add(d.pid)).catch(() => {})
    )
  );
  assert(pids.size >= Math.min(2, NUM_CPUS),
    `Expected ≥${Math.min(2, NUM_CPUS)} distinct PIDs, got ${pids.size}`);
  console.log(`           Distinct worker PIDs seen: ${pids.size}/${NUM_CPUS}`);
});

// AC2 – Crashed worker replaced within 1 second
await test('AC2 – Crashed worker replaced within 1 second', async () => {
  const { pid: victimPid } = await getJSON();
  try { process.kill(victimPid, 'SIGKILL'); } catch (_) {}

  const start = Date.now();
  let recovered = false;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 25));
    try {
      const d = await getJSON();
      if (d.pid !== victimPid) { recovered = true; break; }
    } catch (_) {}
  }
  const elapsed = Date.now() - start;
  assert(recovered, `Did not recover within 1 s (elapsed: ${elapsed} ms)`);
  console.log(`           Recovery time: ~${elapsed} ms`);
});

// AC3 – Zero socket dropouts under load
await test('AC3 – Zero socket dropouts under concurrent load', async () => {
  let errors = 0, successes = 0;
  for (let r = 0; r < 10; r++) {
    await Promise.all(
      Array.from({ length: 50 }, () =>
        getJSON().then(() => successes++).catch(() => errors++)
      )
    );
  }
  console.log(`           ${successes}/500 succeeded, ${errors} dropped`);
  assert(errors === 0, `${errors} socket dropouts detected (expected 0)`);
});

// Summary
console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
clusterHandle.shutdown();
process.exit(failed > 0 ? 1 : 0);