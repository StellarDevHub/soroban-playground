"use client";

import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  TestTube2,
  Play,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  Clock,
  ShieldCheck,
  ChevronDown,
  ChevronRight,
  Search,
  Copy,
  Check,
  FileCode,
  Layers,
  Terminal,
} from "lucide-react";
import {
  parseCargoTestStream,
  parseLcovCoverage,
  parseLlvmCovJson,
  generateMonacoGutterDecorations,
  generateMonacoCoverageDecorations,
  applyDecorationsToMonaco,
  type TestRunResult,
  type CoverageReport,
  type TestStatus,
  type MonacoEditorLike,
  type MonacoGutterDecoration,
} from "@/lib/testRunnerParser";

export interface TestRunnerPanelProps {
  /** Raw cargo test output (JSON stream or plain text) */
  rawOutput?: string;
  /** LCOV or LLVM-cov coverage string */
  coverageOutput?: string;
  /** Active Rust source code from Monaco editor */
  sourceCode?: string;
  /** Active file name, defaults to "src/lib.rs" */
  activeFile?: string;
  /** Callback when user clicks "Run Tests" */
  onRunTests?: () => Promise<void> | void;
  /** Loading state indicator */
  isRunning?: boolean;
  /** Callback when a test line number or coverage line is clicked */
  onSelectLine?: (line: number) => void;
  /** Monaco editor instance to apply gutter badges and coverage highlights to */
  editorInstance?: MonacoEditorLike | null;
  /** Optional custom class name */
  className?: string;
}

export const SAMPLE_CARGO_TEST_STREAM = [
  JSON.stringify({ type: "suite", event: "started", test_count: 4 }),
  JSON.stringify({ type: "test", event: "started", name: "tests::test_hello_world" }),
  JSON.stringify({
    type: "test",
    name: "tests::test_hello_world",
    event: "ok",
    exec_time: 0.0028,
  }),
  JSON.stringify({ type: "test", event: "started", name: "tests::test_token_balance" }),
  JSON.stringify({
    type: "test",
    name: "tests::test_token_balance",
    event: "ok",
    exec_time: 0.0041,
  }),
  JSON.stringify({ type: "test", event: "started", name: "tests::test_unauthorized_mint" }),
  JSON.stringify({
    type: "test",
    name: "tests::test_unauthorized_mint",
    event: "failed",
    exec_time: 0.0125,
    stdout: `thread 'tests::test_unauthorized_mint' panicked at src/lib.rs:48:9:
assertion \`left == right\` failed
  left: 401
 right: 200
note: run with \`RUST_BACKTRACE=1\` environment variable to display a backtrace
stack backtrace:
   0: rust_begin_unwind
   1: core::panicking::panic_fmt
   2: soroban_token::tests::test_unauthorized_mint
`,
  }),
  JSON.stringify({ type: "test", event: "started", name: "tests::test_fuzz_transfers" }),
  JSON.stringify({
    type: "test",
    name: "tests::test_fuzz_transfers",
    event: "ignored",
    reason: "expensive fuzzing disabled in quick run",
  }),
  JSON.stringify({
    type: "suite",
    event: "failed",
    passed: 2,
    failed: 1,
    ignored: 1,
    exec_time: 0.0194,
  }),
].join("\n");

export const SAMPLE_LCOV_COVERAGE = `TN:
SF:src/lib.rs
DA:1,1
DA:5,1
DA:10,2
DA:15,2
DA:20,2
DA:25,1
DA:30,1
DA:35,1
DA:40,1
DA:45,1
DA:48,1
DA:52,0
DA:53,0
DA:55,0
LF:14
LH:11
end_of_record
SF:src/token.rs
DA:4,1
DA:8,1
DA:12,1
DA:16,0
LF:4
LH:3
end_of_record
`;

export function TestRunnerPanel({
  rawOutput,
  coverageOutput,
  sourceCode,
  activeFile = "src/lib.rs",
  onRunTests,
  isRunning = false,
  onSelectLine,
  editorInstance,
  className = "",
}: TestRunnerPanelProps) {
  const [activeTab, setActiveTab] = useState<"suites" | "coverage" | "raw">("suites");
  const [statusFilter, setStatusFilter] = useState<"all" | TestStatus>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showGutterBadges, setShowGutterBadges] = useState(true);
  const [showCoverageHighlights, setShowCoverageHighlights] = useState(true);
  const [expandedTests, setExpandedTests] = useState<Record<string, boolean>>({});
  const [copiedRaw, setCopiedRaw] = useState(false);

  const previousDecorationsRef = useRef<string[]>([]);

  // Effective streams (fallback to realistic sample if nothing provided)
  const effectiveRawOutput = rawOutput !== undefined ? rawOutput : SAMPLE_CARGO_TEST_STREAM;
  const effectiveCoverageOutput =
    coverageOutput !== undefined ? coverageOutput : SAMPLE_LCOV_COVERAGE;

  // Parse cargo test outputs
  const testResults: TestRunResult = useMemo(() => {
    return parseCargoTestStream(effectiveRawOutput, sourceCode);
  }, [effectiveRawOutput, sourceCode]);

  // Parse coverage report
  const coverageReport: CoverageReport = useMemo(() => {
    if (!effectiveCoverageOutput) {
      return {
        files: new Map(),
        totalLinesFound: 0,
        totalLinesHit: 0,
        overallCoveragePercentage: 0,
      };
    }
    if (effectiveCoverageOutput.trim().startsWith("{")) {
      return parseLlvmCovJson(effectiveCoverageOutput);
    }
    return parseLcovCoverage(effectiveCoverageOutput);
  }, [effectiveCoverageOutput]);

  // Synchronize decorations to Monaco editor instance
  useEffect(() => {
    if (!editorInstance) return;

    let allDecorations: MonacoGutterDecoration[] = [];

    if (showGutterBadges && testResults.suites.length > 0) {
      const allTests = testResults.suites.flatMap((s) => s.tests);
      const gutterDecos = generateMonacoGutterDecorations(allTests, {
        targetFile: activeFile,
      });
      allDecorations = allDecorations.concat(gutterDecos);
    }

    if (showCoverageHighlights && coverageReport.files.size > 0) {
      const covDecos = generateMonacoCoverageDecorations(coverageReport, {
        targetFile: activeFile,
      });
      allDecorations = allDecorations.concat(covDecos);
    }

    const newIds = applyDecorationsToMonaco(
      editorInstance,
      allDecorations,
      previousDecorationsRef.current,
    );
    previousDecorationsRef.current = newIds;

    return () => {
      if (editorInstance && previousDecorationsRef.current.length > 0) {
        applyDecorationsToMonaco(editorInstance, [], previousDecorationsRef.current);
        previousDecorationsRef.current = [];
      }
    };
  }, [
    editorInstance,
    showGutterBadges,
    showCoverageHighlights,
    testResults,
    coverageReport,
    activeFile,
  ]);

  // Filtered tests across all suites
  const filteredSuites = useMemo(() => {
    return testResults.suites
      .map((suite) => {
        const tests = suite.tests.filter((test) => {
          const matchesStatus =
            statusFilter === "all" ? true : test.status === statusFilter;
          const query = searchQuery.toLowerCase().trim();
          const matchesQuery =
            !query ||
            test.name.toLowerCase().includes(query) ||
            test.fullName.toLowerCase().includes(query) ||
            (test.panic?.message && test.panic.message.toLowerCase().includes(query));
          return matchesStatus && matchesQuery;
        });

        return {
          ...suite,
          tests,
        };
      })
      .filter((suite) => suite.tests.length > 0);
  }, [testResults.suites, statusFilter, searchQuery]);

  const toggleTestExpanded = (id: string) => {
    setExpandedTests((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const copyRawOutput = () => {
    navigator.clipboard.writeText(effectiveRawOutput);
    setCopiedRaw(true);
    setTimeout(() => setCopiedRaw(false), 2000);
  };

  return (
    <div
      role="region"
      aria-label="Interactive Test Runner"
      className={`flex flex-col rounded-xl border border-gray-800 bg-gray-950 text-slate-200 overflow-hidden shadow-2xl ${className}`}
      data-testid="test-runner-panel"
    >
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-800 bg-gray-900/90 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-500/10 text-teal-400 border border-teal-500/20">
            <TestTube2 className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold tracking-wide text-slate-100">
                Interactive Test Runner
              </h2>
              <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                cargo test
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Live TAP assertion parser, Monaco gutter badges & LCOV line coverage
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onRunTests && (
            <button
              type="button"
              onClick={() => onRunTests()}
              disabled={isRunning}
              className="flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-teal-500 disabled:opacity-50 transition"
              data-testid="run-tests-btn"
            >
              {isRunning ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Running...</span>
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5 fill-current" />
                  <span>Run Tests</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Metrics Banner */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 border-b border-gray-800/80 bg-gray-950 p-3">
        {/* Pass Rate */}
        <div className="flex flex-col rounded-lg border border-gray-800/80 bg-gray-900/50 p-2.5">
          <span className="text-[11px] font-medium text-slate-400">Pass Rate</span>
          <div className="mt-1 flex items-baseline gap-2">
            <span
              className={`text-xl font-bold font-mono ${
                testResults.passRate >= 90
                  ? "text-emerald-400"
                  : testResults.passRate >= 50
                    ? "text-amber-400"
                    : "text-rose-400"
              }`}
            >
              {testResults.passRate}%
            </span>
            <span className="text-xs text-slate-400">
              ({testResults.passedCount}/{testResults.totalTests})
            </span>
          </div>
        </div>

        {/* Status Breakdown */}
        <div className="flex flex-col rounded-lg border border-gray-800/80 bg-gray-900/50 p-2.5">
          <span className="text-[11px] font-medium text-slate-400">Test Breakdown</span>
          <div className="mt-1 flex items-center gap-2.5 text-xs font-mono">
            <span className="flex items-center gap-1 text-emerald-400">
              <CheckCircle2 className="h-3 w-3" />
              {testResults.passedCount}
            </span>
            <span className="flex items-center gap-1 text-rose-400">
              <XCircle className="h-3 w-3" />
              {testResults.failedCount}
            </span>
            <span className="flex items-center gap-1 text-amber-400">
              <AlertCircle className="h-3 w-3" />
              {testResults.ignoredCount}
            </span>
          </div>
        </div>

        {/* Latency */}
        <div className="flex flex-col rounded-lg border border-gray-800/80 bg-gray-900/50 p-2.5">
          <span className="text-[11px] font-medium text-slate-400">Total Latency</span>
          <div className="mt-1 flex items-baseline gap-1.5 text-slate-200">
            <Clock className="h-3.5 w-3.5 text-slate-400 self-center" />
            <span className="text-lg font-bold font-mono text-cyan-400">
              {testResults.totalDurationMs}
            </span>
            <span className="text-xs text-slate-400">ms</span>
          </div>
        </div>

        {/* Code Coverage */}
        <div className="flex flex-col rounded-lg border border-gray-800/80 bg-gray-900/50 p-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-400">Code Coverage</span>
            <ShieldCheck className="h-3.5 w-3.5 text-teal-400" />
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span
              className={`text-xl font-bold font-mono ${
                coverageReport.overallCoveragePercentage >= 80
                  ? "text-emerald-400"
                  : coverageReport.overallCoveragePercentage >= 60
                    ? "text-amber-400"
                    : "text-rose-400"
              }`}
            >
              {coverageReport.overallCoveragePercentage}%
            </span>
            <span className="text-xs text-slate-400">
              ({coverageReport.totalLinesHit}/{coverageReport.totalLinesFound} lines)
            </span>
          </div>
        </div>
      </div>

      {/* Tabs and Monaco Decoration Toggles */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-800 bg-gray-900/60 px-3 py-2 text-xs">
        {/* Navigation Tabs */}
        <div role="tablist" aria-label="Test Runner Views" className="flex items-center gap-1">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "suites"}
            onClick={() => setActiveTab("suites")}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-medium transition ${
              activeTab === "suites"
                ? "bg-slate-800 text-teal-400 shadow-sm"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            <span>Test Suites ({testResults.totalTests})</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "coverage"}
            onClick={() => setActiveTab("coverage")}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-medium transition ${
              activeTab === "coverage"
                ? "bg-slate-800 text-teal-400 shadow-sm"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
            }`}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Code Coverage ({coverageReport.overallCoveragePercentage}%)</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "raw"}
            onClick={() => setActiveTab("raw")}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-medium transition ${
              activeTab === "raw"
                ? "bg-slate-800 text-teal-400 shadow-sm"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
            }`}
          >
            <Terminal className="h-3.5 w-3.5" />
            <span>Raw Stream</span>
          </button>
        </div>

        {/* Monaco Editor Badges & Coverage toggles */}
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 cursor-pointer text-slate-300 hover:text-white select-none">
            <input
              type="checkbox"
              checked={showGutterBadges}
              onChange={(e) => setShowGutterBadges(e.target.checked)}
              className="rounded border-gray-700 bg-gray-800 text-teal-500 focus:ring-0 focus:ring-offset-0"
            />
            <span className="text-[11px]">Monaco Gutter Badges</span>
          </label>

          <label className="flex items-center gap-1.5 cursor-pointer text-slate-300 hover:text-white select-none">
            <input
              type="checkbox"
              checked={showCoverageHighlights}
              onChange={(e) => setShowCoverageHighlights(e.target.checked)}
              className="rounded border-gray-700 bg-gray-800 text-teal-500 focus:ring-0 focus:ring-offset-0"
            />
            <span className="text-[11px]">Coverage Highlights</span>
          </label>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="p-3">
        {/* VIEW 1: Test Suites & Cases */}
        {activeTab === "suites" && (
          <div className="flex flex-col gap-3">
            {/* Filter and Search Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              {/* Status Filter Buttons */}
              <div className="flex items-center gap-1">
                {(["all", "passed", "failed", "ignored"] as const).map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => setStatusFilter(status)}
                    className={`rounded-md px-2 py-0.5 text-[11px] font-medium capitalize transition ${
                      statusFilter === status
                        ? "bg-slate-800 text-teal-400 font-semibold"
                        : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
                    }`}
                  >
                    {status}
                    <span className="ml-1 text-[10px] opacity-75">
                      (
                      {status === "all"
                        ? testResults.totalTests
                        : status === "passed"
                          ? testResults.passedCount
                          : status === "failed"
                            ? testResults.failedCount
                            : testResults.ignoredCount}
                      )
                    </span>
                  </button>
                ))}
              </div>

              {/* Search input */}
              <div className="relative min-w-[200px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                <input
                  type="text"
                  placeholder="Filter test cases..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-md border border-gray-800 bg-gray-900 py-1 pl-8 pr-3 text-xs text-slate-200 placeholder-slate-500 focus:border-teal-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Test Suites List */}
            {filteredSuites.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-800 py-10 text-center">
                <TestTube2 className="h-8 w-8 text-slate-600 mb-2" />
                <p className="text-xs font-medium text-slate-400">No test cases match filter</p>
                <button
                  type="button"
                  onClick={() => {
                    setStatusFilter("all");
                    setSearchQuery("");
                  }}
                  className="mt-2 text-xs text-teal-400 hover:underline"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {filteredSuites.map((suite) => (
                  <div
                    key={suite.id}
                    className="flex flex-col rounded-lg border border-gray-800/80 bg-gray-900/40 overflow-hidden"
                  >
                    {/* Suite Header */}
                    <div className="flex items-center justify-between border-b border-gray-800/60 bg-gray-900/80 px-3 py-2 text-xs font-medium">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-slate-300 font-semibold">
                          {suite.name}
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.2 text-[10px] ${
                            suite.status === "passed"
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                              : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                          }`}
                        >
                          {suite.status.toUpperCase()}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-slate-400 font-mono text-[11px]">
                        <span>
                          {suite.passedCount}/{suite.totalCount} passed
                        </span>
                        <span>{suite.durationMs}ms</span>
                      </div>
                    </div>

                    {/* Test Cards Inside Suite */}
                    <div className="divide-y divide-gray-800/50">
                      {suite.tests.map((test) => {
                        const isExpanded =
                          expandedTests[test.id] !== undefined
                            ? expandedTests[test.id]
                            : test.status === "failed";

                        return (
                          <div
                            key={test.id}
                            className={`p-3 transition ${
                              test.status === "failed"
                                ? "bg-rose-950/10"
                                : "hover:bg-slate-900/30"
                            }`}
                            data-testid={`test-card-${test.id}`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              {/* Left: Icon + Name */}
                              <div className="flex items-start gap-2.5 min-w-0">
                                <div className="mt-0.5 flex-shrink-0">
                                  {test.status === "passed" && (
                                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                                  )}
                                  {test.status === "failed" && (
                                    <XCircle className="h-4 w-4 text-rose-400" />
                                  )}
                                  {test.status === "ignored" && (
                                    <AlertCircle className="h-4 w-4 text-amber-400" />
                                  )}
                                  {test.status === "running" && (
                                    <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-mono text-xs font-medium text-slate-200">
                                      {test.name}
                                    </span>
                                    {test.durationMs != null && (
                                      <span className="rounded bg-slate-800/80 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                                        {test.durationMs}ms
                                      </span>
                                    )}
                                  </div>

                                  {/* Line Location Badge */}
                                  {test.location?.line && (
                                    <button
                                      type="button"
                                      onClick={() => onSelectLine?.(test.location!.line)}
                                      className="mt-1 flex items-center gap-1 font-mono text-[11px] text-teal-400/90 hover:text-teal-300 hover:underline"
                                    >
                                      <FileCode className="h-3 w-3" />
                                      <span>
                                        {test.location.file}:{test.location.line}
                                      </span>
                                    </button>
                                  )}
                                </div>
                              </div>

                              {/* Right: Actions */}
                              <div className="flex items-center gap-2">
                                {(test.panic || test.stdout) && (
                                  <button
                                    type="button"
                                    onClick={() => toggleTestExpanded(test.id)}
                                    className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
                                  >
                                    <span>{isExpanded ? "Hide Details" : "View Details"}</span>
                                    {isExpanded ? (
                                      <ChevronDown className="h-3.5 w-3.5" />
                                    ) : (
                                      <ChevronRight className="h-3.5 w-3.5" />
                                    )}
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Failure & Panic Details */}
                            {isExpanded && (test.panic || test.stdout) && (
                              <div className="mt-3 rounded-lg border border-rose-900/50 bg-rose-950/20 p-3 text-xs">
                                <div className="flex items-center gap-2 text-rose-400 font-semibold mb-2">
                                  <AlertCircle className="h-4 w-4" />
                                  <span>Assertion Failure & Panic Output</span>
                                </div>

                                {/* Assertion Diff Display */}
                                {test.panic?.left && test.panic?.right && (
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2 font-mono">
                                    <div className="rounded border border-rose-800/60 bg-rose-950/40 p-2">
                                      <span className="text-[10px] uppercase font-bold text-rose-400">
                                        Left (Actual)
                                      </span>
                                      <pre className="mt-1 text-slate-200 overflow-x-auto whitespace-pre-wrap">
                                        {test.panic.left}
                                      </pre>
                                    </div>
                                    <div className="rounded border border-emerald-800/60 bg-emerald-950/40 p-2">
                                      <span className="text-[10px] uppercase font-bold text-emerald-400">
                                        Right (Expected)
                                      </span>
                                      <pre className="mt-1 text-slate-200 overflow-x-auto whitespace-pre-wrap">
                                        {test.panic.right}
                                      </pre>
                                    </div>
                                  </div>
                                )}

                                {/* Error Message */}
                                {test.panic?.message && (
                                  <p className="font-mono text-rose-300 text-[11px] bg-rose-950/40 p-2 rounded border border-rose-900/30">
                                    {test.panic.message}
                                  </p>
                                )}

                                {/* Backtrace preview if available */}
                                {test.panic?.backtrace && test.panic.backtrace.length > 0 && (
                                  <div className="mt-2">
                                    <span className="text-[10px] text-slate-400 uppercase font-semibold">
                                      Stack Backtrace
                                    </span>
                                    <div className="mt-1 max-h-32 overflow-y-auto rounded bg-gray-950/90 p-2 font-mono text-[10px] text-slate-400">
                                      {test.panic.backtrace.map((frame, idx) => (
                                        <div key={idx} className="truncate">
                                          {frame}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* VIEW 2: Code Coverage Breakdown */}
        {activeTab === "coverage" && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-semibold text-slate-200">
                  Line-Level Test Coverage
                </h3>
                <p className="text-[11px] text-slate-400">
                  Derived from LCOV / LLVM-cov data mapped to active contract files
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-bold text-teal-400">
                  {coverageReport.overallCoveragePercentage}%
                </span>
                <span className="text-xs text-slate-400">Overall</span>
              </div>
            </div>

            {/* Coverage Progress Bar */}
            <div className="h-2 w-full overflow-hidden rounded-full bg-gray-800">
              <div
                className="h-full bg-teal-500 transition-all duration-300"
                style={{ width: `${coverageReport.overallCoveragePercentage}%` }}
              />
            </div>

            {/* File by File Table */}
            <div className="mt-2 rounded-lg border border-gray-800 bg-gray-900/40 overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-gray-800 bg-gray-900/80 text-[11px] font-semibold text-slate-400">
                    <th className="px-3 py-2">Source File</th>
                    <th className="px-3 py-2">Coverage %</th>
                    <th className="px-3 py-2">Lines Hit / Total</th>
                    <th className="px-3 py-2">Uncovered Lines</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/60 font-mono">
                  {Array.from(coverageReport.files.values()).map((file) => (
                    <tr key={file.filename} className="hover:bg-slate-900/30">
                      <td className="px-3 py-2.5 font-medium text-slate-200">
                        {file.filename}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[11px] ${
                            file.coveragePercentage >= 80
                              ? "bg-emerald-500/10 text-emerald-400"
                              : file.coveragePercentage >= 60
                                ? "bg-amber-500/10 text-amber-400"
                                : "bg-rose-500/10 text-rose-400"
                          }`}
                        >
                          {file.coveragePercentage}%
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-slate-400">
                        {file.linesHit} / {file.linesFound}
                      </td>
                      <td className="px-3 py-2.5">
                        {file.uncoveredLines.length === 0 ? (
                          <span className="text-emerald-400 text-[11px]">100% Covered</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {file.uncoveredLines.slice(0, 8).map((lineNum) => (
                              <button
                                key={lineNum}
                                type="button"
                                onClick={() => onSelectLine?.(lineNum)}
                                className="rounded bg-rose-950/60 border border-rose-800/50 px-1 py-0.2 text-[10px] text-rose-300 hover:bg-rose-900 transition"
                              >
                                L{lineNum}
                              </button>
                            ))}
                            {file.uncoveredLines.length > 8 && (
                              <span className="text-[10px] text-slate-500">
                                +{file.uncoveredLines.length - 8} more
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* VIEW 3: Raw Stream Output */}
        {activeTab === "raw" && (
          <div className="relative">
            <button
              type="button"
              onClick={copyRawOutput}
              className="absolute right-3 top-3 flex items-center gap-1 rounded bg-slate-800 px-2.5 py-1 text-[11px] text-slate-300 hover:text-white hover:bg-slate-700 transition"
            >
              {copiedRaw ? (
                <>
                  <Check className="h-3 w-3 text-emerald-400" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" />
                  <span>Copy Stream</span>
                </>
              )}
            </button>
            <pre className="max-h-96 overflow-y-auto rounded-lg border border-gray-800 bg-gray-950 p-3 font-mono text-xs text-slate-300 whitespace-pre-wrap leading-relaxed">
              {effectiveRawOutput}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

export default React.memo(TestRunnerPanel);
