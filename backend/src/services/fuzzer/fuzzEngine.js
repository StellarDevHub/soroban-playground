import { spawn } from 'node:child_process';
import { mkdir, readdir, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Runner: (cmd, args, timeoutMs) => Promise<{ code, stdout, stderr }>
 * Injectable so tests don't need Docker.
 */
export const defaultRunner = (cmd, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const t = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    p.on('error', (e) => {
      clearTimeout(t);
      reject(e);
    });
    p.on('close', (code) => {
      clearTimeout(t);
      resolve({ code, stdout, stderr });
    });
  });

export function classifyCrash(log) {
  if (
    /AddressSanitizer|MemorySanitizer|heap-buffer-overflow|use-after-free|SEGV/i.test(
      log
    )
  )
    return 'memory-corruption';
  if (
    /attempt to (add|subtract|multiply) with overflow|arithmetic overflow/i.test(
      log
    )
  )
    return 'overflow';
  if (/out-of-memory|rss limit/i.test(log)) return 'oom';
  if (/timeout|ALARM: working on the last Unit/i.test(log)) return 'timeout';
  if (/panicked at|deadly signal/i.test(log)) return 'panic';
  return 'unknown';
}

export function parseExecsPerSec(log) {
  // libFuzzer: "#12345 NEW cov: 10 ft: 20 corp: 5/100b exec/s: 25000 rss: 40Mb"
  const matches = [...log.matchAll(/exec\/s:\s*(\d+)/g)].map((m) =>
    Number(m[1])
  );
  return matches.length ? Math.max(...matches) : 0;
}

export class FuzzEngine {
  constructor(runner = defaultRunner) {
    this.runner = runner;
  }

  dockerArgs(o, inner) {
    const w = o.workers ?? 2;
    const work = path.resolve(o.workDir);
    return [
      'run',
      '--rm',
      '--network',
      'none',
      '--memory',
      `${o.memoryLimitMb}m`,
      '--memory-swap',
      `${o.memoryLimitMb}m`,
      '--cpus',
      String(w),
      '--pids-limit',
      '512',
      '--read-only',
      '--tmpfs',
      '/tmp:rw,size=512m',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '-v',
      `${path.resolve(o.contractDir)}:/src:rw`,
      '-v',
      `${work}/corpus:/corpus:rw`,
      '-v',
      `${work}/artifacts:/artifacts:rw`,
      '-v',
      `${work}/coverage:/coverage:rw`,
      '-w',
      '/src',
      o.image,
      ...inner,
    ];
  }

  async runCampaign(opts) {
    const o = {
      workers: 2,
      durationSec: 60,
      sanitizer: 'address',
      memoryLimitMb: 2048,
      rssLimitMb: 1536,
      timeoutSec: 5,
      image: 'soroban-fuzz:latest',
      ...opts,
    };
    for (const d of ['corpus', 'artifacts', 'coverage', 'repro']) {
      await mkdir(path.join(o.workDir, d), { recursive: true });
    }

    // Instrumented build + parallel run; -fork=N workers share one corpus dir
    const run = await this.runner(
      'docker',
      this.dockerArgs(o, [
        'cargo',
        'fuzz',
        'run',
        o.target,
        `--sanitizer=${o.sanitizer}`,
        '--',
        '/corpus',
        `-fork=${o.workers}`,
        `-max_total_time=${o.durationSec}`,
        `-rss_limit_mb=${o.rssLimitMb}`,
        `-timeout=${o.timeoutSec}`,
        '-artifact_prefix=/artifacts/',
        '-ignore_crashes=1',
      ]),
      (o.durationSec + 600) * 1000
    );
    const log = `${run.stdout}\n${run.stderr}`;

    // Collect crashes, minimize, emit standalone repro
    const crashes = [];
    const files = (await readdir(path.join(o.workDir, 'artifacts'))).filter(
      (f) => /^(crash|oom|timeout|leak)-/.test(f)
    );
    for (const f of files) {
      const artifactPath = path.join(o.workDir, 'artifacts', f);
      const kind = f.startsWith('oom-')
        ? 'oom'
        : f.startsWith('timeout-')
          ? 'timeout'
          : classifyCrash(log);
      const report = { kind, artifactPath };
      const minName = `min-${f}`;
      const tmin = await this.runner(
        'docker',
        this.dockerArgs(o, [
          'cargo',
          'fuzz',
          'tmin',
          o.target,
          `/artifacts/${f}`,
          `--sanitizer=${o.sanitizer}`,
          '--',
          '-runs=10000',
          `-exact_artifact_path=/artifacts/${minName}`,
        ]),
        10 * 60 * 1000
      );
      if (tmin.code === 0 || tmin.code === 77) {
        report.minimizedPath = path.join(o.workDir, 'artifacts', minName);
      }
      report.reproPath = await this.writeRepro(
        o.workDir,
        o.target,
        f,
        report.minimizedPath ?? artifactPath
      );
      crashes.push(report);
    }

    const coverageReport = await this.generateCoverage(o);
    const corpusSize = (await readdir(path.join(o.workDir, 'corpus'))).length;
    const eps = parseExecsPerSec(log);
    return {
      execsPerSecPerWorker: eps / o.workers,
      totalExecs: eps * o.durationSec,
      crashes,
      coverageReport,
      corpusSize,
    };
  }

  async writeRepro(workDir, target, name, inputPath) {
    const dest = path.join(workDir, 'repro', `${name}.bin`);
    await copyFile(inputPath, dest);
    await writeFile(
      path.join(workDir, 'repro', `${name}.sh`),
      `#!/bin/sh\n# Reproduce: cargo fuzz run ${target} repro/${name}.bin\ncargo fuzz run ${target} "$(dirname "$0")/${name}.bin"\n`,
      { mode: 0o755 }
    );
    return dest;
  }

  async generateCoverage(o) {
    const cov = await this.runner(
      'docker',
      this.dockerArgs(o, [
        'sh',
        '-c',
        `cargo fuzz coverage ${o.target} /corpus && ` +
          `BIN=$(find target -path '*coverage*' -type f -name ${o.target} | head -1) && ` +
          `PROF=$(find . -name coverage.profdata | head -1) && ` +
          `llvm-cov show "$BIN" -instr-profile="$PROF" -format=html -output-dir=/coverage`,
      ]),
      15 * 60 * 1000
    );
    return cov.code === 0
      ? path.join(o.workDir, 'coverage', 'index.html')
      : undefined;
  }
}

export default FuzzEngine;
