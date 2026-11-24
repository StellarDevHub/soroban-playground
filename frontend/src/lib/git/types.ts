// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Domain model for the in-app Git engine (issue #1727 / FE-27).
 *
 * The playground keeps a *lightweight* Git repository in memory: a map of
 * branches, a map of commits (each commit owns an immutable snapshot of the
 * project files) and a mutable working tree that mirrors the editor buffer.
 *
 * Everything in this module is plain data — the reducer-style operations live
 * in `repository.ts` so they can be unit tested without React or the DOM.
 */

/** Flat map of project file path → file content. */
export type GitTree = Record<string, string>;

/** Identity attached to every commit. */
export interface GitAuthor {
  /** Display name, e.g. `"Ada Lovelace"`. */
  name: string;
  /** Email used for the commit footer. */
  email: string;
  /** Optional avatar URL rendered next to the commit in the graph. */
  avatarUrl?: string;
}

/** A single immutable commit. */
export interface GitCommit {
  /** Deterministic 40-hex id derived from the commit contents. */
  id: string;
  /** Parent commit ids — empty for the root commit, two for a merge. */
  parents: string[];
  /** Snapshot of the project files at the time of the commit. */
  tree: GitTree;
  /** Commit subject / body. */
  message: string;
  /** Who authored the commit. */
  author: GitAuthor;
  /** Epoch milliseconds. */
  timestamp: number;
}

/** A named pointer to a commit. */
export interface GitBranch {
  /** Branch name, e.g. `"feature/hello"`. */
  name: string;
  /** Commit id the branch points at, or `null` for an unborn branch. */
  head: string | null;
  /** Remote-tracking branch name, when the branch is published. */
  upstream?: string;
  /** Marks the branch that is checked out in the working tree. */
  isCurrent?: boolean;
}

/** Remote repository the workspace is linked to. */
export interface GitRemoteConfig {
  /** GitHub owner (user or organisation). */
  owner: string;
  /** GitHub repository name. */
  repo: string;
  /** Remote name shown in the UI — always `"origin"` for now. */
  name: string;
}

/** Last push known to the in-app repository for a single branch. */
export interface RemoteBranchTracking {
  /** Commit SHA the remote branch pointed at after the push. */
  sha: string;
  /** Local commit id that produced `sha`, when one is known. */
  localCommitId: string | null;
}

/** Per-file status reported by {@link getWorkingTreeStatus}. */
export type GitFileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "conflicted"
  | "clean";

/** Status of a single path relative to `HEAD`. */
export interface GitFileStatusEntry {
  /** Project relative path, e.g. `"src/lib.rs"`. */
  path: string;
  /** Status of the path. */
  status: GitFileStatus;
  /** `true` when the change has been staged for the next commit. */
  staged: boolean;
}

/** Result of a three-way merge for a single file. */
export interface MergeFileResult {
  /** Project relative path. */
  path: string;
  /** `clean` when the merge succeeded, `conflict` otherwise. */
  status: "clean" | "conflict";
  /** Merged content (for conflicts: the content with conflict markers). */
  content: string;
  /** Conflicting hunks, present when `status === "conflict"`. */
  conflicts: ConflictHunk[];
}

/** A single conflict region inside a file. */
export interface ConflictHunk {
  /** Stable id (`"conflict-1"`, `"conflict-2"`, …) used by the UI + tests. */
  id: string;
  /** Zero-based line index of the `<<<<<<<` marker. */
  startLine: number;
  /** Zero-based line index of the `>>>>>>>` marker. */
  endLine: number;
  /** Label written after the `<<<<<<<` marker (usually the current branch). */
  currentLabel: string;
  /** Label written after the `>>>>>>>` marker (usually the merged branch). */
  incomingLabel: string;
  /** Lines belonging to the *current* side. */
  currentLines: string[];
  /** Lines belonging to the *incoming* side. */
  incomingLines: string[];
  /** Base lines, only present for `diff3`-style conflict markers. */
  baseLines: string[] | null;
}

/** How the user resolved a single conflict hunk. */
export type ConflictResolution = "current" | "incoming" | "combined";

/** Outcome of a branch merge. */
export interface MergeResult {
  /** `clean` when the merge applied without conflicts. */
  status: "clean" | "conflict";
  /** The repository state after the merge (merge commit included when clean). */
  state: GitState;
  /** Files that could not be merged automatically. */
  conflicts: MergeFileResult[];
  /** Commit id of the merge commit — `null` when the merge conflicted. */
  mergeCommitId: string | null;
  /** Human readable summary. */
  message: string;
}

/** Outcome of a rebase. */
export interface RebaseResult {
  /** `clean` when every commit replayed without conflicts. */
  status: "clean" | "conflict";
  /** The repository state after the rebase (only updated when clean). */
  state: GitState;
  /** Files that could not be replayed automatically. */
  conflicts: MergeFileResult[];
  /** Commit ids of the replayed commits, in order. */
  replayedCommitIds: string[];
  /** Human readable summary. */
  message: string;
}

/** The complete in-app repository. */
export interface GitState {
  /** All known branches keyed by name. */
  branches: Record<string, GitBranch>;
  /** Name of the checked-out branch. */
  currentBranch: string;
  /** All known commits keyed by id. */
  commits: Record<string, GitCommit>;
  /** Id of the commit `currentBranch` points at. */
  head: string | null;
  /** Files currently open in the editor (dirty, not yet committed). */
  workingTree: GitTree;
  /** Files staged for the next commit. */
  stagedTree: GitTree;
  /** Remote repository the workspace is linked to, when configured. */
  remote: GitRemoteConfig | null;
  /** Commit ids that have already been pushed to the remote. */
  pushedCommits: string[];
  /** Remote branch HEADs last observed by a push, keyed by branch name. */
  remoteHeads: Record<string, RemoteBranchTracking>;
}

/** A node of the visual commit graph. */
export interface CommitGraphNode {
  /** Commit id. */
  id: string;
  /** Commit message subject. */
  message: string;
  /** Commit author. */
  author: GitAuthor;
  /** Epoch milliseconds. */
  timestamp: number;
  /** Lane the commit is rendered in (0 = left-most). */
  lane: number;
  /** Vertical position (row index) inside the graph. */
  row: number;
  /** Branches pointing at this commit. */
  branchNames: string[];
  /** `true` when the commit is the tip of its branch. */
  isTip: boolean;
  /** `true` when the commit is the `HEAD` of the checked-out branch. */
  isHead: boolean;
  /** `true` when the commit is a merge commit (two parents). */
  isMerge: boolean;
  /** `true` when the commit was already pushed to the remote. */
  isPushed: boolean;
}

/** An edge of the visual commit graph. */
export interface CommitGraphEdge {
  /** Commit id of the parent. */
  from: string;
  /** Commit id of the child. */
  to: string;
  /** Lane the edge is drawn in. */
  lane: number;
}

/** The rendered shape of the commit graph. */
export interface CommitGraph {
  /** Nodes ordered newest-first. */
  nodes: CommitGraphNode[];
  /** Edges connecting parents to children. */
  edges: CommitGraphEdge[];
  /** Number of lanes the graph uses. */
  laneCount: number;
}
