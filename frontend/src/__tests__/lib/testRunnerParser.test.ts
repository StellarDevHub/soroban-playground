import {
  parseCargoTestStream,
  parsePanicDetails,
  extractTestLocationsFromRustCode,
  parseLcovCoverage,
  parseLlvmCovJson,
  generateMonacoGutterDecorations,
  generateMonacoCoverageDecorations,
  applyDecorationsToMonaco,
} from "@/lib/testRunnerParser";

describe("testRunnerParser", () => {
  describe("parsePanicDetails", () => {
    it("parses assertion failure with left == right diff", () => {
      const stdout = `
thread 'tests::test_add_overflow' panicked at src/lib.rs:42:9:
assertion \`left == right\` failed
  left: 3
 right: 4
note: run with \`RUST_BACKTRACE=1\` environment variable to display a backtrace
`;
      const panic = parsePanicDetails(stdout);
      expect(panic).toBeDefined();
      expect(panic?.file).toBe("src/lib.rs");
      expect(panic?.line).toBe(42);
      expect(panic?.column).toBe(9);
      expect(panic?.assertionType).toBe("assert_eq");
      expect(panic?.left).toBe("3");
      expect(panic?.right).toBe("4");
      expect(panic?.message).toContain("left (3) != right (4)");
    });

    it("parses assertion failure with backticks and contract path", () => {
      const stdout = `
thread 'tests::test_balance' panicked at 'assertion failed: \`(left == right)\`
  left: \`100\`,
 right: \`200\`', contracts/token/src/lib.rs:88:5
`;
      const panic = parsePanicDetails(stdout);
      expect(panic).toBeDefined();
      expect(panic?.file).toBe("contracts/token/src/lib.rs");
      expect(panic?.line).toBe(88);
      expect(panic?.column).toBe(5);
      expect(panic?.left).toBe("100");
      expect(panic?.right).toBe("200");
    });

    it("parses Result::unwrap() on Err panic", () => {
      const stdout = `
thread 'tests::test_invalid_token' panicked at src/token.rs:19:10:
called \`Result::unwrap()\` on an \`Err\` value: HostError(Error(Contract, #1))
`;
      const panic = parsePanicDetails(stdout);
      expect(panic).toBeDefined();
      expect(panic?.file).toBe("src/token.rs");
      expect(panic?.line).toBe(19);
      expect(panic?.column).toBe(10);
      expect(panic?.message).toContain("Result::unwrap() failed");
      expect(panic?.message).toContain("HostError");
    });

    it("extracts stack backtrace when present", () => {
      const stdout = `
thread 'tests::test_deep_fail' panicked at src/lib.rs:105:5:
custom error message
stack backtrace:
   0: rust_begin_unwind
   1: core::panicking::panic_fmt
   2: hello::tests::test_deep_fail
note: Some details omitted.
`;
      const panic = parsePanicDetails(stdout);
      expect(panic?.backtrace).toBeDefined();
      expect(panic?.backtrace?.length).toBeGreaterThanOrEqual(3);
      expect(panic?.backtrace?.[0]).toContain("rust_begin_unwind");
    });

    it("returns undefined for empty stdout", () => {
      expect(parsePanicDetails("")).toBeUndefined();
    });
  });

  describe("extractTestLocationsFromRustCode", () => {
    it("maps test function definitions and modules to source lines", () => {
      const rustCode = `
#![no_std]
use soroban_sdk::{contract, contractimpl};

#[contract]
pub struct Hello;

#[contractimpl]
impl Hello {
    pub fn hello() -> u32 { 42 }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hello() {
        assert_eq!(Hello::hello(), 42);
    }

    #[test]
    fn test_failure() {
        assert_eq!(1, 2);
    }
}
`;
      const locations = extractTestLocationsFromRustCode(rustCode);
      expect(locations.has("test_hello")).toBe(true);
      expect(locations.has("tests::test_hello")).toBe(true);
      expect(locations.get("test_hello")).toBe(18);
      expect(locations.has("test_failure")).toBe(true);
      expect(locations.get("test_failure")).toBe(23);
    });
  });

  describe("parseCargoTestStream", () => {
    it("parses cargo test JSON stream with passes, failures, and ignored tests", () => {
      const jsonStream = [
        JSON.stringify({ type: "suite", event: "started", test_count: 3 }),
        JSON.stringify({ type: "test", event: "started", name: "tests::test_pass" }),
        JSON.stringify({
          type: "test",
          name: "tests::test_pass",
          event: "ok",
          exec_time: 0.0025,
        }),
        JSON.stringify({ type: "test", event: "started", name: "tests::test_fail" }),
        JSON.stringify({
          type: "test",
          name: "tests::test_fail",
          event: "failed",
          exec_time: 0.0142,
          stdout: `thread 'tests::test_fail' panicked at src/lib.rs:25:9:\nassertion \`left == right\` failed\n  left: 10\n right: 20\n`,
        }),
        JSON.stringify({ type: "test", event: "started", name: "tests::test_skip" }),
        JSON.stringify({
          type: "test",
          name: "tests::test_skip",
          event: "ignored",
          reason: "not supported in wasm",
        }),
        JSON.stringify({
          type: "suite",
          event: "failed",
          passed: 1,
          failed: 1,
          ignored: 1,
          exec_time: 0.021,
        }),
      ].join("\n");

      const result = parseCargoTestStream(jsonStream);

      expect(result.totalTests).toBe(3);
      expect(result.passedCount).toBe(1);
      expect(result.failedCount).toBe(1);
      expect(result.ignoredCount).toBe(1);
      expect(result.hasFailures).toBe(true);
      expect(result.passRate).toBe(33.3);
      expect(result.totalDurationMs).toBe(21);

      expect(result.suites).toHaveLength(1);
      const suite = result.suites[0];
      expect(suite.name).toBe("tests");
      expect(suite.tests).toHaveLength(3);

      const passTest = suite.tests.find((t) => t.name === "test_pass");
      expect(passTest).toBeDefined();
      expect(passTest?.status).toBe("passed");
      expect(passTest?.durationMs).toBe(2.5);

      const failTest = suite.tests.find((t) => t.name === "test_fail");
      expect(failTest).toBeDefined();
      expect(failTest?.status).toBe("failed");
      expect(failTest?.panic?.left).toBe("10");
      expect(failTest?.panic?.right).toBe("20");
      expect(failTest?.location?.line).toBe(25);
    });

    it("parses fallback plain-text cargo test output", () => {
      const plainOutput = `
running 2 tests
test tests::test_one ... ok (0.003s)
test tests::test_two ... FAILED (0.012s)

failures:

---- tests::test_two stdout ----
thread 'tests::test_two' panicked at src/lib.rs:33:5:
assertion \`left == right\` failed
  left: "foo"
 right: "bar"

failures:
    tests::test_two

test result: FAILED. 1 passed; 1 failed; 0 ignored; finished in 0.02s
`;
      const result = parseCargoTestStream(plainOutput);

      expect(result.totalTests).toBe(2);
      expect(result.passedCount).toBe(1);
      expect(result.failedCount).toBe(1);
      expect(result.totalDurationMs).toBe(20);

      const failedTest = result.suites[0].tests.find((t) => t.name === "test_two");
      expect(failedTest?.status).toBe("failed");
      expect(failedTest?.panic?.line).toBe(33);
      expect(failedTest?.panic?.left).toBe('"foo"');
      expect(failedTest?.panic?.right).toBe('"bar"');
    });
  });

  describe("parseLcovCoverage", () => {
    it("parses standard LCOV coverage report", () => {
      const lcovData = `
TN:
SF:src/lib.rs
DA:1,3
DA:2,3
DA:3,0
DA:4,3
DA:5,0
LF:5
LH:3
end_of_record
SF:src/token.rs
DA:10,1
DA:11,1
LF:2
LH:2
end_of_record
`;
      const report = parseLcovCoverage(lcovData);

      expect(report.totalLinesFound).toBe(7);
      expect(report.totalLinesHit).toBe(5);
      expect(report.overallCoveragePercentage).toBe(71.4);

      const libCov = report.files.get("src/lib.rs");
      expect(libCov).toBeDefined();
      expect(libCov?.linesFound).toBe(5);
      expect(libCov?.linesHit).toBe(3);
      expect(libCov?.coveragePercentage).toBe(60);
      expect(libCov?.coveredLines).toEqual([1, 2, 4]);
      expect(libCov?.uncoveredLines).toEqual([3, 5]);

      const tokenCov = report.files.get("src/token.rs");
      expect(tokenCov?.coveragePercentage).toBe(100);
      expect(tokenCov?.uncoveredLines).toHaveLength(0);
    });

    it("handles empty or invalid LCOV gracefully", () => {
      const emptyReport = parseLcovCoverage("");
      expect(emptyReport.totalLinesFound).toBe(0);
      expect(emptyReport.totalLinesHit).toBe(0);
      expect(emptyReport.overallCoveragePercentage).toBe(0);
    });
  });

  describe("parseLlvmCovJson", () => {
    it("parses LLVM-cov JSON export format", () => {
      const llvmJson = {
        data: [
          {
            files: [
              {
                filename: "src/lib.rs",
                summary: {
                  lines: { count: 10, covered: 8, percent: 80 },
                },
                segments: [
                  [1, 0, 5, true, true],
                  [2, 0, 0, false, false],
                ],
              },
            ],
          },
        ],
      };

      const report = parseLlvmCovJson(llvmJson);
      expect(report.totalLinesFound).toBe(10);
      expect(report.totalLinesHit).toBe(8);
      expect(report.overallCoveragePercentage).toBe(80);

      const libCov = report.files.get("src/lib.rs");
      expect(libCov?.coveredLines).toEqual([1]);
      expect(libCov?.uncoveredLines).toEqual([2]);
    });
  });

  describe("generateMonacoGutterDecorations", () => {
    it("generates gutter badges for passed, failed, and ignored tests", () => {
      const tests = [
        {
          id: "tests::test_pass",
          name: "test_pass",
          fullName: "tests::test_pass",
          suiteName: "tests",
          status: "passed" as const,
          durationMs: 4.5,
          execTimeSec: 0.0045,
          stdout: null,
          location: { file: "src/lib.rs", line: 15 },
        },
        {
          id: "tests::test_fail",
          name: "test_fail",
          fullName: "tests::test_fail",
          suiteName: "tests",
          status: "failed" as const,
          durationMs: 12,
          execTimeSec: 0.012,
          stdout: null,
          message: "assertion left == right failed",
          location: { file: "src/lib.rs", line: 28 },
        },
        {
          id: "tests::test_skip",
          name: "test_skip",
          fullName: "tests::test_skip",
          suiteName: "tests",
          status: "ignored" as const,
          durationMs: null,
          execTimeSec: null,
          stdout: null,
          location: { file: "src/lib.rs", line: 40 },
        },
      ];

      const decorations = generateMonacoGutterDecorations(tests, { targetFile: "src/lib.rs" });

      expect(decorations).toHaveLength(3);

      const passDeco = decorations.find((d) => d.type === "test-pass");
      expect(passDeco?.range.startLineNumber).toBe(15);
      expect(passDeco?.options.glyphMarginClassName).toBe("monaco-test-pass-gutter");
      expect(passDeco?.options.overviewRuler?.color).toBe("#22c55e");

      const failDeco = decorations.find((d) => d.type === "test-fail");
      expect(failDeco?.range.startLineNumber).toBe(28);
      expect(failDeco?.options.glyphMarginClassName).toBe("monaco-test-fail-gutter");
      expect(failDeco?.options.overviewRuler?.color).toBe("#ef4444");

      const skipDeco = decorations.find((d) => d.type === "test-ignored");
      expect(skipDeco?.range.startLineNumber).toBe(40);
      expect(skipDeco?.options.glyphMarginClassName).toBe("monaco-test-ignored-gutter");
    });
  });

  describe("generateMonacoCoverageDecorations", () => {
    it("generates whole line highlights for hit and miss lines", () => {
      const fileCov = {
        filename: "src/lib.rs",
        lines: new Map([
          [5, 2],
          [6, 0],
        ]),
        linesFound: 2,
        linesHit: 1,
        coveragePercentage: 50,
        coveredLines: [5],
        uncoveredLines: [6],
      };

      const decorations = generateMonacoCoverageDecorations(fileCov);
      expect(decorations).toHaveLength(2);

      const hitDeco = decorations.find((d) => d.type === "coverage-hit");
      expect(hitDeco?.range.startLineNumber).toBe(5);
      expect(hitDeco?.options.isWholeLine).toBe(true);
      expect(hitDeco?.options.className).toBe("monaco-coverage-line-covered");

      const missDeco = decorations.find((d) => d.type === "coverage-miss");
      expect(missDeco?.range.startLineNumber).toBe(6);
      expect(missDeco?.options.isWholeLine).toBe(true);
      expect(missDeco?.options.className).toBe("monaco-coverage-line-uncovered");
    });
  });

  describe("applyDecorationsToMonaco", () => {
    it("calls editor deltaDecorations safely and handles null gracefully", () => {
      const mockEditor = {
        deltaDecorations: jest.fn().mockReturnValue(["d1", "d2"]),
      };

      const ids = applyDecorationsToMonaco(mockEditor, [], ["old-1"]);
      expect(mockEditor.deltaDecorations).toHaveBeenCalledWith(["old-1"], []);
      expect(ids).toEqual(["d1", "d2"]);

      // Null editor
      expect(applyDecorationsToMonaco(null, [])).toEqual([]);
    });
  });
});
