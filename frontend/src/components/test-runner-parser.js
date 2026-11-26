/**
 * test-runner-parser.js
 *
 * Issue #2051 / FRONTEND-281
 *
 * Pure parsing utilities (no DOM, no side effects) for:
 *
 *   parseCargoTestOutput(raw)
 *     Converts a `cargo test -- --format json` stdout stream into an array of
 *     structured TestSuite objects.
 *
 *   parseLcov(text)
 *     Converts an lcov.info (or `llvm-cov export --format=lcov`) file into a
 *     CoverageReport object.
 *
 * Both functions are intentionally stateless and return plain JS objects so
 * they are trivially testable without a DOM or build toolchain.
 *
 * ─── Cargo test JSON stream ────────────────────────────────────────────────
 *
 * cargo test emits one JSON object per line in three event types:
 *
 *   { type: "suite", event: "started", test_count: N }
 *   { type: "test",  event: "started", name: "..." }
 *   { type: "test",  event: "ok"|"failed"|"ignored", name: "...", exec_time: N, stdout: "..." }
 *   { type: "suite", event: "ok"|"failed", passed: N, failed: N, ignored: N, measured: N, filtered_out: N, exec_time: N }
 *
 * Lines that do not parse as valid JSON (e.g. `running N tests`, linker output)
 * are silently skipped.
 *
 * ─── lcov format ──────────────────────────────────────────────────────────
 *
 * We parse only the subset needed for line-level coverage:
 *
 *   SF:<filename>
 *   DA:<line>,<hits>
 *   end_of_record
 *
 * ─── Return types ─────────────────────────────────────────────────────────
 *
 * TestSuite {
 *   name:        string | null
 *   passed:      number
 *   failed:      number
 *   ignored:     number
 *   elapsed_ms:  number | null    (exec_time * 1000)
 *   tests:       TestCase[]
 * }
 *
 * TestCase {
 *   name:        string
 *   status:      'passed' | 'failed' | 'ignored' | 'panic'
 *   elapsed_ms:  number | null
 *   stdout:      string | null    (failure / panic output captured by cargo)
 *   line:        number | null    (best-effort: extracted from module::file::line_NNN naming)
 * }
 *
 * CoverageReport {
 *   totalHit:    number
 *   totalFound:  number
 *   files: FileCoverage[]
 * }
 *
 * FileCoverage {
 *   name:   string
 *   hit:    number
 *   found:  number
 *   lines:  LineCoverage[]
 * }
 *
 * LineCoverage {
 *   line:  number
 *   hits:  number
 * }
 */
'use strict';

/* ─────────────────────────────────────────────────────────────────────────────
   parseCargoTestOutput
───────────────────────────────────────────────────────────────────────────── */

/**
 * Parse a `cargo test -- --format json` stdout stream.
 *
 * @param {string} raw
 * @returns {TestSuite[]}
 */
export function parseCargoTestOutput(raw) {
  if (!raw || typeof raw !== 'string') return [];

  const lines = raw.split(/\r?\n/);
  const suites = [];

  let currentSuite = null;
  // Accumulate per-test-name state across started/ok/failed events.
  const inFlight = new Map();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch (_) {
      // Non-JSON lines (compiler notes, "running N tests", etc.) are skipped.
      continue;
    }

    if (!msg || typeof msg !== 'object') continue;

    if (msg.type === 'suite') {
      if (msg.event === 'started') {
        // Open a fresh suite slot.
        currentSuite = {
          name: msg.name || null,
          passed: 0,
          failed: 0,
          ignored: 0,
          elapsed_ms: null,
          tests: [],
        };
        inFlight.clear();
      } else if (msg.event === 'ok' || msg.event === 'failed') {
        if (currentSuite) {
          currentSuite.passed = msg.passed || 0;
          currentSuite.failed = msg.failed || 0;
          currentSuite.ignored = msg.ignored || 0;
          currentSuite.elapsed_ms = msg.exec_time != null
            ? Math.round(msg.exec_time * 1000)
            : null;
          suites.push(currentSuite);
          currentSuite = null;
        }
      }
      continue;
    }

    if (msg.type === 'test') {
      if (msg.event === 'started') {
        inFlight.set(msg.name, { name: msg.name });
        continue;
      }

      if (msg.event === 'ok' || msg.event === 'failed' || msg.event === 'ignored') {
        const testCase = buildTestCase(msg);
        // Attach to current open suite, or start an implicit one.
        if (!currentSuite) {
          currentSuite = { name: null, passed: 0, failed: 0, ignored: 0, elapsed_ms: null, tests: [] };
        }
        currentSuite.tests.push(testCase);
        inFlight.delete(msg.name);
        continue;
      }
    }
  }

  // Close an implicitly opened suite that never received a suite-level result.
  if (currentSuite && currentSuite.tests.length) {
    // Recount from tests (suite-level totals never arrived).
    for (const t of currentSuite.tests) {
      if (t.status === 'passed') currentSuite.passed++;
      else if (t.status === 'failed' || t.status === 'panic') currentSuite.failed++;
      else if (t.status === 'ignored') currentSuite.ignored++;
    }
    suites.push(currentSuite);
  }

  return suites;
}

/* ─────────────────────────────────────────────────────────────────────────────
   parseLcov
───────────────────────────────────────────────────────────────────────────── */

/**
 * Parse an lcov.info or llvm-cov lcov export into a CoverageReport.
 *
 * @param {string} text
 * @returns {CoverageReport}
 */
export function parseLcov(text) {
  if (!text || typeof text !== 'string') {
    return { totalHit: 0, totalFound: 0, files: [] };
  }

  const files = [];
  let currentFile = null;
  let totalHit = 0;
  let totalFound = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('SF:')) {
      currentFile = {
        name: line.slice(3),
        hit: 0,
        found: 0,
        lines: [],
      };
      continue;
    }

    if (line === 'end_of_record') {
      if (currentFile) {
        files.push(currentFile);
        totalHit += currentFile.hit;
        totalFound += currentFile.found;
      }
      currentFile = null;
      continue;
    }

    if (line.startsWith('DA:') && currentFile) {
      // DA:<line_number>,<hit_count>[,<branch_data>]
      const parts = line.slice(3).split(',');
      const lineNum = parseInt(parts[0], 10);
      const hits = parseInt(parts[1], 10);
      if (!isNaN(lineNum) && !isNaN(hits)) {
        currentFile.lines.push({ line: lineNum, hits });
        currentFile.found++;
        if (hits > 0) currentFile.hit++;
      }
      continue;
    }

    // LH: / LF: summary lines — use as cross-check but don't override DA tallies.
    if (line.startsWith('LH:') && currentFile) {
      // We tally from DA lines; ignore redundant LH.
      continue;
    }
    if (line.startsWith('LF:') && currentFile) {
      // Same; ignore.
      continue;
    }
  }

  // Handle a file without a trailing end_of_record (malformed but forgiving).
  if (currentFile) {
    files.push(currentFile);
    totalHit += currentFile.hit;
    totalFound += currentFile.found;
  }

  return { totalHit, totalFound, files };
}

/* ─────────────────────────────────────────────────────────────────────────────
   Internal helpers
───────────────────────────────────────────────────────────────────────────── */

/**
 * Build a TestCase from a cargo test JSON "ok" / "failed" / "ignored" message.
 *
 * @param {object} msg
 * @returns {TestCase}
 */
function buildTestCase(msg) {
  const stdout = msg.stdout ? msg.stdout.trim() : null;
  let status;

  if (msg.event === 'ok') {
    status = 'passed';
  } else if (msg.event === 'ignored') {
    status = 'ignored';
  } else {
    // 'failed': distinguish assertion failures from panics based on output.
    status = stdout && isPanic(stdout) ? 'panic' : 'failed';
  }

  return {
    name: msg.name || '',
    status,
    elapsed_ms: msg.exec_time != null ? Math.round(msg.exec_time * 1000) : null,
    stdout: stdout || null,
    line: extractLineNumber(msg.name),
  };
}

/**
 * Determine whether captured test output indicates an unwind/panic rather than
 * a plain assertion failure.
 *
 * @param {string} output
 * @returns {boolean}
 */
function isPanic(output) {
  return (
    output.includes('panicked at') ||
    output.includes('thread') && output.includes("'") && output.includes('FAILED')
  );
}

/**
 * Best-effort extraction of a source line number from a test name.
 *
 * cargo test names follow `module::path::test_name`.  Some frameworks embed
 * a line reference in the form `line_NNN`, `::NNN`, or simply as the last
 * numeric segment of the path.
 *
 * @param {string} name
 * @returns {number|null}
 */
function extractLineNumber(name) {
  if (!name) return null;

  // Explicit "line_NNN" or "line:NNN" suffix.
  const explicit = name.match(/[_:]line[_:]?(\d+)/i);
  if (explicit) return parseInt(explicit[1], 10);

  // Last segment is a bare integer (some proc-macro test generators emit this).
  const trailing = name.match(/::(\d+)$/);
  if (trailing) return parseInt(trailing[1], 10);

  return null;
}
