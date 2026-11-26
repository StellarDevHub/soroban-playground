/**
 * test-runner-parser.test.mjs
 *
 * Issue #2051 / FRONTEND-281 — Interactive Automated Test Runner
 *
 * Unit tests for parseCargoTestOutput and parseLcov.
 * Run with:
 *
 *   node website/playground/tests/test-runner-parser.test.mjs
 *
 * No framework, no network, no DOM required.
 */
import assert from 'node:assert/strict';
import { parseCargoTestOutput, parseLcov } from '../../../frontend/src/components/test-runner-parser.js';

/* ─────────────────────────────────────────────────────────────────────────────
   Helpers
───────────────────────────────────────────────────────────────────────────── */

/** Build a minimal cargo test JSON stream from an array of event objects. */
function stream(...events) {
  return events.map((e) => JSON.stringify(e)).join('\n');
}

/** Convenience shorthand for a fully-structured single-suite stream. */
function suiteStream({ suiteName, tests = [], passed = 0, failed = 0, ignored = 0, elapsed = 0 }) {
  const lines = [];
  lines.push(JSON.stringify({ type: 'suite', event: 'started', test_count: tests.length, name: suiteName }));
  for (const t of tests) {
    lines.push(JSON.stringify({ type: 'test', event: 'started', name: t.name }));
    lines.push(JSON.stringify({
      type: 'test',
      event: t.event || (t.status === 'passed' ? 'ok' : t.status === 'ignored' ? 'ignored' : 'failed'),
      name: t.name,
      exec_time: t.exec_time ?? 0.001,
      stdout: t.stdout ?? undefined,
    }));
  }
  lines.push(JSON.stringify({
    type: 'suite', event: failed > 0 ? 'failed' : 'ok',
    passed, failed, ignored, measured: 0, filtered_out: 0,
    exec_time: elapsed,
  }));
  return lines.join('\n');
}

/* ─────────────────────────────────────────────────────────────────────────────
   parseCargoTestOutput — guard conditions
───────────────────────────────────────────────────────────────────────────── */

{
  // Null / empty input returns empty array without throwing.
  assert.deepEqual(parseCargoTestOutput(null), [], 'null input → []');
  assert.deepEqual(parseCargoTestOutput(''), [], 'empty string → []');
  assert.deepEqual(parseCargoTestOutput('   \n  \n  '), [], 'whitespace-only → []');
  console.log('✓ guard: null/empty input returns []');
}

/* ─────────────────────────────────────────────────────────────────────────────
   parseCargoTestOutput — passing tests
───────────────────────────────────────────────────────────────────────────── */

{
  const raw = suiteStream({
    suiteName: 'my_contract::tests',
    tests: [
      { name: 'my_contract::tests::it_works', status: 'passed' },
      { name: 'my_contract::tests::check_balance', status: 'passed' },
    ],
    passed: 2, failed: 0, ignored: 0, elapsed: 0.015,
  });

  const suites = parseCargoTestOutput(raw);
  assert.equal(suites.length, 1, 'one suite produced');
  const suite = suites[0];
  assert.equal(suite.name, 'my_contract::tests', 'suite name preserved');
  assert.equal(suite.passed, 2, 'passed count');
  assert.equal(suite.failed, 0, 'failed count');
  assert.equal(suite.ignored, 0, 'ignored count');
  assert.equal(suite.tests.length, 2, 'two test cases');
  assert.equal(suite.tests[0].status, 'passed', 'first test passes');
  assert.equal(suite.tests[1].status, 'passed', 'second test passes');
  assert.equal(typeof suite.elapsed_ms, 'number', 'elapsed_ms is a number');
  assert.ok(suite.elapsed_ms > 0, 'elapsed_ms > 0');
  console.log('✓ parseCargoTestOutput: all-passing suite');
}

/* ─────────────────────────────────────────────────────────────────────────────
   parseCargoTestOutput — assertion failure
───────────────────────────────────────────────────────────────────────────── */

{
  const failOutput = 'thread \'main\' panicked at \'assertion failed: left == right\nleft: 1\nright: 2\', src/lib.rs:42';
  const raw = suiteStream({
    suiteName: 'my_crate',
    tests: [
      { name: 'my_crate::tests::assert_eq_fail', status: 'failed', stdout: failOutput },
    ],
    passed: 0, failed: 1, ignored: 0,
  });

  const suites = parseCargoTestOutput(raw);
  assert.equal(suites.length, 1);
  const t = suites[0].tests[0];
  assert.equal(t.status, 'panic', 'panicked output mapped to panic status');
  assert.ok(t.stdout && t.stdout.includes('assertion failed'), 'stdout captured');
  console.log('✓ parseCargoTestOutput: assertion failure → panic status');
}

/* ─────────────────────────────────────────────────────────────────────────────
   parseCargoTestOutput — plain failure (no panic keyword)
───────────────────────────────────────────────────────────────────────────── */

{
  const plainFail = 'FAILED: balance mismatch';
  const raw = suiteStream({
    suiteName: 'contract',
    tests: [
      { name: 'contract::tests::balance_check', status: 'failed', stdout: plainFail },
    ],
    passed: 0, failed: 1, ignored: 0,
  });

  const suites = parseCargoTestOutput(raw);
  const t = suites[0].tests[0];
  assert.equal(t.status, 'failed', 'non-panic failure keeps failed status');
  console.log('✓ parseCargoTestOutput: plain failure keeps "failed" status');
}

/* ─────────────────────────────────────────────────────────────────────────────
   parseCargoTestOutput — ignored tests
───────────────────────────────────────────────────────────────────────────── */

{
  const raw = suiteStream({
    suiteName: 'lib',
    tests: [
      { name: 'lib::tests::skip_me', status: 'ignored', event: 'ignored' },
    ],
    passed: 0, failed: 0, ignored: 1,
  });

  const suites = parseCargoTestOutput(raw);
  assert.equal(suites[0].ignored, 1);
  assert.equal(suites[0].tests[0].status, 'ignored');
  console.log('✓ parseCargoTestOutput: ignored tests');
}

/* ─────────────────────────────────────────────────────────────────────────────
   parseCargoTestOutput — mixed results
───────────────────────────────────────────────────────────────────────────── */

{
  const raw = suiteStream({
    suiteName: 'contract',
    tests: [
      { name: 'contract::tests::ok1', status: 'passed' },
      { name: 'contract::tests::fail1', status: 'failed', stdout: 'some error' },
      { name: 'contract::tests::ignored1', status: 'ignored', event: 'ignored' },
    ],
    passed: 1, failed: 1, ignored: 1,
  });

  const suites = parseCargoTestOutput(raw);
  const suite = suites[0];
  assert.equal(suite.tests.length, 3, 'three test cases');
  assert.equal(suite.tests.filter((t) => t.status === 'passed').length, 1);
  assert.equal(suite.tests.filter((t) => t.status === 'failed').length, 1);
  assert.equal(suite.tests.filter((t) => t.status === 'ignored').length, 1);
  console.log('✓ parseCargoTestOutput: mixed results');
}

/* ─────────────────────────────────────────────────────────────────────────────
   parseCargoTestOutput — non-JSON lines (compiler output) are skipped
───────────────────────────────────────────────────────────────────────────── */

{
  const raw = [
    'running 2 tests',              // non-JSON preamble
    JSON.stringify({ type: 'suite', event: 'started', test_count: 2, name: 'lib' }),
    '   Compiling contract v0.1.0', // non-JSON amid events
    JSON.stringify({ type: 'test', event: 'started', name: 'lib::a' }),
    JSON.stringify({ type: 'test', event: 'ok', name: 'lib::a', exec_time: 0 }),
    JSON.stringify({ type: 'test', event: 'started', name: 'lib::b' }),
    JSON.stringify({ type: 'test', event: 'ok', name: 'lib::b', exec_time: 0 }),
    JSON.stringify({ type: 'suite', event: 'ok', passed: 2, failed: 0, ignored: 0, measured: 0, filtered_out: 0, exec_time: 0 }),
  ].join('\n');

  const suites = parseCargoTestOutput(raw);
  assert.equal(suites.length, 1, 'one suite even with noise lines');
  assert.equal(suites[0].tests.length, 2, 'two tests parsed correctly');
  console.log('✓ parseCargoTestOutput: non-JSON noise lines are skipped');
}

/* ─────────────────────────────────────────────────────────────────────────────
   parseCargoTestOutput — multiple suites
───────────────────────────────────────────────────────────────────────────── */

{
  const suite1 = suiteStream({ suiteName: 'crate_a', tests: [{ name: 'crate_a::ok', status: 'passed' }], passed: 1 });
  const suite2 = suiteStream({ suiteName: 'crate_b', tests: [{ name: 'crate_b::ok', status: 'passed' }], passed: 1 });
  const raw = suite1 + '\n' + suite2;

  const suites = parseCargoTestOutput(raw);
  assert.equal(suites.length, 2, 'two suites produced');
  assert.equal(suites[0].name, 'crate_a');
  assert.equal(suites[1].name, 'crate_b');
  console.log('✓ parseCargoTestOutput: multiple suites');
}

/* ─────────────────────────────────────────────────────────────────────────────
   parseCargoTestOutput — line number extraction from test name
───────────────────────────────────────────────────────────────────────────── */

{
  const raw = suiteStream({
    suiteName: 'lib',
    tests: [
      { name: 'lib::tests::check_line_42', status: 'passed' },
      { name: 'lib::tests::plain_name', status: 'passed' },
    ],
    passed: 2,
  });

  const suites = parseCargoTestOutput(raw);
  const tests = suites[0].tests;
  // "check_line_42" contains "line_42" so extractLineNumber should return 42.
  assert.equal(tests[0].line, 42, 'line number extracted from test name');
  assert.equal(tests[1].line, null, 'no line number for plain name');
  console.log('✓ parseCargoTestOutput: line number extraction');
}

/* ─────────────────────────────────────────────────────────────────────────────
   parseCargoTestOutput — implicit suite (no suite-level events)
───────────────────────────────────────────────────────────────────────────── */

{
  // Some test harnesses emit only test-level events with no suite wrapper.
  const raw = [
    JSON.stringify({ type: 'test', event: 'started', name: 'alpha' }),
    JSON.stringify({ type: 'test', event: 'ok', name: 'alpha', exec_time: 0.001 }),
    JSON.stringify({ type: 'test', event: 'started', name: 'beta' }),
    JSON.stringify({ type: 'test', event: 'failed', name: 'beta', exec_time: 0.002, stdout: 'boom' }),
  ].join('\n');

  const suites = parseCargoTestOutput(raw);
  assert.equal(suites.length, 1, 'implicit suite created');
  assert.equal(suites[0].tests.length, 2);
  assert.equal(suites[0].passed, 1);
  assert.equal(suites[0].failed, 1);
  console.log('✓ parseCargoTestOutput: implicit suite (no suite wrapper events)');
}

/* ─────────────────────────────────────────────────────────────────────────────
   parseLcov — guard conditions
───────────────────────────────────────────────────────────────────────────── */

{
  const r = parseLcov(null);
  assert.equal(r.totalHit, 0);
  assert.equal(r.totalFound, 0);
  assert.deepEqual(r.files, []);
  console.log('✓ parseLcov: null input returns zero report');
}

/* ─────────────────────────────────────────────────────────────────────────────
   parseLcov — single file, all hit
───────────────────────────────────────────────────────────────────────────── */

{
  const lcov = [
    'TN:',
    'SF:src/lib.rs',
    'DA:1,1',
    'DA:2,3',
    'DA:5,0',
    'LH:2',
    'LF:3',
    'end_of_record',
  ].join('\n');

  const report = parseLcov(lcov);
  assert.equal(report.files.length, 1, 'one file parsed');
  const f = report.files[0];
  assert.equal(f.name, 'src/lib.rs');
  assert.equal(f.found, 3, 'three DA lines counted');
  assert.equal(f.hit, 2, 'two lines with hits > 0');
  assert.equal(report.totalFound, 3);
  assert.equal(report.totalHit, 2);
  assert.equal(f.lines[0].line, 1);
  assert.equal(f.lines[0].hits, 1);
  assert.equal(f.lines[2].line, 5);
  assert.equal(f.lines[2].hits, 0);
  console.log('✓ parseLcov: single file coverage');
}

/* ─────────────────────────────────────────────────────────────────────────────
   parseLcov — multiple files
───────────────────────────────────────────────────────────────────────────── */

{
  const lcov = [
    'SF:src/a.rs',
    'DA:10,5',
    'DA:11,0',
    'end_of_record',
    'SF:src/b.rs',
    'DA:1,2',
    'DA:2,2',
    'DA:3,2',
    'end_of_record',
  ].join('\n');

  const report = parseLcov(lcov);
  assert.equal(report.files.length, 2);
  assert.equal(report.files[0].name, 'src/a.rs');
  assert.equal(report.files[0].hit, 1);
  assert.equal(report.files[0].found, 2);
  assert.equal(report.files[1].name, 'src/b.rs');
  assert.equal(report.files[1].hit, 3);
  assert.equal(report.files[1].found, 3);
  assert.equal(report.totalHit, 4);
  assert.equal(report.totalFound, 5);
  console.log('✓ parseLcov: multiple files, totals summed correctly');
}

/* ─────────────────────────────────────────────────────────────────────────────
   parseLcov — zero coverage (all misses)
───────────────────────────────────────────────────────────────────────────── */

{
  const lcov = [
    'SF:src/zero.rs',
    'DA:1,0',
    'DA:2,0',
    'DA:3,0',
    'end_of_record',
  ].join('\n');

  const report = parseLcov(lcov);
  assert.equal(report.totalHit, 0);
  assert.equal(report.totalFound, 3);
  assert.ok(report.files[0].lines.every((l) => l.hits === 0));
  console.log('✓ parseLcov: zero coverage (all misses)');
}

/* ─────────────────────────────────────────────────────────────────────────────
   parseLcov — malformed DA lines are skipped gracefully
───────────────────────────────────────────────────────────────────────────── */

{
  const lcov = [
    'SF:src/x.rs',
    'DA:garbage,notanumber',
    'DA:,',
    'DA:5,2',
    'end_of_record',
  ].join('\n');

  const report = parseLcov(lcov);
  assert.equal(report.files[0].found, 1, 'only valid DA line counted');
  assert.equal(report.files[0].lines.length, 1);
  assert.equal(report.files[0].lines[0].line, 5);
  console.log('✓ parseLcov: malformed DA lines skipped gracefully');
}

/* ─────────────────────────────────────────────────────────────────────────────
   parseLcov — empty file (no DA lines)
───────────────────────────────────────────────────────────────────────────── */

{
  const lcov = ['SF:src/empty.rs', 'end_of_record'].join('\n');
  const report = parseLcov(lcov);
  assert.equal(report.files.length, 1);
  assert.equal(report.files[0].found, 0);
  assert.equal(report.files[0].hit, 0);
  assert.deepEqual(report.files[0].lines, []);
  console.log('✓ parseLcov: file with no DA lines');
}

/* ─────────────────────────────────────────────────────────────────────────────
   parseLcov — missing end_of_record (forgiving parse)
───────────────────────────────────────────────────────────────────────────── */

{
  const lcov = ['SF:src/no_end.rs', 'DA:1,1', 'DA:2,0'].join('\n');
  const report = parseLcov(lcov);
  assert.equal(report.files.length, 1, 'file still captured without end_of_record');
  assert.equal(report.files[0].found, 2);
  console.log('✓ parseLcov: missing end_of_record handled gracefully');
}

/* ─────────────────────────────────────────────────────────────────────────────
   Summary
───────────────────────────────────────────────────────────────────────────── */

console.log('\ntest-runner-parser tests: OK');
