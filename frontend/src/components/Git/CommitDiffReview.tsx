"use client";

/**
 * CommitDiffReview – per-file diff shown before a commit is created.
 *
 * The review is intentionally gated: a commit can only be created after the
 * user acknowledges the diff, which prevents accidental commits of changes
 * that were never inspected.
 */

import React, { useMemo } from "react";
import { diffLines, type DiffChunk } from "@/lib/git/diff";
import { getWorkingTreeStatus } from "@/lib/git/repository";
import type { GitState } from "@/lib/git/types";

export interface CommitDiffReviewProps {
  /** Repository whose working tree is reviewed. */
  state: GitState;
  /** Whether the user acknowledged the diff. */
  reviewed: boolean;
  /** Fired when the acknowledgement changes. */
  onReviewedChange: (reviewed: boolean) => void;
}

interface FileDiff {
  path: string;
  status: string;
  chunks: DiffChunk[];
  additions: number;
  deletions: number;
}

/** Build the per-file diff of the working tree against `HEAD`. */
export function buildCommitDiff(state: GitState): FileDiff[] {
  const headCommit = state.head ? state.commits[state.head] : undefined;
  const baseTree = headCommit?.tree ?? {};

  return getWorkingTreeStatus(state).map((entry) => {
    const before = baseTree[entry.path] ?? "";
    const after = state.workingTree[entry.path] ?? "";
    const chunks = diffLines(before.split("\n"), after.split("\n"));
    return {
      path: entry.path,
      status: entry.status,
      chunks,
      additions: chunks
        .filter((chunk) => chunk.op === "insert")
        .reduce((total, chunk) => total + chunk.lines.length, 0),
      deletions: chunks
        .filter((chunk) => chunk.op === "delete")
        .reduce((total, chunk) => total + chunk.lines.length, 0),
    };
  });
}

const CommitDiffReview: React.FC<CommitDiffReviewProps> = ({
  state,
  reviewed,
  onReviewedChange,
}) => {
  const diffs = useMemo(() => buildCommitDiff(state), [state]);
  const totalAdditions = diffs.reduce((sum, diff) => sum + diff.additions, 0);
  const totalDeletions = diffs.reduce((sum, diff) => sum + diff.deletions, 0);

  return (
    <div
      data-testid="commit-diff-review"
      className="rounded-xl border border-white/8 bg-slate-950/50 p-3"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
          Review changes
        </p>
        <p className="font-mono text-[10px] text-slate-500">
          <span data-testid="diff-additions" className="text-emerald-300">
            +{totalAdditions}
          </span>{" "}
          <span data-testid="diff-deletions" className="text-rose-300">
            -{totalDeletions}
          </span>
        </p>
      </div>

      {diffs.length === 0 ? (
        <p
          data-testid="commit-diff-empty"
          className="text-xs text-slate-500"
        >
          No changes to review.
        </p>
      ) : (
        <div className="max-h-64 space-y-3 overflow-y-auto">
          {diffs.map((diff) => (
            <div
              key={diff.path}
              data-testid="commit-diff-file"
              className="overflow-hidden rounded-lg border border-white/8"
            >
              <p className="flex items-center justify-between gap-2 bg-white/5 px-2 py-1 font-mono text-[10px] text-slate-300">
                <span>{diff.path}</span>
                <span className="text-slate-500">{diff.status}</span>
              </p>
              <pre className="overflow-x-auto px-2 py-1 font-mono text-[10px] leading-5">
                {diff.chunks.flatMap((chunk, chunkIndex) =>
                  chunk.lines.map((line, lineIndex) => (
                    <span
                      key={`${chunkIndex}-${lineIndex}`}
                      data-testid={
                        chunk.op === "insert"
                          ? "commit-diff-add"
                          : chunk.op === "delete"
                            ? "commit-diff-delete"
                            : "commit-diff-context"
                      }
                      className={
                        chunk.op === "insert"
                          ? "block bg-emerald-400/10 text-emerald-200"
                          : chunk.op === "delete"
                            ? "block bg-rose-400/10 text-rose-200"
                            : "block text-slate-500"
                      }
                    >
                      {chunk.op === "insert"
                        ? "+ "
                        : chunk.op === "delete"
                          ? "- "
                          : "  "}
                      {line || "\u00a0"}
                    </span>
                  )),
                )}
              </pre>
            </div>
          ))}
        </div>
      )}

      <label className="mt-3 flex items-center gap-2 text-xs text-slate-300">
        <input
          type="checkbox"
          data-testid="diff-reviewed-checkbox"
          checked={reviewed}
          onChange={(event) => onReviewedChange(event.target.checked)}
          disabled={diffs.length === 0}
          className="h-3.5 w-3.5 accent-teal-400"
        />
        I reviewed the diff above
      </label>
    </div>
  );
};

export default CommitDiffReview;
