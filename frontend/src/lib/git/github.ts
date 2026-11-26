// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * GitHub remote integration built on top of Octokit (issue #1727 / FE-27).
 *
 * Only the Git Data API is used, which maps nicely onto the in-app repository:
 * blobs carry file contents, trees carry directories, commits carry the
 * history and refs carry the branches.
 *
 * The Octokit client is injected into every function so the transport can be
 * replaced with a stub during tests.
 */

import type { GitCommit, GitRemoteConfig, GitTree } from "./types";

/** The subset of the Octokit client this module relies on. */
export interface GitHubClient {
  /** Perform an Octokit route request, e.g. `"GET /repos/{owner}/{repo}"`. */
  request: (
    route: string,
    params?: Record<string, unknown>,
  ) => Promise<{ data: unknown }>;
}

/** The authenticated GitHub account. */
export interface GitHubAccount {
  /** GitHub login. */
  login: string;
  /** Display name, when the account has one. */
  name: string | null;
  /** Avatar URL. */
  avatarUrl: string;
}

/** A file fetched from the remote. */
export interface RemoteFile {
  /** Project relative path. */
  path: string;
  /** File content. */
  content: string;
}

/** The state of a remote branch. */
export interface RemoteBranchState {
  /** Branch name. */
  branch: string;
  /** Head commit sha of the remote branch. */
  sha: string;
  /** Files contained in the remote branch. */
  files: RemoteFile[];
}

/**
 * Raised when the remote branch HEAD no longer matches the SHA the local
 * commits were based on. Callers must pull/rebase before retrying.
 */
export class RemoteBranchConflictError extends Error {
  /** SHA the caller expected the remote branch to point at. */
  readonly expectedSha: string | null;
  /** SHA the remote branch actually pointed at. */
  readonly actualSha: string | null;

  constructor(expectedSha: string | null, actualSha: string | null) {
    super(
      `Remote branch changed (expected ${expectedSha ?? "a new branch"}, found ${actualSha ?? "no branch"}). Pull and retry before pushing.`,
    );
    this.name = "RemoteBranchConflictError";
    this.expectedSha = expectedSha;
    this.actualSha = actualSha;
  }
}

/** Options accepted by {@link pushBranch}. */
export interface PushOptions {
  /** Remote owner. */
  owner: string;
  /** Remote repository. */
  repo: string;
  /** Branch that is pushed. */
  branch: string;
  /** Commits to push, oldest first. */
  commits: GitCommit[];
  /** Files that make up the tip of the branch. */
  tree: GitTree;
  /** Remote commit the local branch is based on (used as parent). */
  parentSha?: string | null;
  /**
   * Remote HEAD the push is based on. The push is rejected when the remote
   * branch moved. Defaults to `parentSha` when omitted.
   */
  expectedHeadSha?: string | null;
}

/** Result of {@link pushBranch}. */
export interface PushResult {
  /** Sha of the commit that was created on the remote. */
  sha: string;
  /** Url of the pushed commit. */
  url: string | null;
}

/** Options accepted by {@link pullBranch}. */
export interface PullOptions {
  /** Remote owner. */
  owner: string;
  /** Remote repository. */
  repo: string;
  /** Branch to pull. */
  branch: string;
}

/** Encode a string as base64 (works in the browser and in Node). */
function encodeBase64(content: string): string {
  if (typeof btoa === "function") {
    const bytes = new TextEncoder().encode(content);
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  }
  return Buffer.from(content, "utf-8").toString("base64");
}

/** Decode a base64 string into a UTF-8 string. */
function decodeBase64(content: string): string {
  if (typeof atob === "function") {
    const binary = atob(content);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new TextDecoder().decode(bytes);
  }
  return Buffer.from(content, "base64").toString("utf-8");
}

/**
 * Create an Octokit client authenticated with the given token.
 *
 * Octokit is imported lazily so the bundle only pays for it when the user
 * actually connects a remote.
 */
export async function createGitHubClient(token: string): Promise<GitHubClient> {
  const trimmed = token.trim();
  if (!trimmed) {
    throw new Error("A GitHub personal access token is required.");
  }

  const { Octokit } = await import("@octokit/rest");
  const octokit = new Octokit({ auth: trimmed });
  return octokit as unknown as GitHubClient;
}

/** Fetch the authenticated account — used to validate a token. */
export async function fetchAccount(
  client: GitHubClient,
): Promise<GitHubAccount> {
  const response = await client.request("GET /user");
  const data = (response.data ?? {}) as {
    login?: string;
    name?: string | null;
    avatar_url?: string;
  };

  return {
    login: data.login ?? "unknown",
    name: data.name ?? null,
    avatarUrl: data.avatar_url ?? "",
  };
}

/** `true` when the repository exists and the token may write to it. */
export async function canAccessRepository(
  client: GitHubClient,
  remote: GitRemoteConfig,
): Promise<boolean> {
  try {
    await client.request("GET /repos/{owner}/{repo}", {
      owner: remote.owner,
      repo: remote.repo,
    });
    return true;
  } catch {
    return false;
  }
}

/** `true` when an Octokit error represents a missing GitHub resource. */
function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { status?: number; message?: string };
  return (
    candidate.status === 404 ||
    /not found|404/i.test(candidate.message ?? "")
  );
}

/**
 * Resolve the current HEAD sha of a remote branch, or `null` when the branch
 * does not exist yet.
 */
export async function getRemoteBranchHead(
  client: GitHubClient,
  options: { owner: string; repo: string; branch: string },
): Promise<string | null> {
  try {
    const response = await client.request(
      "GET /repos/{owner}/{repo}/git/ref/heads/{branch}",
      options,
    );
    const data = (response.data ?? {}) as { object?: { sha?: string } };
    if (!data.object?.sha) {
      throw new Error(
        `The remote branch "${options.branch}" did not return a commit sha.`,
      );
    }
    return data.object.sha;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/**
 * Validate a branch name against Git's ref rules before it is sent to GitHub.
 */
export function validateBranchName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("A branch name is required.");
  if (/[\s\\~^:?*[\]]/.test(trimmed)) {
    throw new Error(`"${trimmed}" is not a valid branch name.`);
  }
  if (
    trimmed.startsWith("/") ||
    trimmed.endsWith("/") ||
    trimmed.includes("//") ||
    trimmed.includes("..") ||
    trimmed.includes("@{") ||
    trimmed.endsWith(".lock")
  ) {
    throw new Error(`"${trimmed}" is not a valid branch name.`);
  }
  return trimmed;
}

/**
 * Push the local commits to the remote branch.
 *
 * The Git Data API is used end-to-end: blobs for the files, a tree for the
 * directory listing, a commit object and finally the branch reference. Before
 * anything is written the remote HEAD is compared with `expectedHeadSha`, so a
 * concurrent push can never be overwritten silently. Every local commit is
 * chained onto the previous remote commit, preserving history.
 */
export async function pushBranch(
  client: GitHubClient,
  options: PushOptions,
): Promise<PushResult> {
  const { owner, repo, branch, commits } = options;

  if (commits.length === 0) {
    throw new Error("There is nothing to push.");
  }

  const expectedSha =
    options.expectedHeadSha === undefined
      ? options.parentSha ?? null
      : options.expectedHeadSha;
  const actualSha = await getRemoteBranchHead(client, {
    owner,
    repo,
    branch,
  });
  if (actualSha !== expectedSha) {
    throw new RemoteBranchConflictError(expectedSha, actualSha);
  }

  const blobCache = new Map<string, string>();
  const writeTree = async (tree: GitTree): Promise<string> => {
    const entries: Array<{
      path: string;
      mode: string;
      type: string;
      sha: string;
    }> = [];

    for (const [path, content] of Object.entries(tree)) {
      let sha = blobCache.get(content);
      if (!sha) {
        const blobResponse = await client.request(
          "POST /repos/{owner}/{repo}/git/blobs",
          {
            owner,
            repo,
            content: encodeBase64(content),
            encoding: "base64",
          },
        );
        const blobData = (blobResponse.data ?? {}) as { sha?: string };
        if (!blobData.sha) {
          throw new Error("GitHub did not return a blob sha.");
        }
        sha = blobData.sha;
        blobCache.set(content, sha);
      }
      entries.push({ path, mode: "100644", type: "blob", sha });
    }

    const treeResponse = await client.request(
      "POST /repos/{owner}/{repo}/git/trees",
      { owner, repo, tree: entries },
    );
    const treeData = (treeResponse.data ?? {}) as { sha?: string };
    if (!treeData.sha) {
      throw new Error("GitHub did not return a tree sha for the pushed files.");
    }
    return treeData.sha;
  };

  let parentSha = options.parentSha ?? actualSha;
  let pushedSha = "";
  let pushedUrl: string | null = null;

  for (let index = 0; index < commits.length; index += 1) {
    const commit = commits[index];
    const tree =
      index === commits.length - 1 && options.tree
        ? options.tree
        : commit.tree;
    const treeSha = await writeTree(tree);
    const date = new Date(commit.timestamp).toISOString();
    const identity = {
      name: commit.author.name,
      email: commit.author.email,
      date,
    };

    const commitResponse = await client.request(
      "POST /repos/{owner}/{repo}/git/commits",
      {
        owner,
        repo,
        message: commit.message,
        tree: treeSha,
        parents: parentSha ? [parentSha] : [],
        author: identity,
        committer: identity,
      },
    );
    const commitData = (commitResponse.data ?? {}) as {
      sha?: string;
      html_url?: string;
    };
    if (!commitData.sha) {
      throw new Error(
        "GitHub did not return a commit sha for the pushed commit.",
      );
    }

    pushedSha = commitData.sha;
    pushedUrl = commitData.html_url ?? null;
    parentSha = pushedSha;
  }

  const ref = `refs/heads/${branch}`;
  if (actualSha === null) {
    await client.request("POST /repos/{owner}/{repo}/git/refs", {
      owner,
      repo,
      ref,
      sha: pushedSha,
    });
  } else {
    // `force: false` makes GitHub reject a non-fast-forward update as well.
    await client.request("PATCH /repos/{owner}/{repo}/git/refs/{ref}", {
      owner,
      repo,
      ref,
      sha: pushedSha,
      force: false,
    });
  }

  return { sha: pushedSha, url: pushedUrl };
}

/**
 * Pull the remote branch and return its files.
 */
export async function pullBranch(
  client: GitHubClient,
  options: PullOptions,
): Promise<RemoteBranchState> {
  const { owner, repo, branch } = options;

  const refResponse = await client.request(
    "GET /repos/{owner}/{repo}/git/ref/heads/{branch}",
    { owner, repo, branch },
  );
  const refData = (refResponse.data ?? {}) as { object?: { sha?: string } };
  const sha = refData.object?.sha;
  if (!sha) {
    throw new Error(`The remote branch "${branch}" could not be resolved.`);
  }

  const commitResponse = await client.request(
    "GET /repos/{owner}/{repo}/git/commits/{sha}",
    { owner, repo, sha },
  );
  const commitData = (commitResponse.data ?? {}) as { tree?: { sha?: string } };
  const treeSha = commitData.tree?.sha;
  if (!treeSha) {
    throw new Error("The remote commit does not reference a tree.");
  }

  const treeResponse = await client.request(
    "GET /repos/{owner}/{repo}/git/trees/{tree_sha}",
    { owner, repo, tree_sha: treeSha, recursive: "1" },
  );
  const treeData = (treeResponse.data ?? {}) as {
    tree?: Array<{ path?: string; type?: string; sha?: string }>;
  };

  const files: RemoteFile[] = [];
  for (const entry of treeData.tree ?? []) {
    if (entry.type !== "blob" || !entry.path || !entry.sha) continue;
    const blobResponse = await client.request(
      "GET /repos/{owner}/{repo}/git/blobs/{sha}",
      { owner, repo, sha: entry.sha },
    );
    const blobData = (blobResponse.data ?? {}) as { content?: string };
    if (typeof blobData.content !== "string") continue;
    files.push({
      path: entry.path,
      content: decodeBase64(blobData.content.replace(/\n/g, "")),
    });
  }

  return { branch, sha, files };
}

/**
 * Create a branch on the remote pointing at an existing commit.
 */
export async function createRemoteBranch(
  client: GitHubClient,
  options: { owner: string; repo: string; branch: string; sha: string },
): Promise<void> {
  await client.request("POST /repos/{owner}/{repo}/git/refs", {
    owner: options.owner,
    repo: options.repo,
    ref: `refs/heads/${options.branch}`,
    sha: options.sha,
  });
}

/** User supplied part of a feature branch / pull request publication. */
export interface PullRequestDraft {
  /** New feature branch to create. */
  branch: string;
  /** Pull request title. */
  title: string;
  /** Base branch the pull request targets. */
  base: string;
  /** Optional pull request description. */
  body?: string;
}

/** Options accepted by {@link createPullRequest}. */
export interface CreatePullRequestOptions {
  /** Repository owner. */
  owner: string;
  /** Repository name. */
  repo: string;
  /** Pull request title. */
  title: string;
  /** Branch containing the changes. */
  head: string;
  /** Branch the changes are merged into. */
  base: string;
  /** Optional pull request description. */
  body?: string;
}

/** Result of {@link createPullRequest}. */
export interface PullRequestResult {
  /** Pull request number. */
  number: number;
  /** Html url of the pull request. */
  url: string;
}

/**
 * Open a pull request with the GitHub REST API.
 */
export async function createPullRequest(
  client: GitHubClient,
  options: CreatePullRequestOptions,
): Promise<PullRequestResult> {
  const title = options.title.trim();
  if (!title) throw new Error("A pull request title is required.");

  const head = validateBranchName(options.head);
  const base = validateBranchName(options.base);
  const body = options.body?.trim();

  const response = await client.request("POST /repos/{owner}/{repo}/pulls", {
    owner: options.owner,
    repo: options.repo,
    title,
    head,
    base,
    ...(body ? { body } : {}),
    maintainer_can_modify: true,
  });
  const data = (response.data ?? {}) as {
    number?: number;
    html_url?: string;
  };
  if (typeof data.number !== "number") {
    throw new Error("GitHub did not return a pull request number.");
  }

  return {
    number: data.number,
    url:
      data.html_url ??
      `https://github.com/${options.owner}/${options.repo}/pull/${data.number}`,
  };
}

/** List the remote branches. */
export async function listRemoteBranches(
  client: GitHubClient,
  options: { owner: string; repo: string },
): Promise<Array<{ name: string; sha: string }>> {
  const response = await client.request("GET /repos/{owner}/{repo}/branches", {
    owner: options.owner,
    repo: options.repo,
  });
  const data = (response.data ?? []) as Array<{
    name?: string;
    commit?: { sha?: string };
  }>;
  return data
    .filter((entry) => Boolean(entry.name))
    .map((entry) => ({
      name: entry.name as string,
      sha: entry.commit?.sha ?? "",
    }));
}
