// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

export type SeverityLevel = "critical" | "high" | "medium" | "low";

export interface SecurityVulnerability {
  id: string;
  ruleId: string;
  ruleName: string;
  severity: SeverityLevel;
  title: string;
  description: string;
  remediation: string;
  lineNumber?: number;
  snippet?: string;
  quickFix?: {
    label: string;
    description: string;
    apply: (sourceCode: string) => string;
  };
}

export interface SecurityAuditReport {
  score: number; // 0 - 100
  grade: "A+" | "B" | "C" | "F";
  findings: SecurityVulnerability[];
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    total: number;
  };
  passed: boolean;
}

/**
 * Client-side AST/Static Analysis Linter for Soroban Rust Smart Contracts.
 * Detects common security anti-patterns in real time with automated Quick Fixes.
 */
export function scanContractSecurity(sourceCode: string): SecurityAuditReport {
  if (!sourceCode || !sourceCode.trim()) {
    return {
      score: 100,
      grade: "A+",
      findings: [],
      summary: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
      passed: true,
    };
  }

  const findings: SecurityVulnerability[] = [];
  const lines = sourceCode.split("\n");

  // 1. Rule: Unverified Address Authorization (AUTH_MISSING)
  // Detects methods taking Address parameter and performing storage/transfers without require_auth()
  const fnRegex = /pub\s+fn\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)/g;
  let fnMatch: RegExpExecArray | null;

  while ((fnMatch = fnRegex.exec(sourceCode)) !== null) {
    const fnName = fnMatch[1];
    const fnArgs = fnMatch[2];

    // Check if function takes an Address parameter
    const addressMatch = /([a-zA-Z0-9_]+)\s*:\s*Address/.exec(fnArgs);
    if (addressMatch) {
      const addressParam = addressMatch[1];

      // Extract function body bounds
      const bodyStartIndex = fnMatch.index + fnMatch[0].length;
      const bodyContent = extractBlockContent(sourceCode, bodyStartIndex);

      // Check if function mutates storage or makes token transfers
      const hasStorageWrite =
        bodyContent.includes(".set(") ||
        bodyContent.includes(".remove(") ||
        bodyContent.includes(".transfer(");

      // Check if require_auth is called on this address
      const hasRequireAuth =
        bodyContent.includes(`${addressParam}.require_auth()`) ||
        bodyContent.includes(`require_auth()`);

      if (hasStorageWrite && !hasRequireAuth) {
        const lineNum = getLineNumber(sourceCode, fnMatch.index);
        findings.push({
          id: `auth-${fnName}-${lineNum}`,
          ruleId: "soroban/unverified-address-auth",
          ruleName: "UnverifiedAddressAuthorization",
          severity: "critical",
          title: `Missing Authorization for '${addressParam}' in '${fnName}'`,
          description: `The entry point '${fnName}' accepts an Address parameter '${addressParam}' and mutates state without invoking '${addressParam}.require_auth()'. Any arbitrary caller can invoke this method to tamper with other users' state.`,
          remediation: `Call '${addressParam}.require_auth();' at the start of '${fnName}'.`,
          lineNumber: lineNum,
          snippet: lines[lineNum - 1]?.trim(),
          quickFix: {
            label: `Add ${addressParam}.require_auth()`,
            description: `Injects '${addressParam}.require_auth();' at the start of '${fnName}'.`,
            apply: (code) => {
              const targetFn = `pub fn ${fnName}`;
              const idx = code.indexOf(targetFn);
              if (idx === -1) return code;
              const openBrace = code.indexOf("{", idx);
              if (openBrace === -1) return code;
              const before = code.substring(0, openBrace + 1);
              const after = code.substring(openBrace + 1);
              return `${before}\n        ${addressParam}.require_auth();${after}`;
            },
          },
        });
      }
    }
  }

  // 2. Rule: Missing TTL Renewal (MISSING_TTL)
  // Detects persistent storage writes without extend_ttl in the contract
  const hasPersistentWrite =
    sourceCode.includes("storage().persistent().set") ||
    sourceCode.includes(".persistent().set(");
  const hasExtendTtl =
    sourceCode.includes("extend_ttl") ||
    sourceCode.includes(".extend_ttl_threshold(");

  if (hasPersistentWrite && !hasExtendTtl) {
    const writeLineIndex = lines.findIndex(
      (l) => l.includes(".persistent().set") || l.includes("storage().persistent().set")
    );
    const lineNum = writeLineIndex !== -1 ? writeLineIndex + 1 : 1;

    findings.push({
      id: `ttl-missing-${lineNum}`,
      ruleId: "soroban/missing-ttl-renewal",
      ruleName: "MissingTtlRenewal",
      severity: "medium",
      title: "Missing Storage TTL Renewal (extend_ttl)",
      description:
        "The contract writes directly to persistent storage but never calls 'extend_ttl()'. On the Stellar network, persistent storage entries will be archived if their Time-To-Live (TTL) is not bumped, causing subsequent read failures.",
      remediation:
        "Call 'env.storage().persistent().extend_ttl(&key, threshold, extend_to);' whenever persisting long-lived state.",
      lineNumber: lineNum,
      snippet: lines[lineNum - 1]?.trim(),
      quickFix: {
        label: "Inject extend_ttl() safety renewal",
        description: "Adds storage extend_ttl call after persistent storage mutation.",
        apply: (code) => {
          const match = /(\w+)\.storage\(\)\.persistent\(\)\.set\(([^)]+)\);/.exec(code);
          if (!match) return code;
          const [fullMatch, envName, args] = match;
          const firstArg = args.split(",")[0]?.trim() || "&key";
          const extension = `\n        ${envName}.storage().persistent().extend_ttl(${firstArg}, 100, 1000);`;
          return code.replace(fullMatch, `${fullMatch}${extension}`);
        },
      },
    });
  }

  // 3. Rule: Unconstrained Arithmetic / Overflow Vulnerability (UNCONSTRAINED_ARITHMETIC)
  // Detects unchecked arithmetic operations on amounts/balances like (balance - amount)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Check for subtraction or addition without checked_sub / checked_add
    if (
      (line.includes(" - ") || line.includes(" + ")) &&
      (line.includes("balance") || line.includes("amount") || line.includes("tokens")) &&
      !line.includes("checked_") &&
      !line.includes("//") &&
      !line.includes("use ")
    ) {
      findings.push({
        id: `arithmetic-overflow-${i + 1}`,
        ruleId: "soroban/unconstrained-arithmetic",
        ruleName: "UnconstrainedArithmetic",
        severity: "high",
        title: "Unchecked Arithmetic Operation",
        description: `Direct arithmetic expression in line ${i + 1} may panic on overflow/underflow in release builds or wrap unexpectedly. Always use checked arithmetic for monetary accounting.`,
        remediation: "Use 'checked_sub()' or 'checked_add()' with safe unwrap/error handling.",
        lineNumber: i + 1,
        snippet: line.trim(),
        quickFix: {
          label: "Replace with checked arithmetic",
          description: "Replaces raw arithmetic subtraction with checked_sub().",
          apply: (code) => {
            return code.replace(
              /(\w+)\s*-\s*(\w+)/g,
              "$1.checked_sub($2).expect(\"arithmetic underflow\")"
            );
          },
        },
      });
      break; // Report first primary violation
    }
  }

  // 4. Rule: Integer Truncation (INTEGER_TRUNCATION)
  // Detects casting i128 / u128 to narrower integer types via `as u64` or `as u32`
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (
      /\b(i128|u128)\b/.test(sourceCode) &&
      /\bas\s+(u64|u32|i64|i32)\b/.test(line) &&
      !line.includes("//")
    ) {
      findings.push({
        id: `truncation-${i + 1}`,
        ruleId: "soroban/integer-truncation",
        ruleName: "IntegerTruncation",
        severity: "high",
        title: "Integer Truncation via Unsafe Type Cast",
        description: `Line ${i + 1} casts a 128-bit integer with 'as' to a narrower type. This silently truncates high bits, which can result in severe accounting errors or draining of funds.`,
        remediation: "Use 'u64::try_from(...)' or retain native 128-bit integers.",
        lineNumber: i + 1,
        snippet: line.trim(),
      });
      break;
    }
  }

  // 5. Rule: Reentrancy Risk (REENTRANCY_RISK)
  // Detects cross contract invocation occurring before persistent storage write
  if (
    /invoke_contract|\.call\(/.test(sourceCode) &&
    /\.storage\(\)/.test(sourceCode)
  ) {
    const invokeIndex = sourceCode.search(/invoke_contract|\.call\(/);
    const storageWriteIndex = sourceCode.search(/\.storage\(\)\.persistent\(\)\.set/);
    if (invokeIndex !== -1 && storageWriteIndex !== -1 && invokeIndex < storageWriteIndex) {
      findings.push({
        id: "reentrancy-cei-violation",
        ruleId: "soroban/reentrancy-risk",
        ruleName: "ReentrancyRisk",
        severity: "medium",
        title: "Checks-Effects-Interactions Violation (Reentrancy Risk)",
        description:
          "An external cross-contract call is performed prior to updating local contract storage. An attacker or malicious contract could re-enter this function while local state is stale.",
        remediation: "Apply Checks-Effects-Interactions pattern: mutate local storage before making external calls.",
      });
    }
  }

  // Calculate score deductions
  let deduction = 0;
  let criticalCount = 0;
  let highCount = 0;
  let mediumCount = 0;
  let lowCount = 0;

  for (const f of findings) {
    switch (f.severity) {
      case "critical":
        deduction += 35;
        criticalCount++;
        break;
      case "high":
        deduction += 20;
        highCount++;
        break;
      case "medium":
        deduction += 10;
        mediumCount++;
        break;
      case "low":
        deduction += 5;
        lowCount++;
        break;
    }
  }

  const rawScore = Math.max(0, 100 - deduction);
  const score = findings.length === 0 ? 100 : rawScore;

  let grade: "A+" | "B" | "C" | "F" = "A+";
  if (score < 50 || criticalCount > 0) {
    grade = "F";
  } else if (score < 75) {
    grade = "C";
  } else if (score < 90) {
    grade = "B";
  } else {
    grade = "A+";
  }

  return {
    score,
    grade,
    findings,
    summary: {
      critical: criticalCount,
      high: highCount,
      medium: mediumCount,
      low: lowCount,
      total: findings.length,
    },
    passed: score >= 80 && criticalCount === 0,
  };
}

function extractBlockContent(source: string, startIndex: number): string {
  let depth = 0;
  let foundOpen = false;
  let start = -1;

  for (let i = startIndex; i < source.length; i++) {
    const char = source[i];
    if (char === "{") {
      if (!foundOpen) {
        foundOpen = true;
        start = i;
      }
      depth++;
    } else if (char === "}") {
      depth--;
      if (foundOpen && depth === 0) {
        return source.substring(start, i + 1);
      }
    }
  }

  return source.substring(startIndex);
}

function getLineNumber(source: string, index: number): number {
  return source.substring(0, index).split("\n").length;
}
