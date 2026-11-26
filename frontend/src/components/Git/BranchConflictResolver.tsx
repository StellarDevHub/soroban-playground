"use client";

/**
 * BranchConflictResolver – the in-app Git interface (issue #1727 / FE-27).
 *
 * The panel bundles everything a developer needs to work with branches without
 * leaving the playground:
 *
 *  - a live commit graph rendered as SVG branches,
 *  - branch creation, checkout, merge and rebase,
 *  - a three-way split merge conflict editor,
 *  - a file explorer with live dirty-file indicators,
 *  - GitHub authentication and push / pull through the Octokit client.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  LoaderCircle,
  Plus,
  RefreshCw,
} from "lucide-react";
import FileTree from "@/components/FileTree";
import CommitGraph from "@/components/Git/CommitGraph";
import CommitDiffReview from "@/components/Git/CommitDiffReview";
import ConflictEditor from "@/components/Git/ConflictEditor";
import GitHubRemotePanel from "@/components/Git/GitHubRemotePanel";
import { buildFileTreeNodes } from "@/lib/git/fileTree";
import {
  getCommitGraph,
  getCommitHistory,
  getUnpushedCommits,
  getWorkingTreeStatus,
  hasUncommittedChanges,
} from "@/lib/git/repository";
import {
  createPullRequest,
  getRemoteBranchHead,
  pullBranch as pullRemoteBranch,
  pushBranch as pushRemoteBranch,
  validateBranchName,
  type GitHubClient,
  type PullRequestDraft,
  type PullRequestResult,
} from "@/lib/git/github";
import type {
  GitAuthor,
  GitRemoteConfig,
} from "@/lib/git/types";
import {
  DEFAULT_PROJECT_FILE,
  useGitStore,
} from "@/state/gitStore";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface BranchConflictResolverProps {
  /**
   * Content of the editor buffer. It is mirrored into the Git working tree so
   * the explorer can show live dirty indicators.
   */
  code?: string;
  /**
   * Project relative path the editor buffer belongs to.
   * Defaults to `"src/lib.rs"`.
   */
  filePath?: string;
  /**
   * Called when the repository produces content that has to be written back
   * into the editor (after a checkout, a merge resolution or a pull).
   */
  onApplyCode?: (content: string) => void;
  /** Identity used for new commits. */
  author?: Partial<GitAuthor>;
}

// ---------------------------------------------------------------------------
// BranchConflictResolver
// ---------------------------------------------------------------------------

const BranchConflictResolver: React.FC<BranchConflictResolverProps> = ({
  code,
  filePath = DEFAULT_PROJECT_FILE,
  onApplyCode,
  author,
}) => {
  const repo = useGitStore((state) => state.repo);
  const storeAuthor = useGitStore((state) => state.author);
  const conflicts = useGitStore((state) => state.conflicts);
  const resolutions = useGitStore((state) => state.resolutions);
  const combinedText = useGitStore((state) => state.combinedText);
  const mergeSourceBranch = useGitStore((state) => state.mergeSourceBranch);
  const lastMessage = useGitStore((state) => state.lastMessage);
  const error = useGitStore((state) => state.error);

  const [commitMessage, setCommitMessage] = useState("");
  const [newBranchName, setNewBranchName] = useState("");
  const [targetBranch, setTargetBranch] = useState("");
  const [remoteStatus, setRemoteStatus] = useState<string | null>(null);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [isRemoteBusy, setIsRemoteBusy] = useState(false);
  const [selectedCommitId, setSelectedCommitId] = useState<string | null>(null);
  const [review, setReview] = useState({ key: "", reviewed: false });
  const [prUrl, setPrUrl] = useState<string | null>(null);

  // ── Author identity ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!author) return;
    useGitStore.getState().setAuthor(author);
  }, [author?.name, author?.email, author?.avatarUrl]);

  // ── Seed the repository with an initial commit ────────────────────────────
  useEffect(() => {
    const store = useGitStore.getState();
    if (store.repo.head !== null) return;
    const seed = code ?? "";
    store.setFile(filePath, seed);
    useGitStore.getState().commit("Initial commit");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Mirror the editor buffer into the working tree ────────────────────────
  useEffect(() => {
    if (code === undefined) return;
    const store = useGitStore.getState();
    if (store.repo.workingTree[filePath] === code) return;
    store.setFile(filePath, code);
  }, [code, filePath]);

  const branchNames = useMemo(
    () => Object.keys(repo.branches).sort(),
    [repo.branches],
  );

  const otherBranches = useMemo(
    () => branchNames.filter((name) => name !== repo.currentBranch),
    [branchNames, repo.currentBranch],
  );

  const effectiveTarget = targetBranch || otherBranches[0] || "";

  const graph = useMemo(() => getCommitGraph(repo), [repo]);

  const status = useMemo(() => getWorkingTreeStatus(repo), [repo]);

  const treeNodes = useMemo(
    () =>
      buildFileTreeNodes(
        Array.from(
          new Set([
            ...Object.keys(repo.workingTree),
            ...status.map((entry) => entry.path),
          ]),
        ),
        status,
      ),
    [repo.workingTree, status],
  );

  const dirtyCount = status.filter(
    (entry) => entry.status !== "clean" && !entry.staged,
  ).length;

  const changeKey = status
    .map((entry) => `${entry.path}:${entry.status}:${entry.staged}`)
    .join("|");
  const reviewed = review.reviewed && review.key === changeKey;

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleCommit = useCallback(() => {
    const message = commitMessage.trim();
    if (!message || !reviewed) return;
    useGitStore.getState().commit(message);
    setCommitMessage("");
    setReview({ key: "", reviewed: false });
  }, [commitMessage, reviewed]);

  const handleCreateBranch = useCallback(() => {
    const name = newBranchName.trim();
    if (!name) return;
    useGitStore.getState().createBranch(name);
    setNewBranchName("");
  }, [newBranchName]);

  const handleCheckout = useCallback(
    (name: string) => {
      if (!name) return;
      useGitStore.getState().checkoutBranch(name);
      const content = useGitStore.getState().repo.workingTree[filePath];
      if (typeof content === "string") onApplyCode?.(content);
    },
    [filePath, onApplyCode],
  );

  const handleMerge = useCallback(() => {
    if (!effectiveTarget) return;
    useGitStore.getState().mergeBranch(effectiveTarget);
  }, [effectiveTarget]);

  const handleRebase = useCallback(() => {
    if (!effectiveTarget) return;
    useGitStore.getState().rebaseBranch(effectiveTarget);
  }, [effectiveTarget]);

  const handleCommitMerge = useCallback(() => {
    useGitStore.getState().commitMerge();
    const content = useGitStore.getState().repo.workingTree[filePath];
    if (typeof content === "string") onApplyCode?.(content);
  }, [filePath, onApplyCode]);

  const handleCancelMerge = useCallback(() => {
    useGitStore.getState().cancelMerge();
  }, []);

  const handleResolutionChange = useCallback(
    (path: string, hunkId: string, resolution: "current" | "incoming" | "combined") => {
      useGitStore.getState().setResolution(path, hunkId, resolution);
    },
    [],
  );

  const handleCombinedTextChange = useCallback(
    (path: string, hunkId: string, text: string) => {
      useGitStore.getState().setCombinedText(path, hunkId, text);
    },
    [],
  );

  const handleRemoteChange = useCallback((remote: GitRemoteConfig | null) => {
    useGitStore.getState().setRemote(remote);
    setRemoteStatus(null);
    setRemoteError(null);
  }, []);

  const handlePush = useCallback(
    async (client: GitHubClient, remote: GitRemoteConfig) => {
      setIsRemoteBusy(true);
      setRemoteError(null);
      setRemoteStatus(null);
      try {
        const store = useGitStore.getState();
        const branch = store.repo.currentBranch;
        const history = getCommitHistory(store.repo, branch).slice().reverse();
        if (history.length === 0) {
          throw new Error("There is nothing to push — commit your changes first.");
        }

        const tip = history[history.length - 1];
        const tracking = store.repo.remoteHeads[branch];
        let expectedHeadSha: string | null = tracking?.sha ?? null;
        let parentSha: string | null = tracking?.sha ?? null;
        let commits = getUnpushedCommits(store.repo, branch);

        if (!tracking) {
          parentSha = await getRemoteBranchHead(client, {
            owner: remote.owner,
            repo: remote.repo,
            branch,
          });
          expectedHeadSha = parentSha;
          commits = parentSha ? [tip] : history;
        } else if (commits.length === 0) {
          setRemoteStatus(`Branch "${branch}" is already up to date.`);
          return;
        } else if (
          tracking.localCommitId &&
          !history.some((commit) => commit.id === tracking.localCommitId)
        ) {
          commits = [tip];
        }

        const result = await pushRemoteBranch(client, {
          owner: remote.owner,
          repo: remote.repo,
          branch,
          commits,
          tree: tip.tree,
          parentSha,
          expectedHeadSha,
        });
        store.recordPush({
          branch,
          sha: result.sha,
          localCommitId: tip.id,
          commitIds: commits.map((commit) => commit.id),
        });
        setRemoteStatus(
          `Pushed ${commits.length} commit(s) to ${remote.owner}/${remote.repo} (${result.sha.slice(0, 7)}).`,
        );
      } catch (cause) {
        setRemoteError(
          cause instanceof Error ? cause.message : "The push failed.",
        );
        throw cause;
      } finally {
        setIsRemoteBusy(false);
      }
    },
    [],
  );

  const handlePublishPR = useCallback(
    async (
      client: GitHubClient,
      remote: GitRemoteConfig,
      draft: PullRequestDraft,
    ): Promise<PullRequestResult> => {
      setIsRemoteBusy(true);
      setRemoteError(null);
      setRemoteStatus(null);
      try {
        const branch = validateBranchName(draft.branch);
        const base = validateBranchName(draft.base);
        const title = draft.title.trim();
        if (!title) throw new Error("A pull request title is required.");

        const store = useGitStore.getState();
        if (hasUncommittedChanges(store.repo)) {
          store.commit(title);
        }
        if (useGitStore.getState().repo.branches[branch]) {
          throw new Error(`The branch "${branch}" already exists locally.`);
        }

        store.createBranch(branch);
        store.checkoutBranch(branch);
        const current = useGitStore.getState().repo;
        const tip = current.head ? current.commits[current.head] : null;
        if (!tip) {
          throw new Error("Commit your changes before creating a pull request.");
        }

        const baseSha = await getRemoteBranchHead(client, {
          owner: remote.owner,
          repo: remote.repo,
          branch: base,
        });
        const pushed = await pushRemoteBranch(client, {
          owner: remote.owner,
          repo: remote.repo,
          branch,
          commits: [tip],
          tree: tip.tree,
          parentSha: baseSha,
          expectedHeadSha: null,
        });
        const pr = await createPullRequest(client, {
          owner: remote.owner,
          repo: remote.repo,
          title,
          head: branch,
          base,
          body: draft.body,
        });
        useGitStore.getState().recordPush({
          branch,
          sha: pushed.sha,
          localCommitId: tip.id,
          commitIds: [tip.id],
        });
        setPrUrl(pr.url);
        setRemoteStatus(`Created PR #${pr.number}: ${pr.url}`);
        return pr;
      } catch (cause) {
        setRemoteError(
          cause instanceof Error ? cause.message : "The pull request failed.",
        );
        throw cause;
      } finally {
        setIsRemoteBusy(false);
      }
    },
    [],
  );

  const handlePull = useCallback(
    async (client: GitHubClient, remote: GitRemoteConfig) => {
      setIsRemoteBusy(true);
      setRemoteError(null);
      setRemoteStatus(null);
      try {
        const store = useGitStore.getState();
        const result = await pullRemoteBranch(client, {
          owner: remote.owner,
          repo: remote.repo,
          branch: store.repo.currentBranch,
        });
        for (const file of result.files) {
          store.setFile(file.path, file.content);
        }
        const main = result.files.find((file) => file.path === filePath);
        if (main) onApplyCode?.(main.content);
        setRemoteStatus(
          `Pulled ${result.files.length} file(s) from ${remote.owner}/${remote.repo}.`,
        );
      } catch (cause) {
        setRemoteError(
          cause instanceof Error ? cause.message : "The pull failed.",
        );
        throw cause;
      } finally {
        setIsRemoteBusy(false);
      }
    },
    [filePath, onApplyCode],
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <section
      data-testid="branch-conflict-resolver"
      className="space-y-4 rounded-2xl border border-white/8 bg-white/5 p-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
            <GitBranch size={14} />
            Version Control
          </p>
          <p className="mt-1 text-sm text-slate-300">
            Branch, commit and merge without leaving the playground.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            data-testid="current-branch"
            className="inline-flex items-center gap-1.5 rounded-full border border-teal-400/30 bg-teal-400/10 px-3 py-1 font-mono text-xs text-teal-200"
          >
            <GitBranch size={12} />
            {repo.currentBranch}
          </span>
          {dirtyCount > 0 && (
            <span
              data-testid="dirty-count"
              className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs text-amber-200"
            >
              {dirtyCount} uncommitted
            </span>
          )}
        </div>
      </header>

      {/* ── Branch actions ────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-white/8 bg-slate-950/50 p-3">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
          Branches
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <input
            data-testid="new-branch-input"
            value={newBranchName}
            onChange={(event) => setNewBranchName(event.target.value)}
            placeholder="feature/my-branch"
            aria-label="New branch name"
            className="min-w-[160px] flex-1 rounded-xl border border-white/10 bg-slate-950/70 px-3 py-1.5 font-mono text-xs text-slate-200 outline-none focus:border-teal-400/50"
          />
          <button
            type="button"
            data-testid="create-branch"
            onClick={handleCreateBranch}
            disabled={newBranchName.trim().length === 0}
            className="inline-flex items-center gap-1.5 rounded-full border border-teal-400/30 bg-teal-400/10 px-3 py-1.5 text-xs font-medium text-teal-200 transition hover:bg-teal-400/20 disabled:opacity-40"
          >
            <Plus size={12} />
            New branch
          </button>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            data-testid="branch-select"
            value={effectiveTarget}
            onChange={(event) => setTargetBranch(event.target.value)}
            aria-label="Target branch"
            className="min-w-[160px] rounded-xl border border-white/10 bg-slate-950/70 px-3 py-1.5 font-mono text-xs text-slate-200 outline-none focus:border-teal-400/50"
          >
            {otherBranches.length === 0 ? (
              <option value="">No other branches</option>
            ) : (
              otherBranches.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))
            )}
          </select>
          <button
            type="button"
            data-testid="checkout-branch"
            onClick={() => handleCheckout(effectiveTarget)}
            disabled={!effectiveTarget}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-teal-400/40 hover:text-teal-200 disabled:opacity-40"
          >
            <RefreshCw size={12} />
            Checkout
          </button>
          <button
            type="button"
            data-testid="merge-branch"
            onClick={handleMerge}
            disabled={!effectiveTarget || conflicts.length > 0}
            className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-xs font-medium text-emerald-200 transition hover:bg-emerald-400/20 disabled:opacity-40"
          >
            <GitMerge size={12} />
            Merge
          </button>
          <button
            type="button"
            data-testid="rebase-branch"
            onClick={handleRebase}
            disabled={!effectiveTarget || conflicts.length > 0}
            className="inline-flex items-center gap-1.5 rounded-full border border-violet-400/30 bg-violet-400/10 px-3 py-1.5 text-xs font-medium text-violet-200 transition hover:bg-violet-400/20 disabled:opacity-40"
          >
            <GitPullRequest size={12} />
            Rebase
          </button>
        </div>
      </div>

      {/* ── Diff review ──────────────────────────────────────────────────── */}
      <CommitDiffReview
        state={repo}
        reviewed={reviewed}
        onReviewedChange={(value) => setReview({ key: changeKey, reviewed: value })}
      />

      {/* ── Commit ────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-white/8 bg-slate-950/50 p-3">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
          Commit
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            data-testid="commit-message-input"
            value={commitMessage}
            onChange={(event) => setCommitMessage(event.target.value)}
            placeholder="Describe your change…"
            aria-label="Commit message"
            className="min-w-[200px] flex-1 rounded-xl border border-white/10 bg-slate-950/70 px-3 py-1.5 text-xs text-slate-200 outline-none focus:border-teal-400/50"
          />
          <button
            type="button"
            data-testid="commit-button"
            onClick={handleCommit}
            disabled={commitMessage.trim().length === 0 || !reviewed || dirtyCount === 0}
            className="inline-flex items-center gap-1.5 rounded-full border border-teal-400/30 bg-teal-400/10 px-3 py-1.5 text-xs font-medium text-teal-200 transition hover:bg-teal-400/20 disabled:opacity-40"
          >
            <GitCommitHorizontal size={12} />
            Commit
          </button>
        </div>
        <p className="mt-1 text-[10px] text-slate-500">
          Signed as {storeAuthor.name} · {storeAuthor.email}
        </p>
      </div>

      {/* ── Commit graph ──────────────────────────────────────────────────── */}
      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
          History
        </p>
        <CommitGraph
          graph={graph}
          selectedCommitId={selectedCommitId}
          onSelectCommit={setSelectedCommitId}
        />
      </div>

      {/* ── File explorer with dirty indicators ───────────────────────────── */}
      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
          Project files
        </p>
        <FileTree
          nodes={treeNodes}
          activeNodeId={filePath}
          className="max-h-56 overflow-y-auto rounded-xl border border-white/8 bg-slate-950/50 p-2"
        />
      </div>

      {/* ── Conflicts ─────────────────────────────────────────────────────── */}
      {conflicts.length > 0 && (
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-amber-200">
            <AlertTriangle size={13} />
            {conflicts.length} conflicted file
            {conflicts.length === 1 ? "" : "s"}
            {mergeSourceBranch ? ` · merging ${mergeSourceBranch}` : ""}
          </p>

          {conflicts.map((conflict) => (
            <ConflictEditor
              key={conflict.path}
              path={conflict.path}
              content={conflict.content}
              resolutions={resolutions[conflict.path] ?? {}}
              combinedTexts={combinedText[conflict.path] ?? {}}
              onResolutionChange={(hunkId, resolution) =>
                handleResolutionChange(conflict.path, hunkId, resolution)
              }
              onCombinedTextChange={(hunkId, text) =>
                handleCombinedTextChange(conflict.path, hunkId, text)
              }
            />
          ))}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="commit-merge"
              onClick={handleCommitMerge}
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-xs font-medium text-emerald-200 transition hover:bg-emerald-400/20"
            >
              <CheckCircle2 size={13} />
              Commit merge
            </button>
            <button
              type="button"
              data-testid="cancel-merge"
              onClick={handleCancelMerge}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-rose-400/40 hover:text-rose-200"
            >
              Abort merge
            </button>
          </div>
        </div>
      )}

      {/* ── Status ────────────────────────────────────────────────────────── */}
      {lastMessage && !error && (
        <p
          data-testid="git-status-message"
          className="flex items-center gap-2 rounded-lg border border-emerald-400/20 bg-emerald-400/5 px-3 py-2 text-xs text-emerald-200"
        >
          <CheckCircle2 size={13} />
          {lastMessage}
        </p>
      )}
      {error && (
        <p
          data-testid="git-error-message"
          className="flex items-center gap-2 rounded-lg border border-rose-400/25 bg-rose-400/5 px-3 py-2 text-xs text-rose-200"
        >
          <AlertTriangle size={13} />
          {error}
        </p>
      )}

      {/* ── GitHub remote ─────────────────────────────────────────────────── */}
      <GitHubRemotePanel
        remote={repo.remote}
        onRemoteChange={handleRemoteChange}
        branch={repo.currentBranch}
        onPush={handlePush}
        onPull={handlePull}
        onPublishPR={handlePublishPR}
        prUrl={prUrl}
        busy={isRemoteBusy}
      />

      {remoteStatus && (
        <p
          data-testid="git-remote-status"
          className="rounded-lg border border-emerald-400/20 bg-emerald-400/5 px-3 py-2 text-xs text-emerald-200"
        >
          {remoteStatus}
        </p>
      )}
      {remoteError && (
        <p
          data-testid="git-remote-error"
          className="flex items-center gap-2 rounded-lg border border-rose-400/25 bg-rose-400/5 px-3 py-2 text-xs text-rose-200"
        >
          <LoaderCircle size={13} className="animate-spin" />
          {remoteError}
        </p>
      )}
    </section>
  );
};

export default BranchConflictResolver;
