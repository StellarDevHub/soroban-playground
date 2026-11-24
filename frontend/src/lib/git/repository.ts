// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * In-app Git engine (issue #1727 / FE-27).
 *
 * The playground keeps a miniature Git repository in memory. Every operation is
 * a pure function that returns a new {@link GitState}, which makes the whole
 * branch/merge/rebase workflow trivially unit testable and lets the UI stay
 * reactive through a single Zustand store.
 */

import { threeWayMerge } from "./merge";
import type {
  CommitGraph,
  CommitGraphEdge,
  CommitGraphNode,
  GitAuthor,
  GitBranch,
  GitCommit,
  GitFileStatus,
  GitFileStatusEntry,
  GitState,
  GitTree,
  MergeFileResult,
  RemoteBranchTracking,
  MergeResult,
  RebaseResult,
} from "./types";

/** Default branch created together with a fresh repository. */
export const DEFAULT_BRANCH = "main";

/**
 * Deterministic 160-bit content hash rendered as 40 hex characters.
 *
 * Git uses SHA-1 for object ids; a FNV based hash keeps the engine dependency
 * free while still producing stable, collision resistant ids.
 */
export function hashContent(input: string): string {
  const seeds = [
    0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35,
  ];
  let out = "";
  for (const seed of seeds) {
    let hash = seed >>> 0;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    out += hash.toString(16).padStart(8, "0");
  }
  return out;
}

/** Serialise a tree deterministically so hashes are stable. */
function serializeTree(tree: GitTree): string {
  return Object.keys(tree)
    .sort()
    .map((path) => `${path}\u0000${tree[path]}`)
    .join("\u0001");
}

/** Build the payload that identifies a commit. */
function commitPayload(
  parents: string[],
  tree: GitTree,
  message: string,
  author: GitAuthor,
  timestamp: number,
): string {
  return [
    parents.join(" "),
    serializeTree(tree),
    message,
    author.name,
    author.email,
    String(timestamp),
  ].join("\u0002");
}

/** Create a commit object with a deterministic id. */
function makeCommit(input: {
  parents: string[];
  tree: GitTree;
  message: string;
  author: GitAuthor;
  timestamp: number;
}): GitCommit {
  const id = hashContent(
    commitPayload(
      input.parents,
      input.tree,
      input.message,
      input.author,
      input.timestamp,
    ),
  );
  return {
    id,
    parents: input.parents,
    tree: input.tree,
    message: input.message,
    author: input.author,
    timestamp: input.timestamp,
  };
}

/** Create an empty repository with a single branch. */
export function createInitialState(
  branchName: string = DEFAULT_BRANCH,
): GitState {
  return {
    branches: {
      [branchName]: { name: branchName, head: null, isCurrent: true },
    },
    currentBranch: branchName,
    commits: {},
    head: null,
    workingTree: {},
    stagedTree: {},
    remote: null,
    pushedCommits: [],
    remoteHeads: {},
  };
}

/** Options accepted by {@link commitChanges}. */
export interface CommitOptions {
  /** Commit message. */
  message: string;
  /** Author of the commit. */
  author: GitAuthor;
  /** Files to commit — defaults to the whole working tree. */
  files?: string[];
  /** Timestamp override, mostly useful for deterministic tests. */
  now?: number;
}

/** Result of {@link commitChanges}. */
export interface CommitResult {
  /** The new repository state. */
  state: GitState;
  /** Id of the created commit, `null` when nothing was committed. */
  commitId: string | null;
  /** Human readable message. */
  message: string;
}

/**
 * Commit the current working tree.
 *
 * When `files` is provided only those paths are committed — the remaining
 * changes stay in the working tree, exactly like `git commit <path>`.
 */
export function commitChanges(
  state: GitState,
  options: CommitOptions,
): CommitResult {
  const message = options.message.trim();
  if (!message) {
    return { state, commitId: null, message: "Commit message is required." };
  }

  const headCommit = state.head ? state.commits[state.head] : undefined;
  const baseTree: GitTree = headCommit ? headCommit.tree : {};

  const paths =
    options.files ??
    Array.from(
      new Set([...Object.keys(baseTree), ...Object.keys(state.workingTree)]),
    ).sort();

  const tree: GitTree = { ...baseTree };
  const changed: string[] = [];

  for (const path of paths) {
    const content = state.workingTree[path];
    if (content === undefined) {
      if (path in baseTree) {
        delete tree[path];
        changed.push(path);
      }
      continue;
    }
    if (baseTree[path] !== content) {
      tree[path] = content;
      changed.push(path);
    }
  }

  if (changed.length === 0) {
    return { state, commitId: null, message: "Nothing to commit." };
  }

  const timestamp = options.now ?? Date.now();
  const commit = makeCommit({
    parents: state.head ? [state.head] : [],
    tree,
    message,
    author: options.author,
    timestamp,
  });

  const nextState: GitState = {
    ...state,
    commits: { ...state.commits, [commit.id]: commit },
    head: commit.id,
    branches: {
      ...state.branches,
      [state.currentBranch]: {
        ...state.branches[state.currentBranch],
        head: commit.id,
      },
    },
    stagedTree: {},
  };

  return {
    state: nextState,
    commitId: commit.id,
    message: `Committed ${changed.length} file${changed.length === 1 ? "" : "s"}.`,
  };
}

/** Options accepted by {@link createBranch}. */
export interface CreateBranchOptions {
  /** Branch to create. */
  name: string;
  /** Commit the branch starts at — defaults to `HEAD`. */
  from?: string;
}

/** Create a new branch pointing at `from` (defaults to the current `HEAD`). */
export function createBranch(
  state: GitState,
  options: CreateBranchOptions,
): GitState {
  const name = options.name.trim();
  if (!name) return state;
  if (state.branches[name]) return state;

  const from = options.from ?? state.head;
  return {
    ...state,
    branches: {
      ...state.branches,
      [name]: { name, head: from ?? null },
    },
  };
}

/** Switch to another branch, carrying the working tree over. */
export function checkoutBranch(
  state: GitState,
  name: string,
): GitState {
  const branch = state.branches[name];
  if (!branch) return state;

  const headCommit = branch.head ? state.commits[branch.head] : undefined;
  const tree: GitTree = headCommit ? { ...headCommit.tree } : {};

  const branches: Record<string, GitBranch> = {};
  for (const [branchName, value] of Object.entries(state.branches)) {
    branches[branchName] = { ...value, isCurrent: branchName === name };
  }

  return {
    ...state,
    branches,
    currentBranch: name,
    head: branch.head ?? null,
    workingTree: tree,
    stagedTree: {},
  };
}

/** Remove a branch (the current branch cannot be removed). */
export function deleteBranch(state: GitState, name: string): GitState {
  if (name === state.currentBranch) return state;
  if (!state.branches[name]) return state;

  const branches = { ...state.branches };
  delete branches[name];
  return { ...state, branches };
}

/** Every ancestor of `commitId`, closest first. */
function ancestorsOf(
  state: GitState,
  commitId: string | null,
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  const queue = commitId ? [commitId] : [];

  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (seen.has(current)) continue;
    const commit = state.commits[current];
    if (!commit) continue;
    seen.add(current);
    result.push(current);
    queue.push(...commit.parents);
  }

  return result;
}

/** Find the best common ancestor of two commits. */
export function findMergeBase(
  state: GitState,
  left: string | null,
  right: string | null,
): string | null {
  if (!left || !right) return null;

  const leftAncestors = ancestorsOf(state, left);
  const rightAncestors = new Set(ancestorsOf(state, right));

  for (const candidate of leftAncestors) {
    if (rightAncestors.has(candidate)) return candidate;
  }

  return null;
}

/** Every file path that appears in any of the given trees. */
function unionPaths(trees: GitTree[]): string[] {
  const paths = new Set<string>();
  for (const tree of trees) {
    for (const path of Object.keys(tree)) paths.add(path);
  }
  return Array.from(paths).sort();
}

/** Merge two trees with a three-way merge, reporting the conflicts. */
function mergeTrees(
  base: GitTree,
  current: GitTree,
  incoming: GitTree,
  currentLabel: string,
  incomingLabel: string,
): { tree: GitTree; conflicts: MergeFileResult[] } {
  const tree: GitTree = {};
  const conflicts: MergeFileResult[] = [];

  for (const path of unionPaths([base, current, incoming])) {
    const baseContent = base[path] ?? "";
    const currentContent = current[path] ?? "";
    const incomingContent = incoming[path] ?? "";

    if (currentContent === incomingContent) {
      tree[path] = currentContent;
      continue;
    }

    const result = threeWayMerge(baseContent, currentContent, incomingContent, {
      currentLabel,
      incomingLabel,
    });

    if (result.status === "clean") {
      tree[path] = result.content;
      continue;
    }

    conflicts.push({
      path,
      status: "conflict",
      content: result.content,
      conflicts: result.conflicts,
    });
    tree[path] = result.content;
  }

  return { tree, conflicts };
}

/**
 * Merge `sourceBranch` into the currently checked-out branch.
 *
 * When the merge conflicts, the repository state is left untouched and the
 * caller has to resolve the conflicts and call {@link commitMerge}.
 */
export function mergeBranch(
  state: GitState,
  sourceBranch: string,
  author: GitAuthor,
  now?: number,
): MergeResult {
  const source = state.branches[sourceBranch];
  if (!source || !source.head) {
    return {
      status: "clean",
      state,
      conflicts: [],
      mergeCommitId: null,
      message: `Branch "${sourceBranch}" has no commits to merge.`,
    };
  }
  if (sourceBranch === state.currentBranch) {
    return {
      status: "clean",
      state,
      conflicts: [],
      mergeCommitId: null,
      message: "Cannot merge a branch into itself.",
    };
  }

  const currentHead = state.head;
  const baseId = findMergeBase(state, currentHead, source.head);

  if (baseId === source.head) {
    return {
      status: "clean",
      state,
      conflicts: [],
      mergeCommitId: null,
      message: `Branch "${sourceBranch}" is already merged into ${state.currentBranch}.`,
    };
  }

  const baseTree: GitTree = baseId ? state.commits[baseId].tree : {};

  const currentTree: GitTree = currentHead
    ? state.commits[currentHead].tree
    : {};
  const incomingTree: GitTree = state.commits[source.head].tree;

  const { tree, conflicts } = mergeTrees(
    baseTree,
    currentTree,
    incomingTree,
    state.currentBranch,
    sourceBranch,
  );

  if (conflicts.length > 0) {
    return {
      status: "conflict",
      state,
      conflicts,
      mergeCommitId: null,
      message: `Merge of "${sourceBranch}" produced ${conflicts.length} conflicted file(s).`,
    };
  }

  const commit = makeCommit({
    parents: currentHead ? [currentHead, source.head] : [source.head],
    tree,
    message: `Merge branch '${sourceBranch}' into ${state.currentBranch}`,
    author,
    timestamp: now ?? Date.now(),
  });

  const nextState: GitState = {
    ...state,
    commits: { ...state.commits, [commit.id]: commit },
    head: commit.id,
    branches: {
      ...state.branches,
      [state.currentBranch]: {
        ...state.branches[state.currentBranch],
        head: commit.id,
      },
    },
    workingTree: { ...tree },
    stagedTree: {},
  };

  return {
    status: "clean",
    state: nextState,
    conflicts: [],
    mergeCommitId: commit.id,
    message: `Merged "${sourceBranch}" into "${state.currentBranch}".`,
  };
}

/**
 * Create the merge commit after the conflicts have been resolved.
 *
 * `resolvedFiles` maps the conflicted path to its resolved content.
 */
export function commitMerge(
  state: GitState,
  options: {
    sourceBranch: string;
    resolvedFiles: Record<string, string>;
    author: GitAuthor;
    message?: string;
    now?: number;
  },
): CommitResult {
  const source = state.branches[options.sourceBranch];
  const headCommit = state.head ? state.commits[state.head] : undefined;
  const tree: GitTree = { ...(headCommit ? headCommit.tree : {}) };

  for (const [path, content] of Object.entries(options.resolvedFiles)) {
    tree[path] = content;
  }

  const message =
    options.message ??
    `Merge branch '${options.sourceBranch}' into ${state.currentBranch}`;

  const timestamp = options.now ?? Date.now();
  const parents = Array.from(
    new Set(
      [state.head, source?.head].filter((id): id is string => Boolean(id)),
    ),
  );

  const commit = makeCommit({
    parents,
    tree,
    message,
    author: options.author,
    timestamp,
  });

  return {
    state: {
      ...state,
      commits: { ...state.commits, [commit.id]: commit },
      head: commit.id,
      branches: {
        ...state.branches,
        [state.currentBranch]: {
          ...state.branches[state.currentBranch],
          head: commit.id,
        },
      },
      workingTree: { ...tree },
      stagedTree: {},
    },
    commitId: commit.id,
    message: "Merge committed.",
  };
}

/** Commits reachable from `branchHead` but not from `ontoHead`. */
function commitsToReplay(
  state: GitState,
  branchHead: string | null,
  ontoHead: string | null,
): GitCommit[] {
  const onto = new Set(ancestorsOf(state, ontoHead));
  const branch = ancestorsOf(state, branchHead).filter(
    (id) => !onto.has(id),
  );
  return branch
    .map((id) => state.commits[id])
    .filter(Boolean)
    .reverse();
}

/**
 * Rebase the current branch onto `ontoBranch`.
 *
 * The commits that are unique to the current branch are replayed on top of the
 * target branch. Conflicts abort the rebase and leave the state untouched.
 */
export function rebaseBranch(
  state: GitState,
  ontoBranch: string,
  author: GitAuthor,
  now?: number,
): RebaseResult {
  const onto = state.branches[ontoBranch];
  if (!onto) {
    return {
      status: "clean",
      state,
      conflicts: [],
      replayedCommitIds: [],
      message: `Unknown branch "${ontoBranch}".`,
    };
  }
  if (ontoBranch === state.currentBranch) {
    return {
      status: "clean",
      state,
      conflicts: [],
      replayedCommitIds: [],
      message: "Cannot rebase a branch onto itself.",
    };
  }

  const toReplay = commitsToReplay(state, state.head, onto.head);
  if (toReplay.length === 0) {
    return {
      status: "clean",
      state,
      conflicts: [],
      replayedCommitIds: [],
      message: "Branch is already up to date.",
    };
  }

  let nextState: GitState = { ...state };
  let tree: GitTree = onto.head ? { ...state.commits[onto.head].tree } : {};
  let parent = onto.head ?? null;
  const replayedCommitIds: string[] = [];
  const timestamp = now ?? Date.now();

  for (const commit of toReplay) {
    const commitParent = commit.parents[0]
      ? state.commits[commit.parents[0]]
      : undefined;
    const parentTree: GitTree = commitParent ? commitParent.tree : {};

    const { tree: mergedTree, conflicts } = mergeTrees(
      parentTree,
      tree,
      commit.tree,
      state.currentBranch,
      commit.id.slice(0, 7),
    );

    if (conflicts.length > 0) {
      return {
        status: "conflict",
        state,
        conflicts,
        replayedCommitIds,
        message: `Rebase onto "${ontoBranch}" conflicted in ${conflicts.length} file(s).`,
      };
    }

    const replayed = makeCommit({
      parents: parent ? [parent] : [],
      tree: mergedTree,
      message: commit.message,
      author: commit.author ?? author,
      timestamp: timestamp + replayedCommitIds.length,
    });

    nextState = {
      ...nextState,
      commits: { ...nextState.commits, [replayed.id]: replayed },
    };
    replayedCommitIds.push(replayed.id);
    tree = mergedTree;
    parent = replayed.id;
  }

  nextState = {
    ...nextState,
    head: parent,
    branches: {
      ...nextState.branches,
      [state.currentBranch]: {
        ...nextState.branches[state.currentBranch],
        head: parent,
      },
    },
    workingTree: { ...tree },
    stagedTree: {},
  };

  return {
    status: "clean",
    state: nextState,
    conflicts: [],
    replayedCommitIds,
    message: `Rebased ${replayedCommitIds.length} commit(s) onto "${ontoBranch}".`,
  };
}

/** Status of a single path relative to `HEAD`. */
function statusOfPath(
  path: string,
  headTree: GitTree,
  workingTree: GitTree,
): GitFileStatus {
  const inHead = path in headTree;
  const inWorking = path in workingTree;

  if (inHead && inWorking) {
    return headTree[path] === workingTree[path] ? "clean" : "modified";
  }
  if (!inHead && inWorking) return "added";
  return "deleted";
}

/**
 * Per-file status of the working tree compared to `HEAD`.
 */
export function getWorkingTreeStatus(state: GitState): GitFileStatusEntry[] {
  const headCommit = state.head ? state.commits[state.head] : undefined;
  const headTree: GitTree = headCommit ? headCommit.tree : {};

  const paths = unionPaths([headTree, state.workingTree]);
  const entries: GitFileStatusEntry[] = [];

  for (const path of paths) {
    const status = statusOfPath(path, headTree, state.workingTree);
    if (status === "clean" && !(path in state.stagedTree)) continue;
    entries.push({
      path,
      status,
      staged: path in state.stagedTree,
    });
  }

  return entries;
}

/** `true` when the working tree carries uncommitted changes. */
export function hasUncommittedChanges(state: GitState): boolean {
  return getWorkingTreeStatus(state).length > 0;
}

/** Commits of a branch, newest first. */
export function getCommitHistory(
  state: GitState,
  branchName?: string,
): GitCommit[] {
  const branch = branchName ? state.branches[branchName] : undefined;
  const head = branch ? branch.head : state.head;
  return ancestorsOf(state, head)
    .map((id) => state.commits[id])
    .filter(Boolean);
}

/**
 * Build the visual commit graph.
 *
 * Lanes are assigned the way Git draws them: the first parent continues the
 * current lane, additional parents open a new lane.
 */
export function getCommitGraph(state: GitState): CommitGraph {
  const commits = Object.values(state.commits).sort((a, b) => {
    if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp;
    return a.id.localeCompare(b.id);
  });

  const lanes: (string | null)[] = [];
  const laneOf = new Map<string, number>();
  const nodes: CommitGraphNode[] = [];
  const edges: CommitGraphEdge[] = [];
  const seenEdges = new Set<string>();

  const branchNamesByCommit = new Map<string, string[]>();
  for (const branch of Object.values(state.branches)) {
    if (!branch.head) continue;
    const list = branchNamesByCommit.get(branch.head) ?? [];
    list.push(branch.name);
    branchNamesByCommit.set(branch.head, list);
  }

  commits.forEach((commit, row) => {
    let lane = lanes.indexOf(commit.id);
    if (lane === -1) {
      const free = lanes.indexOf(null);
      if (free === -1) {
        lanes.push(commit.id);
        lane = lanes.length - 1;
      } else {
        lane = free;
        lanes[lane] = commit.id;
      }
    }

    lanes[lane] = commit.parents[0] ?? null;
    for (const extra of commit.parents.slice(1)) {
      if (!lanes.includes(extra)) lanes.push(extra);
    }

    laneOf.set(commit.id, lane);

    for (const parent of commit.parents) {
      const key = `${parent}->${commit.id}`;
      if (seenEdges.has(key)) continue;
      seenEdges.add(key);
      edges.push({ from: parent, to: commit.id, lane });
    }

    const branchNames = branchNamesByCommit.get(commit.id) ?? [];
    nodes.push({
      id: commit.id,
      message: commit.message,
      author: commit.author,
      timestamp: commit.timestamp,
      lane,
      row,
      branchNames,
      isTip: branchNames.length > 0,
      isHead: state.head === commit.id,
      isMerge: commit.parents.length > 1,
      isPushed: state.pushedCommits.includes(commit.id),
    });
  });

  // Edges pointing at a parent that is rendered in another lane need the
  // lane of the parent so the SVG can bend the line correctly.
  const resolvedEdges: CommitGraphEdge[] = edges.map((edge) => ({
    ...edge,
    lane: laneOf.get(edge.from) ?? edge.lane,
  }));

  return { nodes, edges: resolvedEdges, laneCount: Math.max(lanes.length, 1) };
}

/** Mark commits as pushed to the remote. */
export function markPushed(
  state: GitState,
  commitIds: string[],
): GitState {
  const pushed = new Set([...state.pushedCommits, ...commitIds]);
  return { ...state, pushedCommits: Array.from(pushed) };
}

/** Options accepted by {@link recordPush}. */
export interface RecordPushOptions {
  /** Branch that was pushed. */
  branch: string;
  /** SHA of the new remote branch HEAD. */
  sha: string;
  /** Local commit the remote SHA was created from, when known. */
  localCommitId?: string | null;
  /** Local commit ids included in the push. */
  commitIds: string[];
}

/**
 * Record a successful push, including the remote HEAD used for the next
 * optimistic concurrency check.
 */
export function recordPush(
  state: GitState,
  options: RecordPushOptions,
): GitState {
  const tracking: RemoteBranchTracking = {
    sha: options.sha,
    localCommitId: options.localCommitId ?? null,
  };
  return {
    ...markPushed(state, options.commitIds),
    remoteHeads: { ...state.remoteHeads, [options.branch]: tracking },
  };
}

/**
 * Local commits of `branch` that were created after the last recorded push.
 *
 * An empty array means the branch is in sync with the remote. When the branch
 * was never pushed every local commit is returned, so a brand new remote
 * branch receives the complete history.
 */
export function getUnpushedCommits(
  state: GitState,
  branch: string,
): GitCommit[] {
  const history = getCommitHistory(state, branch).slice().reverse();
  const tracking = state.remoteHeads[branch];
  if (!tracking?.localCommitId) return history;

  const index = history.findIndex(
    (commit) => commit.id === tracking.localCommitId,
  );
  return index === -1 ? history : history.slice(index + 1);
}

/** Set the remote the workspace is linked to. */
export function setRemote(
  state: GitState,
  remote: GitState["remote"],
): GitState {
  return { ...state, remote };
}
