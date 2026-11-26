// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Reactive store for the in-app Git repository (issue #1727 / FE-27).
 *
 * The store owns the {@link GitState} and the transient state of a merge that
 * is currently in conflict. Every mutation returns a new repository state, so
 * the commit graph in the UI updates as soon as a commit or merge lands.
 */

import { create } from "zustand";
import {
  checkoutBranch,
  commitChanges,
  commitMerge,
  createBranch,
  createInitialState,
  getWorkingTreeStatus,
  markPushed,
  mergeBranch,
  rebaseBranch,
  recordPush,
  setRemote,
} from "@/lib/git/repository";
import { applyResolutions } from "@/lib/git/conflicts";
import type {
  ConflictResolution,
  GitAuthor,
  GitFileStatusEntry,
  GitRemoteConfig,
  GitState,
  MergeFileResult,
} from "@/lib/git/types";

/** Path of the file the playground editor is bound to. */
export const DEFAULT_PROJECT_FILE = "src/lib.rs";

/** A conflict that still needs to be resolved. */
export interface PendingConflict {
  /** Path of the conflicted file. */
  path: string;
  /** The file content carrying the conflict markers. */
  content: string;
}

export interface GitStore {
  /** The repository. */
  repo: GitState;
  /** Identity used for new commits. */
  author: GitAuthor;
  /** Files that could not be merged automatically. */
  conflicts: MergeFileResult[];
  /** Resolutions per file path, keyed by conflict hunk id. */
  resolutions: Record<string, Record<string, ConflictResolution>>;
  /** Manually edited combined text per file path, keyed by conflict hunk id. */
  combinedText: Record<string, Record<string, string>>;
  /** Branch the pending merge originates from. */
  mergeSourceBranch: string | null;
  /** Last human readable status line. */
  lastMessage: string | null;
  /** Last error, if any. */
  error: string | null;

  /** Replace the author identity. */
  setAuthor: (author: Partial<GitAuthor>) => void;
  /** Reset the repository to a pristine state. */
  reset: () => void;
  /** Write a file into the working tree. */
  setFile: (path: string, content: string) => void;
  /** Stage a file for the next commit. */
  stageFile: (path: string) => void;
  /** Remove a file from the staging area. */
  unstageFile: (path: string) => void;
  /** Commit the staged files (or the whole working tree). */
  commit: (message: string, files?: string[]) => void;
  /** Create a branch. */
  createBranch: (name: string) => void;
  /** Check out a branch. */
  checkoutBranch: (name: string) => void;
  /** Merge a branch into the current one. */
  mergeBranch: (name: string) => void;
  /** Rebase the current branch onto another one. */
  rebaseBranch: (name: string) => void;
  /** Record the resolution of a single conflict hunk. */
  setResolution: (
    path: string,
    hunkId: string,
    resolution: ConflictResolution,
  ) => void;
  /** Record the manually combined text of a single conflict hunk. */
  setCombinedText: (path: string, hunkId: string, text: string) => void;
  /** Create the merge commit once every conflict is resolved. */
  commitMerge: (message?: string) => void;
  /** Abort a pending merge. */
  cancelMerge: () => void;
  /** Link the workspace to a GitHub repository. */
  setRemote: (remote: GitRemoteConfig | null) => void;
  /** Mark commits as pushed. */
  markPushed: (commitIds: string[]) => void;
  /** Record a successful push and its remote HEAD. */
  recordPush: (options: {
    branch: string;
    sha: string;
    localCommitId?: string | null;
    commitIds: string[];
  }) => void;
  /** Clear the status/error line. */
  clearMessages: () => void;
}

/** The status of every file relative to `HEAD`. */
export const selectWorkingTreeStatus = (
  state: GitStore,
): GitFileStatusEntry[] => getWorkingTreeStatus(state.repo);

export const useGitStore = create<GitStore>((set, get) => ({
  repo: createInitialState(),
  author: { name: "Playground User", email: "user@playground.dev" },
  conflicts: [],
  resolutions: {},
  combinedText: {},
  mergeSourceBranch: null,
  lastMessage: null,
  error: null,

  setAuthor: (author) =>
    set((state) => ({ author: { ...state.author, ...author } })),

  reset: () =>
    set({
      repo: createInitialState(),
      conflicts: [],
      resolutions: {},
      combinedText: {},
      mergeSourceBranch: null,
      lastMessage: null,
      error: null,
    }),

  setFile: (path, content) =>
    set((state) => ({
      repo: {
        ...state.repo,
        workingTree: { ...state.repo.workingTree, [path]: content },
      },
    })),

  stageFile: (path) =>
    set((state) => {
      const content = state.repo.workingTree[path];
      if (content === undefined) return {};
      return {
        repo: {
          ...state.repo,
          stagedTree: { ...state.repo.stagedTree, [path]: content },
        },
      };
    }),

  unstageFile: (path) =>
    set((state) => {
      const stagedTree = { ...state.repo.stagedTree };
      delete stagedTree[path];
      return { repo: { ...state.repo, stagedTree } };
    }),

  commit: (message, files) => {
    const state = get();
    const stagedFiles = files ?? Object.keys(state.repo.stagedTree);
    const result = commitChanges(state.repo, {
      message,
      author: state.author,
      ...(stagedFiles.length > 0 ? { files: stagedFiles } : {}),
    });

    if (!result.commitId) {
      set({ lastMessage: result.message, error: result.message });
      return;
    }

    set({
      repo: result.state,
      lastMessage: result.message,
      error: null,
    });
  },

  createBranch: (name) => {
    const state = get();
    const trimmed = name.trim();
    if (!trimmed) {
      set({ error: "A branch name is required.", lastMessage: null });
      return;
    }
    if (state.repo.branches[trimmed]) {
      set({
        error: `The branch "${trimmed}" already exists.`,
        lastMessage: null,
      });
      return;
    }
    set({
      repo: createBranch(state.repo, { name: trimmed }),
      lastMessage: `Created branch "${trimmed}".`,
      error: null,
    });
  },

  checkoutBranch: (name) => {
    const state = get();
    if (!state.repo.branches[name]) {
      set({ error: `Unknown branch "${name}".`, lastMessage: null });
      return;
    }
    set({
      repo: checkoutBranch(state.repo, name),
      conflicts: [],
      resolutions: {},
      combinedText: {},
      mergeSourceBranch: null,
      lastMessage: `Switched to branch "${name}".`,
      error: null,
    });
  },

  mergeBranch: (name) => {
    const state = get();
    const result = mergeBranch(state.repo, name, state.author);

    if (result.status === "conflict") {
      set({
        conflicts: result.conflicts,
        resolutions: {},
        combinedText: Object.fromEntries(
          result.conflicts.map((conflict) => [conflict.path, {}]),
        ),
        mergeSourceBranch: name,
        lastMessage: result.message,
        error: result.message,
      });
      return;
    }

    set({
      repo: result.state,
      conflicts: [],
      resolutions: {},
      combinedText: {},
      mergeSourceBranch: null,
      lastMessage: result.message,
      error: null,
    });
  },

  rebaseBranch: (name) => {
    const state = get();
    const result = rebaseBranch(state.repo, name, state.author);

    if (result.status === "conflict") {
      set({
        conflicts: result.conflicts,
        resolutions: {},
        combinedText: Object.fromEntries(
          result.conflicts.map((conflict) => [conflict.path, {}]),
        ),
        mergeSourceBranch: name,
        lastMessage: result.message,
        error: result.message,
      });
      return;
    }

    set({
      repo: result.state,
      conflicts: [],
      resolutions: {},
      combinedText: {},
      mergeSourceBranch: null,
      lastMessage: result.message,
      error: null,
    });
  },

  setResolution: (path, hunkId, resolution) =>
    set((state) => ({
      resolutions: {
        ...state.resolutions,
        [path]: {
          ...(state.resolutions[path] ?? {}),
          [hunkId]: resolution,
        },
      },
    })),

  setCombinedText: (path, hunkId, text) =>
    set((state) => ({
      combinedText: {
        ...state.combinedText,
        [path]: { ...(state.combinedText[path] ?? {}), [hunkId]: text },
      },
    })),

  commitMerge: (message) => {
    const state = get();
    const sourceBranch = state.mergeSourceBranch;
    if (!sourceBranch) {
      set({ error: "There is no merge in progress.", lastMessage: null });
      return;
    }

    const resolvedFiles: Record<string, string> = {};
    for (const conflict of state.conflicts) {
      const resolutions = state.resolutions[conflict.path] ?? {};
      const combinedTexts = state.combinedText[conflict.path] ?? {};
      resolvedFiles[conflict.path] = applyResolutions(conflict.content, resolutions, {
        combinedTexts,
      });
    }

    const result = commitMerge(state.repo, {
      sourceBranch,
      resolvedFiles,
      author: state.author,
      ...(message ? { message } : {}),
    });

    set({
      repo: result.state,
      conflicts: [],
      resolutions: {},
      combinedText: {},
      mergeSourceBranch: null,
      lastMessage: result.message,
      error: null,
    });
  },

  cancelMerge: () =>
    set({
      conflicts: [],
      resolutions: {},
      combinedText: {},
      mergeSourceBranch: null,
      lastMessage: "Merge aborted.",
      error: null,
    }),

  setRemote: (remote) =>
    set((state) => ({ repo: setRemote(state.repo, remote) })),

  markPushed: (commitIds) =>
    set((state) => ({ repo: markPushed(state.repo, commitIds) })),

  recordPush: (options) =>
    set((state) => ({ repo: recordPush(state.repo, options) })),

  clearMessages: () => set({ lastMessage: null, error: null }),
}));
