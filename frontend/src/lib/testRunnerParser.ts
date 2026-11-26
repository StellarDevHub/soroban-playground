/**
 * Soroban Playground — Interactive Test Runner Parser & Monaco Decoration Mapper
 *
 * Implements structured parsing of `cargo test` JSON message streams,
 * panic and assertion failure extraction, LCOV and LLVM-cov code coverage parsing,
 * and mapping to Monaco Editor inline gutter badges and line coverage highlights.
 *
 * @module lib/testRunnerParser
 */

export type TestStatus = "passed" | "failed" | "ignored" | "running";

export interface PanicDetails {
  file?: string;
  line?: number;
  column?: number;
  message: string;
  assertionType?: "assert_eq" | "assert_ne" | "assert" | "custom" | "panic";
  left?: string;
  right?: string;
  backtrace?: string[];
  rawPanic?: string;
}

export interface TestCase {
  id: string;
  name: string;
  fullName: string;
  suiteName: string;
  status: TestStatus;
  durationMs: number | null;
  execTimeSec: number | null;
  stdout: string | null;
  panic?: PanicDetails;
  message?: string;
  location?: {
    file: string;
    line: number;
    column?: number;
  };
}

export interface TestSuite {
  id: string;
  name: string;
  status: "passed" | "failed" | "running";
  tests: TestCase[];
  passedCount: number;
  failedCount: number;
  ignoredCount: number;
  totalCount: number;
  durationMs: number;
}

export interface TestRunResult {
  suites: TestSuite[];
  totalTests: number;
  passedCount: number;
  failedCount: number;
  ignoredCount: number;
  passRate: number; // percentage 0 - 100
  totalDurationMs: number;
  hasFailures: boolean;
  timestamp: string;
}

export interface LineCoverage {
  lineNumber: number;
  executionCount: number;
  isHit: boolean;
}

export interface FileCoverage {
  filename: string;
  lines: Map<number, number>; // line -> execution count
  linesFound: number;
  linesHit: number;
  coveragePercentage: number;
  coveredLines: number[];
  uncoveredLines: number[];
}

export interface CoverageReport {
  files: Map<string, FileCoverage>;
  totalLinesFound: number;
  totalLinesHit: number;
  overallCoveragePercentage: number;
  branchesFound?: number;
  branchesHit?: number;
  functionsFound?: number;
  functionsHit?: number;
}

export interface MonacoGutterDecoration {
  range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  };
  options: {
    isWholeLine?: boolean;
    glyphMarginClassName?: string;
    glyphMarginHoverMessage?: { value: string };
    linesDecorationsClassName?: string;
    className?: string;
    overviewRuler?: {
      color: string;
      position: number;
    };
    minimap?: {
      color: string;
      position: number;
    };
  };
  type: "test-pass" | "test-fail" | "test-ignored" | "coverage-hit" | "coverage-miss";
  testName?: string;
  lineNumber: number;
}

/**
 * Extracts structured panic and assertion failure information from test stdout / stderr.
 */
export function parsePanicDetails(stdout: string): PanicDetails | undefined {
  if (!stdout || typeof stdout !== "string") return undefined;

  const rawPanic = stdout.trim();

  // Pattern 1: thread '...' panicked at src/lib.rs:42:9:
  // Pattern 2: panicked at 'assertion failed: ...', src/lib.rs:42:9
  // Pattern 3: thread '...' panicked at '...', contracts/hello/src/lib.rs:18:5
  const locationRegex =
    /(?:thread\s+'[^']+'\s+)?panicked\s+at\s+(?:'[^']*',\s+)?([a-zA-Z0-9_\-\./\\]+\.rs):(\d+)(?::(\d+))?/i;
  const locationMatch = rawPanic.match(locationRegex);

  let file: string | undefined;
  let line: number | undefined;
  let column: number | undefined;

  if (locationMatch) {
    file = locationMatch[1].replace(/\\/g, "/");
    line = parseInt(locationMatch[2], 10);
    if (locationMatch[3]) {
      column = parseInt(locationMatch[3], 10);
    }
  }

  // Parse assertion diff: left == right or left != right
  let assertionType: PanicDetails["assertionType"] = undefined;
  let left: string | undefined;
  let right: string | undefined;
  let message = "";

  const assertEqRegex = /assertion\s+(?:`left\s*==\s*right`|left\s*==\s*right)\s+failed/i;
  const assertNeRegex = /assertion\s+(?:`left\s*!=\s*right`|left\s*!=\s*right)\s+failed/i;
  const generalAssertRegex = /assertion\s+failed:\s*(.+?)(?:\n|$)/i;

  if (assertEqRegex.test(rawPanic)) {
    assertionType = "assert_eq";
  } else if (assertNeRegex.test(rawPanic)) {
    assertionType = "assert_ne";
  } else if (generalAssertRegex.test(rawPanic)) {
    assertionType = "assert";
    const m = rawPanic.match(generalAssertRegex);
    if (m) message = m[1].trim();
  }

  // Extract `left: ...` and `right: ...`
  const leftMatch = rawPanic.match(/(?:^|\n)\s*left:\s*`?([^`,\r\n]+)`?/);
  const rightMatch = rawPanic.match(/(?:^|\n)\s*right:\s*`?([^`',\r\n]+)`?/);

  if (leftMatch) {
    left = leftMatch[1].trim();
  }
  if (rightMatch) {
    right = rightMatch[1].trim();
  }

  if (left && right && !message) {
    message = `assertion failed: left (${left}) != right (${right})`;
  }

  // Check for unwrap on Err or custom panic message
  if (!message) {
    const unwrapMatch = rawPanic.match(/called `Result::unwrap\(\)` on an `Err` value:\s*([^\n]+)/i);
    if (unwrapMatch) {
      assertionType = "panic";
      message = `Result::unwrap() failed: ${unwrapMatch[1].trim()}`;
    } else {
      const panicMsgMatch = rawPanic.match(
        /panicked at (?:[^\n:]+:\d+:\d+:\s*|\s*')([^\n']+)/i,
      );
      if (panicMsgMatch) {
        assertionType = "panic";
        message = panicMsgMatch[1].trim();
      } else {
        assertionType = "panic";
        // Fallback to first non-empty line
        const lines = rawPanic.split("\n").map((l) => l.trim()).filter(Boolean);
        message = lines.find((l) => l.includes("panicked")) || lines[0] || "Test execution panicked";
      }
    }
  }

  // Extract stack backtrace if present
  let backtrace: string[] | undefined;
  const backtraceIndex = rawPanic.indexOf("stack backtrace:");
  if (backtraceIndex !== -1) {
    const btContent = rawPanic.slice(backtraceIndex);
    backtrace = btContent
      .split("\n")
      .slice(1)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("note:"));
  }

  return {
    file,
    line,
    column,
    message,
    assertionType: assertionType || "panic",
    left,
    right,
    backtrace,
    rawPanic,
  };
}

/**
 * Scans Rust source code to map test function names and module hierarchy to line numbers.
 */
export function extractTestLocationsFromRustCode(sourceCode: string): Map<string, number> {
  const map = new Map<string, number>();
  if (!sourceCode || typeof sourceCode !== "string") return map;

  const lines = sourceCode.split(/\r?\n/);
  const moduleStack: string[] = [];
  let nextFnIsTest = false;

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // Track module declarations
    const modMatch = trimmed.match(/^(?:pub\s+)?mod\s+([a-zA-Z0-9_]+)\s*\{/);
    if (modMatch) {
      moduleStack.push(modMatch[1]);
      continue;
    }

    if (trimmed.includes("}") && !trimmed.includes("{")) {
      if (moduleStack.length > 0 && trimmed === "}") {
        moduleStack.pop();
      }
    }

    // Detect #[test] attribute
    if (trimmed.startsWith("#[test]") || trimmed.startsWith("#[tokio::test]")) {
      nextFnIsTest = true;
      continue;
    }

    // Detect test function declaration
    const fnMatch = trimmed.match(/^(?:pub(?:\([^)]+\))?\s+)?(?:async\s+)?fn\s+([a-zA-Z0-9_]+)\s*\(/);
    if (fnMatch) {
      const fnName = fnMatch[1];
      const isTestName = nextFnIsTest || fnName.startsWith("test_");

      if (isTestName) {
        // Map bare name
        map.set(fnName, lineNumber);

        // Map fully qualified name if inside a module (e.g. tests::test_add)
        if (moduleStack.length > 0) {
          const qualified = [...moduleStack, fnName].join("::");
          map.set(qualified, lineNumber);
        }
      }
      nextFnIsTest = false;
    }
  }

  return map;
}

/**
 * Parses cargo test streams (JSON events or human-readable fallback) into structured test suites.
 */
export function parseCargoTestStream(
  rawInput: string | string[],
  sourceCode?: string,
): TestRunResult {
  const lines = Array.isArray(rawInput)
    ? rawInput
    : rawInput.split(/\r?\n/);

  const testMap = new Map<string, TestCase>();
  const testLocations = sourceCode ? extractTestLocationsFromRustCode(sourceCode) : new Map<string, number>();

  let isJsonStream = false;
  let totalExecTimeFromSuite = 0;

  // Track raw terminal stdout sections for standard cargo test output
  let inFailuresSection = false;
  let currentFailureName: string | null = null;
  const failureOutputs = new Map<string, string[]>();

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // Check if line is a Cargo test JSON event
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const event = JSON.parse(trimmed);

        if (event.type === "test") {
          isJsonStream = true;
          const fullName: string = event.name || "unknown_test";
          const parts = fullName.split("::");
          const name = parts[parts.length - 1];
          const suiteName = parts.length > 1 ? parts.slice(0, -1).join("::") : "tests";

          let status: TestStatus = "running";
          if (event.event === "ok") status = "passed";
          else if (event.event === "failed") status = "failed";
          else if (event.event === "ignored") status = "ignored";
          else if (event.event === "started") status = "running";

          const durationMs =
            typeof event.exec_time === "number"
              ? Math.round(event.exec_time * 1000 * 100) / 100
              : null;

          const stdout: string | null = event.stdout ?? null;
          const panic = stdout ? parsePanicDetails(stdout) : undefined;

          // Determine line location
          let lineLocation: number | undefined;
          let fileLocation = "src/lib.rs";

          if (panic?.line) {
            lineLocation = panic.line;
            if (panic.file) fileLocation = panic.file;
          } else if (testLocations.has(fullName)) {
            lineLocation = testLocations.get(fullName);
          } else if (testLocations.has(name)) {
            lineLocation = testLocations.get(name);
          }

          const testCase: TestCase = {
            id: fullName,
            name,
            fullName,
            suiteName,
            status,
            durationMs,
            execTimeSec: event.exec_time ?? null,
            stdout,
            panic,
            message: panic?.message || (status === "passed" ? "Test passed" : undefined),
            location: lineLocation
              ? {
                  file: fileLocation,
                  line: lineLocation,
                  column: panic?.column,
                }
              : undefined,
          };

          testMap.set(fullName, testCase);
          continue;
        } else if (event.type === "suite") {
          isJsonStream = true;
          if (typeof event.exec_time === "number") {
            totalExecTimeFromSuite = Math.round(event.exec_time * 1000 * 100) / 100;
          }
          continue;
        }
      } catch {
        // Fall through to plain text parsing
      }
    }

    // Plain text / standard cargo test output parsing
    if (!isJsonStream) {
      // 1. Section: failures stdout
      if (trimmed === "failures:") {
        inFailuresSection = true;
        currentFailureName = null;
        continue;
      }

      const failureHeaderMatch = trimmed.match(/^----\s+([a-zA-Z0-9_:]+)\s+stdout\s+----$/);
      if (failureHeaderMatch) {
        currentFailureName = failureHeaderMatch[1];
        failureOutputs.set(currentFailureName, []);
        continue;
      }

      if (inFailuresSection && currentFailureName) {
        if (trimmed.startsWith("test result:")) {
          inFailuresSection = false;
          currentFailureName = null;
        } else {
          failureOutputs.get(currentFailureName)?.push(rawLine);
          continue;
        }
      }

      // 2. Individual test result line: `test tests::test_add ... ok`
      const testResultMatch = trimmed.match(/^test\s+([a-zA-Z0-9_:]+)\s+\.\.\.\s+(ok|FAILED|ignored)(?:\s+\(([\d\.]+)s\))?/);
      if (testResultMatch) {
        const fullName = testResultMatch[1];
        const rawStatus = testResultMatch[2];
        const timeSec = testResultMatch[3] ? parseFloat(testResultMatch[3]) : null;

        const parts = fullName.split("::");
        const name = parts[parts.length - 1];
        const suiteName = parts.length > 1 ? parts.slice(0, -1).join("::") : "tests";

        let status: TestStatus = "passed";
        if (rawStatus === "FAILED") status = "failed";
        else if (rawStatus === "ignored") status = "ignored";

        const durationMs = timeSec != null ? Math.round(timeSec * 1000 * 100) / 100 : null;

        const lineLocation = testLocations.get(fullName) || testLocations.get(name);

        testMap.set(fullName, {
          id: fullName,
          name,
          fullName,
          suiteName,
          status,
          durationMs,
          execTimeSec: timeSec,
          stdout: null,
          location: lineLocation
            ? {
                file: "src/lib.rs",
                line: lineLocation,
              }
            : undefined,
        });
        continue;
      }

      // 3. Overall test result line: `test result: FAILED. 1 passed; 1 failed; 0 ignored; ... finished in 0.05s`
      const summaryMatch = trimmed.match(/test result:\s+(ok|FAILED)\.\s+(\d+)\s+passed;\s+(\d+)\s+failed;\s+(\d+)\s+ignored;.*?finished in\s+([\d\.]+)s/);
      if (summaryMatch) {
        totalExecTimeFromSuite = Math.round(parseFloat(summaryMatch[5]) * 1000 * 100) / 100;
      }
    }
  }

  // Attach failure stdouts from plain-text parsing
  if (!isJsonStream && failureOutputs.size > 0) {
    for (const [fullName, outputLines] of failureOutputs.entries()) {
      const fullStdout = outputLines.join("\n");
      const panic = parsePanicDetails(fullStdout);
      const existing = testMap.get(fullName);

      if (existing) {
        existing.stdout = fullStdout;
        existing.panic = panic;
        existing.message = panic?.message || "Assertion failed";

        if (panic?.line) {
          existing.location = {
            file: panic.file || "src/lib.rs",
            line: panic.line,
            column: panic.column,
          };
        }
      }
    }
  }

  // Group tests into suites
  const suitesMap = new Map<string, TestCase[]>();
  for (const test of testMap.values()) {
    const suite = test.suiteName || "tests";
    if (!suitesMap.has(suite)) {
      suitesMap.set(suite, []);
    }
    suitesMap.get(suite)!.push(test);
  }

  const suites: TestSuite[] = [];
  let totalPassed = 0;
  let totalFailed = 0;
  let totalIgnored = 0;
  let calculatedDuration = 0;

  for (const [suiteName, suiteTests] of suitesMap.entries()) {
    let p = 0;
    let f = 0;
    let ign = 0;
    let suiteDuration = 0;

    for (const t of suiteTests) {
      if (t.status === "passed") p++;
      else if (t.status === "failed") f++;
      else if (t.status === "ignored") ign++;

      if (typeof t.durationMs === "number") {
        suiteDuration += t.durationMs;
      }
    }

    totalPassed += p;
    totalFailed += f;
    totalIgnored += ign;
    calculatedDuration += suiteDuration;

    suites.push({
      id: suiteName,
      name: suiteName,
      status: f > 0 ? "failed" : "passed",
      tests: suiteTests,
      passedCount: p,
      failedCount: f,
      ignoredCount: ign,
      totalCount: suiteTests.length,
      durationMs: Math.round(suiteDuration * 100) / 100,
    });
  }

  const totalTests = testMap.size;
  const passRate = totalTests > 0 ? Math.round((totalPassed / totalTests) * 100 * 10) / 10 : 0;
  const finalDuration = totalExecTimeFromSuite > 0 ? totalExecTimeFromSuite : Math.round(calculatedDuration * 100) / 100;

  return {
    suites,
    totalTests,
    passedCount: totalPassed,
    failedCount: totalFailed,
    ignoredCount: totalIgnored,
    passRate,
    totalDurationMs: finalDuration,
    hasFailures: totalFailed > 0,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Parses LCOV test coverage format string into a structured CoverageReport.
 */
export function parseLcovCoverage(lcovString: string): CoverageReport {
  const files = new Map<string, FileCoverage>();
  if (!lcovString || typeof lcovString !== "string") {
    return {
      files,
      totalLinesFound: 0,
      totalLinesHit: 0,
      overallCoveragePercentage: 0,
    };
  }

  const lines = lcovString.split(/\r?\n/);
  let currentFile: string | null = null;
  let lineData = new Map<number, number>();
  let linesFound = 0;
  let linesHit = 0;

  let totalLinesFound = 0;
  let totalLinesHit = 0;
  let branchesFound = 0;
  let branchesHit = 0;
  let functionsFound = 0;
  let functionsHit = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line.startsWith("SF:")) {
      currentFile = line.substring(3).trim().replace(/\\/g, "/");
      lineData = new Map<number, number>();
      linesFound = 0;
      linesHit = 0;
    } else if (line.startsWith("DA:")) {
      // DA:<line_number>,<execution_count>[,<checksum>]
      const parts = line.substring(3).split(",");
      const lineNum = parseInt(parts[0], 10);
      const count = parseInt(parts[1], 10);
      if (!isNaN(lineNum) && !isNaN(count)) {
        lineData.set(lineNum, count);
      }
    } else if (line.startsWith("LF:")) {
      linesFound = parseInt(line.substring(3), 10) || 0;
    } else if (line.startsWith("LH:")) {
      linesHit = parseInt(line.substring(3), 10) || 0;
    } else if (line.startsWith("BRF:")) {
      branchesFound += parseInt(line.substring(4), 10) || 0;
    } else if (line.startsWith("BRH:")) {
      branchesHit += parseInt(line.substring(4), 10) || 0;
    } else if (line.startsWith("FNF:")) {
      functionsFound += parseInt(line.substring(4), 10) || 0;
    } else if (line.startsWith("FNH:")) {
      functionsHit += parseInt(line.substring(4), 10) || 0;
    } else if (line === "end_of_record") {
      if (currentFile) {
        const coveredLines: number[] = [];
        const uncoveredLines: number[] = [];

        for (const [lNum, count] of lineData.entries()) {
          if (count > 0) coveredLines.push(lNum);
          else uncoveredLines.push(lNum);
        }

        coveredLines.sort((a, b) => a - b);
        uncoveredLines.sort((a, b) => a - b);

        const calculatedFound = linesFound || lineData.size;
        const calculatedHit = linesHit || coveredLines.length;
        const coveragePct =
          calculatedFound > 0 ? Math.round((calculatedHit / calculatedFound) * 100 * 10) / 10 : 0;

        files.set(currentFile, {
          filename: currentFile,
          lines: lineData,
          linesFound: calculatedFound,
          linesHit: calculatedHit,
          coveragePercentage: coveragePct,
          coveredLines,
          uncoveredLines,
        });

        totalLinesFound += calculatedFound;
        totalLinesHit += calculatedHit;
      }
      currentFile = null;
    }
  }

  const overallCoveragePercentage =
    totalLinesFound > 0 ? Math.round((totalLinesHit / totalLinesFound) * 100 * 10) / 10 : 0;

  return {
    files,
    totalLinesFound,
    totalLinesHit,
    overallCoveragePercentage,
    branchesFound,
    branchesHit,
    functionsFound,
    functionsHit,
  };
}

export interface LlvmCovSummary {
  count?: number;
  covered?: number;
  percent?: number;
}

export interface LlvmCovFileItem {
  filename?: string;
  summary?: {
    lines?: LlvmCovSummary;
  };
  segments?: Array<[number, number, number, boolean, boolean]>;
}

export interface LlvmCovExport {
  data?: Array<{
    files?: LlvmCovFileItem[];
  }>;
  files?: LlvmCovFileItem[];
}

/**
 * Parses LLVM-cov JSON export format into a structured CoverageReport.
 */
export function parseLlvmCovJson(jsonContent: string | Record<string, unknown>): CoverageReport {
  const files = new Map<string, FileCoverage>();
  let obj: LlvmCovExport;

  try {
    obj =
      typeof jsonContent === "string"
        ? (JSON.parse(jsonContent) as LlvmCovExport)
        : (jsonContent as LlvmCovExport);
  } catch {
    return {
      files,
      totalLinesFound: 0,
      totalLinesHit: 0,
      overallCoveragePercentage: 0,
    };
  }

  let totalLinesFound = 0;
  let totalLinesHit = 0;

  const dataArr = obj.data || [obj];
  for (const item of dataArr) {
    const fileList = item.files || [];
    for (const f of fileList) {
      const filename = (f.filename || "unknown").replace(/\\/g, "/");
      const summary = f.summary?.lines;
      const linesFound = summary?.count || 0;
      const linesHit = summary?.covered || 0;
      const coveragePct = summary?.percent ?? (linesFound > 0 ? (linesHit / linesFound) * 100 : 0);

      const lineMap = new Map<number, number>();
      const coveredLines: number[] = [];
      const uncoveredLines: number[] = [];

      // If segments exist: [line, col, count, has_execution, is_region_entry]
      if (Array.isArray(f.segments)) {
        for (const seg of f.segments) {
          const lineNum = seg[0];
          const count = seg[2];
          lineMap.set(lineNum, count);
          if (count > 0) coveredLines.push(lineNum);
          else uncoveredLines.push(lineNum);
        }
      }

      files.set(filename, {
        filename,
        lines: lineMap,
        linesFound,
        linesHit,
        coveragePercentage: Math.round(coveragePct * 10) / 10,
        coveredLines,
        uncoveredLines,
      });

      totalLinesFound += linesFound;
      totalLinesHit += linesHit;
    }
  }

  const overallCoveragePercentage =
    totalLinesFound > 0 ? Math.round((totalLinesHit / totalLinesFound) * 100 * 10) / 10 : 0;

  return {
    files,
    totalLinesFound,
    totalLinesHit,
    overallCoveragePercentage,
  };
}

/**
 * Generates Monaco Editor line gutter decorations (pass, fail, ignored badges).
 */
export function generateMonacoGutterDecorations(
  tests: TestCase[],
  options: { targetFile?: string; defaultFile?: string } = {},
): MonacoGutterDecoration[] {
  const decorations: MonacoGutterDecoration[] = [];
  const target = options.targetFile?.replace(/\\/g, "/");

  for (const test of tests) {
    if (!test.location?.line) continue;

    if (target && test.location.file) {
      const testFile = test.location.file.replace(/\\/g, "/");
      if (!testFile.endsWith(target) && !target.endsWith(testFile)) {
        continue;
      }
    }

    const line = test.location.line;

    if (test.status === "passed") {
      decorations.push({
        range: {
          startLineNumber: line,
          startColumn: 1,
          endLineNumber: line,
          endColumn: 1,
        },
        options: {
          glyphMarginClassName: "monaco-test-pass-gutter",
          linesDecorationsClassName: "monaco-test-pass-gutter-badge",
          glyphMarginHoverMessage: {
            value: `**PASS**: \`${test.fullName}\` (${test.durationMs ? test.durationMs + "ms" : "<1ms"})`,
          },
          overviewRuler: {
            color: "#22c55e",
            position: 1, // OverviewRulerLane.Left
          },
        },
        type: "test-pass",
        testName: test.fullName,
        lineNumber: line,
      });
    } else if (test.status === "failed") {
      const failureReason = test.panic?.message || test.message || "Assertion failed";
      decorations.push({
        range: {
          startLineNumber: line,
          startColumn: 1,
          endLineNumber: line,
          endColumn: 1,
        },
        options: {
          glyphMarginClassName: "monaco-test-fail-gutter",
          linesDecorationsClassName: "monaco-test-fail-gutter-badge",
          glyphMarginHoverMessage: {
            value: `**FAIL**: \`${test.fullName}\`\n\n${failureReason}`,
          },
          overviewRuler: {
            color: "#ef4444",
            position: 1, // OverviewRulerLane.Left
          },
        },
        type: "test-fail",
        testName: test.fullName,
        lineNumber: line,
      });
    } else if (test.status === "ignored") {
      decorations.push({
        range: {
          startLineNumber: line,
          startColumn: 1,
          endLineNumber: line,
          endColumn: 1,
        },
        options: {
          glyphMarginClassName: "monaco-test-ignored-gutter",
          linesDecorationsClassName: "monaco-test-ignored-gutter-badge",
          glyphMarginHoverMessage: {
            value: `**IGNORED**: \`${test.fullName}\``,
          },
          overviewRuler: {
            color: "#eab308",
            position: 1, // OverviewRulerLane.Left
          },
        },
        type: "test-ignored",
        testName: test.fullName,
        lineNumber: line,
      });
    }
  }

  return decorations;
}

/**
 * Maps code coverage lines to Monaco editor full-line background highlights and overview rulers.
 */
export function generateMonacoCoverageDecorations(
  coverageInput: CoverageReport | FileCoverage,
  options: { targetFile?: string; showCovered?: boolean; showUncovered?: boolean } = {},
): MonacoGutterDecoration[] {
  const decorations: MonacoGutterDecoration[] = [];
  const showCovered = options.showCovered ?? true;
  const showUncovered = options.showUncovered ?? true;

  let fileCoverage: FileCoverage | undefined;

  if ("files" in coverageInput) {
    if (options.targetFile) {
      const target = options.targetFile.replace(/\\/g, "/");
      for (const [fName, fCov] of coverageInput.files.entries()) {
        if (fName.endsWith(target) || target.endsWith(fName)) {
          fileCoverage = fCov;
          break;
        }
      }
    }
    // If not matched or no target provided, pick the first file in report
    if (!fileCoverage && coverageInput.files.size > 0) {
      fileCoverage = Array.from(coverageInput.files.values())[0];
    }
  } else {
    fileCoverage = coverageInput;
  }

  if (!fileCoverage) return decorations;

  if (showCovered) {
    for (const line of fileCoverage.coveredLines) {
      const count = fileCoverage.lines.get(line) || 1;
      decorations.push({
        range: {
          startLineNumber: line,
          startColumn: 1,
          endLineNumber: line,
          endColumn: 1,
        },
        options: {
          isWholeLine: true,
          className: "monaco-coverage-line-covered",
          linesDecorationsClassName: "monaco-coverage-gutter-covered",
          glyphMarginHoverMessage: {
            value: `Line ${line} covered (${count} execution${count === 1 ? "" : "s"})`,
          },
          overviewRuler: {
            color: "#22c55e44",
            position: 4, // OverviewRulerLane.Right
          },
        },
        type: "coverage-hit",
        lineNumber: line,
      });
    }
  }

  if (showUncovered) {
    for (const line of fileCoverage.uncoveredLines) {
      decorations.push({
        range: {
          startLineNumber: line,
          startColumn: 1,
          endLineNumber: line,
          endColumn: 1,
        },
        options: {
          isWholeLine: true,
          className: "monaco-coverage-line-uncovered",
          linesDecorationsClassName: "monaco-coverage-gutter-uncovered",
          glyphMarginHoverMessage: {
            value: `Line ${line} not covered (0 executions)`,
          },
          overviewRuler: {
            color: "#ef444488",
            position: 4, // OverviewRulerLane.Right
          },
        },
        type: "coverage-miss",
        lineNumber: line,
      });
    }
  }

  return decorations;
}

export interface MonacoEditorLike {
  deltaDecorations?: (
    oldDecorations: string[],
    newDecorations: MonacoGutterDecoration[],
  ) => string[];
}

/**
 * Safely applies decorations to a Monaco editor instance, returning new decoration IDs.
 */
export function applyDecorationsToMonaco(
  editor: MonacoEditorLike | null | undefined,
  decorations: MonacoGutterDecoration[],
  oldDecorationIds: string[] = [],
): string[] {
  if (!editor || typeof editor.deltaDecorations !== "function") {
    return [];
  }
  try {
    return editor.deltaDecorations(oldDecorationIds, decorations);
  } catch (err) {
    console.warn("Failed to apply Monaco test decorations:", err);
    return [];
  }
}
