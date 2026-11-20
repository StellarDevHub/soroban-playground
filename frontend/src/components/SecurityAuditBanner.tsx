"use client";

import React, { useState, useMemo } from "react";
import {
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Zap,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Info,
  Terminal,
  Sparkles,
} from "lucide-react";
import {
  scanContractSecurity,
  SecurityAuditReport,
  SecurityVulnerability,
} from "@/lib/security/sorobanLinter";

export interface SecurityAuditBannerProps {
  sourceCode: string;
  onApplyQuickFix?: (newCode: string) => void;
  className?: string;
}

export default function SecurityAuditBanner({
  sourceCode,
  onApplyQuickFix,
  className = "",
}: SecurityAuditBannerProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [appliedFixIds, setAppliedFixIds] = useState<Set<string>>(new Set());

  const report: SecurityAuditReport = useMemo(() => {
    return scanContractSecurity(sourceCode);
  }, [sourceCode]);

  const { score, grade, findings, summary, passed } = report;

  const handleApplySingleFix = (finding: SecurityVulnerability) => {
    if (!finding.quickFix || !onApplyQuickFix) return;
    const patchedCode = finding.quickFix.apply(sourceCode);
    setAppliedFixIds((prev) => new Set(prev).add(finding.id));
    onApplyQuickFix(patchedCode);
  };

  const handleApplyAllSafeFixes = () => {
    if (!onApplyQuickFix) return;
    let current = sourceCode;
    const newlyApplied = new Set(appliedFixIds);

    for (const finding of findings) {
      if (finding.quickFix) {
        current = finding.quickFix.apply(current);
        newlyApplied.add(finding.id);
      }
    }

    setAppliedFixIds(newlyApplied);
    onApplyQuickFix(current);
  };

  const fixableCount = findings.filter((f) => f.quickFix).length;

  // Grade color theme mapping
  const gradeStyles = {
    "A+": "bg-emerald-500/10 border-emerald-500/30 text-emerald-400",
    B: "bg-amber-500/10 border-amber-500/30 text-amber-400",
    C: "bg-orange-500/10 border-orange-500/30 text-orange-400",
    F: "bg-rose-500/10 border-rose-500/30 text-rose-400",
  };

  const progressBg =
    score >= 90
      ? "bg-emerald-500"
      : score >= 75
      ? "bg-amber-500"
      : score >= 50
      ? "bg-orange-500"
      : "bg-rose-500";

  return (
    <div
      data-testid="security-audit-banner"
      className={`rounded-2xl border transition-all duration-300 ${
        passed
          ? "bg-slate-900/60 border-white/10 shadow-lg"
          : "bg-slate-900/80 border-rose-500/30 shadow-xl shadow-rose-950/20"
      } ${className}`}
    >
      {/* Banner Header / Summary Bar */}
      <div className="p-5 flex flex-wrap items-center justify-between gap-4 border-b border-white/5">
        <div className="flex items-center gap-4">
          <div
            className={`p-3 rounded-2xl border ${
              passed
                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                : "bg-rose-500/10 border-rose-500/20 text-rose-400"
            }`}
          >
            {passed ? <ShieldCheck size={26} /> : <ShieldAlert size={26} />}
          </div>

          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-base font-bold text-white tracking-tight">
                Real-Time Security Audit Scanner
              </h2>
              <span
                data-testid="security-grade-badge"
                className={`text-xs font-bold px-2 py-0.5 rounded-full border ${gradeStyles[grade]}`}
              >
                Grade: {grade}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {findings.length === 0
                ? "All static security checks passing. Zero detected vulnerabilities."
                : `${findings.length} security anti-pattern${
                    findings.length === 1 ? "" : "s"
                  } detected in active code buffer.`}
            </p>
          </div>
        </div>

        {/* Score & Global Actions */}
        <div className="flex items-center gap-5">
          {/* Security Score Gauge */}
          <div className="flex flex-col items-end">
            <div className="flex items-baseline gap-1">
              <span
                data-testid="security-score-number"
                className="text-2xl font-black text-white"
              >
                {score}
              </span>
              <span className="text-xs text-slate-400 font-semibold">/100%</span>
            </div>
            <div className="w-24 h-1.5 rounded-full bg-slate-800 mt-1 overflow-hidden">
              <div
                data-testid="security-score-bar"
                className={`h-full transition-all duration-500 ${progressBg}`}
                style={{ width: `${score}%` }}
              />
            </div>
          </div>

          {/* Quick Fix All Button */}
          {fixableCount > 0 && onApplyQuickFix && (
            <button
              type="button"
              data-testid="apply-all-fixes-btn"
              onClick={handleApplyAllSafeFixes}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold transition shadow-sm active:scale-95"
            >
              <Sparkles size={14} />
              <span>Fix All ({fixableCount})</span>
            </button>
          )}

          {/* Expand/Collapse Toggle */}
          <button
            type="button"
            data-testid="toggle-audit-details"
            aria-label={isExpanded ? "Collapse security details" : "Expand security details"}
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
        </div>
      </div>

      {/* Severity Breakdown Strip */}
      <div className="px-5 py-2.5 bg-slate-950/40 border-b border-white/5 flex flex-wrap items-center gap-4 text-xs font-semibold">
        <span className="text-slate-400 text-[11px] uppercase tracking-wider">
          Findings:
        </span>
        <span
          data-testid="count-critical"
          className={`flex items-center gap-1 px-2 py-0.5 rounded ${
            summary.critical > 0
              ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
              : "text-slate-500"
          }`}
        >
          {summary.critical} Critical
        </span>
        <span
          data-testid="count-high"
          className={`flex items-center gap-1 px-2 py-0.5 rounded ${
            summary.high > 0
              ? "bg-orange-500/20 text-orange-300 border border-orange-500/30"
              : "text-slate-500"
          }`}
        >
          {summary.high} High
        </span>
        <span
          data-testid="count-medium"
          className={`flex items-center gap-1 px-2 py-0.5 rounded ${
            summary.medium > 0
              ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
              : "text-slate-500"
          }`}
        >
          {summary.medium} Medium
        </span>
        <span
          data-testid="count-low"
          className="text-slate-500 px-2 py-0.5"
        >
          {summary.low} Low
        </span>
      </div>

      {/* Expanded Vulnerabilities List */}
      {isExpanded && (
        <div className="p-5 space-y-4">
          {findings.length === 0 ? (
            <div
              data-testid="audit-clean-state"
              className="p-6 rounded-xl bg-emerald-500/5 border border-emerald-500/20 text-emerald-300 flex items-center gap-3"
            >
              <CheckCircle2 size={20} className="text-emerald-400 shrink-0" />
              <div className="text-xs">
                <span className="font-bold">Contract Security Verified:</span> No
                missing authorization checks, TTL decay risks, or unchecked arithmetic
                detected in current buffer.
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {findings.map((finding) => (
                <div
                  key={finding.id}
                  data-testid={`vulnerability-card-${finding.ruleName}`}
                  className="rounded-xl border border-white/5 bg-slate-950/60 p-4 space-y-3 transition hover:border-white/10"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                          finding.severity === "critical"
                            ? "bg-rose-500/10 border-rose-500/30 text-rose-400"
                            : finding.severity === "high"
                            ? "bg-orange-500/10 border-orange-500/30 text-orange-400"
                            : "bg-amber-500/10 border-amber-500/30 text-amber-400"
                        }`}
                      >
                        {finding.severity}
                      </span>
                      <h3 className="text-xs font-bold text-slate-100">
                        {finding.title}
                      </h3>
                    </div>

                    {finding.lineNumber && (
                      <span className="text-[10px] font-mono text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-white/5">
                        Line {finding.lineNumber}
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-slate-400 leading-relaxed">
                    {finding.description}
                  </p>

                  {finding.snippet && (
                    <div className="rounded-lg bg-slate-950 p-2.5 font-mono text-[11px] text-rose-300 border border-rose-500/20 flex items-center gap-2">
                      <Terminal size={12} className="text-slate-500 shrink-0" />
                      <code className="truncate">{finding.snippet}</code>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-white/5">
                    <div className="flex items-center gap-1.5 text-xs text-slate-300">
                      <Info size={12} className="text-violet-400 shrink-0" />
                      <span className="font-semibold text-slate-400">Fix:</span>
                      <span>{finding.remediation}</span>
                    </div>

                    {finding.quickFix && onApplyQuickFix && (
                      <button
                        type="button"
                        data-testid={`quick-fix-btn-${finding.ruleName}`}
                        onClick={() => handleApplySingleFix(finding)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600/90 hover:bg-violet-600 text-white text-xs font-bold transition shadow-sm active:scale-95"
                      >
                        <Zap size={12} className="text-amber-300" />
                        <span>{finding.quickFix.label}</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
