/**
 * Unit tests for the Octokit based GitHub integration (issue #1727 / FE-27).
 */

import {
  canAccessRepository,
  createPullRequest,
  createRemoteBranch,
  fetchAccount,
  getRemoteBranchHead,
  listRemoteBranches,
  pullBranch,
  pushBranch,
  RemoteBranchConflictError,
  validateBranchName,
  type GitHubClient,
} from "@/lib/git/github";
import type { GitCommit } from "@/lib/git/types";

interface Call {
  route: string;
  params?: Record<string, unknown>;
}

/** Octokit-like 404 used to signal that a remote branch does not exist. */
class NotFoundError extends Error {
  status = 404;
}

type StubResponse =
  | unknown
  | Error
  | ((call: Call) => unknown);

/** Build a stub client that answers the given routes. */
function createStub(
  responses: Record<string, StubResponse>,
): GitHubClient & { calls: Call[] } {
  const calls: Call[] = [];
  const client = {
    calls,
    async request(route: string, params?: Record<string, unknown>) {
      const call: Call = { route, params };
      calls.push(call);
      const key = Object.keys(responses).find((candidate) =>
        route.startsWith(candidate),
      );
      if (!key) {
        throw new Error(`Unexpected route: ${route}`);
      }
      const value = responses[key];
      const resolved = typeof value === "function" ? value(call) : value;
      if (resolved instanceof Error) throw resolved;
      return { data: resolved };
    },
  };
  return client as GitHubClient & { calls: Call[] };
}


const COMMIT: GitCommit = {
  id: "a".repeat(40),
  message: "Add feature",
  author: { name: "Ada", email: "ada@example.dev" },
  timestamp: 1_700_000_000_000,
  tree: { "src/lib.rs": "fn main() {}\n" },
  parents: [],
};

describe("lib/git/github – account", () => {
  it("reads the authenticated account", async () => {
    const client = createStub({
      "GET /user": { login: "ada", name: "Ada L", avatar_url: "https://x/y.png" },
    });

    await expect(fetchAccount(client)).resolves.toEqual({
      login: "ada",
      name: "Ada L",
      avatarUrl: "https://x/y.png",
    });
    expect(client.calls[0].route).toBe("GET /user");
  });

  it("falls back to sane defaults", async () => {
    const client = createStub({ "GET /user": {} });
    await expect(fetchAccount(client)).resolves.toEqual({
      login: "unknown",
      name: null,
      avatarUrl: "",
    });
  });

  it("confirms repository access", async () => {
    const client = createStub({ "GET /repos": { id: 1 } });
    await expect(
      canAccessRepository(client, { owner: "o", repo: "r" }),
    ).resolves.toBe(true);
  });

  it("reports a missing repository", async () => {
    const client = createStub({ "GET /repos": new Error("Not Found") });
    await expect(
      canAccessRepository(client, { owner: "o", repo: "r" }),
    ).resolves.toBe(false);
  });
});

describe("lib/git/github – push", () => {
  const HEAD_ROUTE = "GET /repos/{owner}/{repo}/git/ref/heads/{branch}";
  const BLOBS = "POST /repos/{owner}/{repo}/git/blobs";
  const TREES = "POST /repos/{owner}/{repo}/git/trees";
  const COMMITS = "POST /repos/{owner}/{repo}/git/commits";
  const REFS = "POST /repos/{owner}/{repo}/git/refs";

  it("creates blobs, a tree, a commit and the branch ref", async () => {
    const client = createStub({
      [HEAD_ROUTE]: new NotFoundError("Not Found"),
      [BLOBS]: { sha: "blob-sha" },
      [TREES]: { sha: "tree-sha" },
      [COMMITS]: {
        sha: "commit-sha",
        html_url: "https://github.com/o/r/commit/commit-sha",
      },
      [REFS]: { ref: "refs/heads/main" },
    });

    const result = await pushBranch(client, {
      owner: "o",
      repo: "r",
      branch: "main",
      commits: [COMMIT],
      tree: COMMIT.tree,
    });

    expect(result).toEqual({
      sha: "commit-sha",
      url: "https://github.com/o/r/commit/commit-sha",
    });

    const routes = client.calls.map((call) => call.route);
    expect(routes).toEqual([
      HEAD_ROUTE,
      BLOBS,
      TREES,
      COMMITS,
      REFS,
    ]);

    const treeCall = client.calls[2];
    expect(treeCall.params?.tree).toEqual([
      { path: "src/lib.rs", mode: "100644", type: "blob", sha: "blob-sha" },
    ]);
  });

  it("updates an existing ref without allowing a forced update", async () => {
    const client = createStub({
      [HEAD_ROUTE]: { object: { sha: "head-sha" } },
      [BLOBS]: { sha: "blob-sha" },
      [TREES]: { sha: "tree-sha" },
      [COMMITS]: { sha: "commit-sha" },
      "PATCH /repos/{owner}/{repo}/git/refs/{ref}": { ref: "refs/heads/main" },
    });

    await pushBranch(client, {
      owner: "o",
      repo: "r",
      branch: "main",
      commits: [COMMIT],
      tree: COMMIT.tree,
      parentSha: "head-sha",
    });

    const patch = client.calls.find((call) =>
      call.route.startsWith("PATCH"),
    );
    expect(patch).toBeDefined();
    expect(patch?.params).toMatchObject({
      sha: "commit-sha",
      force: false,
    });
  });

  it("passes the parent sha of the pushed commit", async () => {
    const client = createStub({
      [HEAD_ROUTE]: { object: { sha: "parent-sha" } },
      [BLOBS]: { sha: "blob-sha" },
      [TREES]: { sha: "tree-sha" },
      [COMMITS]: { sha: "commit-sha" },
      "PATCH /repos/{owner}/{repo}/git/refs/{ref}": { ref: "refs/heads/main" },
    });

    await pushBranch(client, {
      owner: "o",
      repo: "r",
      branch: "main",
      commits: [COMMIT],
      tree: COMMIT.tree,
      parentSha: "parent-sha",
    });

    const commitCall = client.calls.find((call) => call.route === COMMITS);
    expect(commitCall?.params?.parents).toEqual(["parent-sha"]);
  });

  it("chains multiple local commits onto the remote parent", async () => {
    let commitNumber = 0;
    const client = createStub({
      [HEAD_ROUTE]: { object: { sha: "base-sha" } },
      [BLOBS]: { sha: "blob-sha" },
      [TREES]: { sha: "tree-sha" },
      [COMMITS]: () => ({ sha: `remote-${++commitNumber}` }),
      "PATCH /repos/{owner}/{repo}/git/refs/{ref}": { ref: "refs/heads/main" },
    });

    const secondCommit: GitCommit = {
      ...COMMIT,
      id: "b".repeat(40),
      message: "Second feature",
      tree: { "src/lib.rs": "fn main() { /* second */ }\n" },
    };
    const result = await pushBranch(client, {
      owner: "o",
      repo: "r",
      branch: "feature/chain",
      commits: [COMMIT, secondCommit],
      tree: secondCommit.tree,
      parentSha: "base-sha",
    });

    const commitCalls = client.calls.filter((call) => call.route === COMMITS);
    expect(commitCalls).toHaveLength(2);
    expect(commitCalls[0].params?.parents).toEqual(["base-sha"]);
    expect(commitCalls[1].params?.parents).toEqual(["remote-1"]);
    expect(result.sha).toBe("remote-2");
  });

  it("rejects a push when the remote branch moved", async () => {
    const client = createStub({
      [HEAD_ROUTE]: { object: { sha: "someone-else-sha" } },
    });

    await expect(
      pushBranch(client, {
        owner: "o",
        repo: "r",
        branch: "main",
        commits: [COMMIT],
        tree: COMMIT.tree,
        expectedHeadSha: "expected-sha",
        parentSha: "expected-sha",
      }),
    ).rejects.toBeInstanceOf(RemoteBranchConflictError);
    expect(client.calls).toHaveLength(1);
  });

  it("rejects a new-branch push when the branch already exists", async () => {
    const client = createStub({
      [HEAD_ROUTE]: { object: { sha: "existing-sha" } },
    });

    await expect(
      pushBranch(client, {
        owner: "o",
        repo: "r",
        branch: "feature/new",
        commits: [COMMIT],
        tree: COMMIT.tree,
        expectedHeadSha: null,
        parentSha: "existing-sha",
      }),
    ).rejects.toThrow(/Remote branch changed/);
  });

  it("refuses to push without commits", async () => {
    const client = createStub({});
    await expect(
      pushBranch(client, {
        owner: "o",
        repo: "r",
        branch: "main",
        commits: [],
        tree: {},
      }),
    ).rejects.toThrow("nothing to push");
  });
});

describe("lib/git/github – pull", () => {
  it("downloads the files of the remote branch", async () => {
    const client = createStub({
      "GET /repos/{owner}/{repo}/git/ref": { object: { sha: "head-sha" } },
      "GET /repos/{owner}/{repo}/git/commits": {
        tree: { sha: "tree-sha" },
      },
      "GET /repos/{owner}/{repo}/git/trees": {
        tree: [{ path: "src/lib.rs", type: "blob", sha: "blob-sha" }],
      },
      "GET /repos/{owner}/{repo}/git/blobs": {
        content: Buffer.from("fn main() {}\n", "utf-8").toString("base64"),
      },
    });

    const result = await pullBranch(client, {
      owner: "o",
      repo: "r",
      branch: "main",
    });

    expect(result.branch).toBe("main");
    expect(result.sha).toBe("head-sha");
    expect(result.files).toEqual([
      { path: "src/lib.rs", content: "fn main() {}\n" },
    ]);
  });

  it("fails when the branch cannot be resolved", async () => {
    const client = createStub({ "GET /repos/{owner}/{repo}/git/ref": {} });
    await expect(
      pullBranch(client, { owner: "o", repo: "r", branch: "nope" }),
    ).rejects.toThrow('"nope" could not be resolved');
  });

  it("ignores tree entries that are not blobs", async () => {
    const client = createStub({
      "GET /repos/{owner}/{repo}/git/ref": { object: { sha: "head-sha" } },
      "GET /repos/{owner}/{repo}/git/commits": { tree: { sha: "tree-sha" } },
      "GET /repos/{owner}/{repo}/git/trees": {
        tree: [{ path: "src", type: "tree", sha: "tree-sha" }],
      },
    });

    const result = await pullBranch(client, {
      owner: "o",
      repo: "r",
      branch: "main",
    });
    expect(result.files).toEqual([]);
  });
});

describe("lib/git/github – branches", () => {
  it("creates a branch on the remote", async () => {
    const client = createStub({ "POST /repos/{owner}/{repo}/git/refs": {} });
    await createRemoteBranch(client, {
      owner: "o",
      repo: "r",
      branch: "feature/x",
      sha: "abc",
    });

    expect(client.calls[0].params).toMatchObject({
      ref: "refs/heads/feature/x",
      sha: "abc",
    });
  });

  it("lists the remote branches", async () => {
    const client = createStub({
      "GET /repos/{owner}/{repo}/branches": [
        { name: "main", commit: { sha: "aaa" } },
        { name: "feature/x", commit: { sha: "bbb" } },
      ],
    });

    await expect(
      listRemoteBranches(client, { owner: "o", repo: "r" }),
    ).resolves.toEqual([
      { name: "main", sha: "aaa" },
      { name: "feature/x", sha: "bbb" },
    ]);
  });

  it("resolves the remote HEAD and treats 404 as an unborn branch", async () => {
    const existing = createStub({
      "GET /repos/{owner}/{repo}/git/ref": { object: { sha: "head-sha" } },
    });
    await expect(
      getRemoteBranchHead(existing, { owner: "o", repo: "r", branch: "main" }),
    ).resolves.toBe("head-sha");

    const missing = createStub({
      "GET /repos/{owner}/{repo}/git/ref": new NotFoundError("Not Found"),
    });
    await expect(
      getRemoteBranchHead(missing, {
        owner: "o",
        repo: "r",
        branch: "feature/new",
      }),
    ).resolves.toBeNull();
  });

  it("validates feature branch names", () => {
    expect(validateBranchName("  feature/hello  ")).toBe("feature/hello");
    expect(() => validateBranchName("feature/hello world")).toThrow(
      /not a valid branch name/,
    );
    expect(() => validateBranchName("feature//hello")).toThrow(
      /not a valid branch name/,
    );
    expect(() => validateBranchName("   ")).toThrow(/required/);
  });
});

describe("lib/git/github – pull requests", () => {
  it("creates a pull request through the Octokit API", async () => {
    const client = createStub({
      "POST /repos/{owner}/{repo}/pulls": {
        number: 42,
        html_url: "https://github.com/o/r/pull/42",
      },
    });

    await expect(
      createPullRequest(client, {
        owner: "o",
        repo: "r",
        title: "Add a feature",
        head: "feature/hello",
        base: "main",
        body: "Some details",
      }),
    ).resolves.toEqual({ number: 42, url: "https://github.com/o/r/pull/42" });

    expect(client.calls[0].route).toBe("POST /repos/{owner}/{repo}/pulls");
    expect(client.calls[0].params).toMatchObject({
      owner: "o",
      repo: "r",
      title: "Add a feature",
      head: "feature/hello",
      base: "main",
      body: "Some details",
    });
  });

  it("requires a title and validates the head branch", async () => {
    const client = createStub({});
    await expect(
      createPullRequest(client, {
        owner: "o",
        repo: "r",
        title: "  ",
        head: "feature/hello",
        base: "main",
      }),
    ).rejects.toThrow(/title is required/);
    await expect(
      createPullRequest(client, {
        owner: "o",
        repo: "r",
        title: "Add a feature",
        head: "bad branch",
        base: "main",
      }),
    ).rejects.toThrow(/not a valid branch name/);
  });

  it("reports a malformed pull request response", async () => {
    const client = createStub({ "POST /repos/{owner}/{repo}/pulls": {} });
    await expect(
      createPullRequest(client, {
        owner: "o",
        repo: "r",
        title: "Add a feature",
        head: "feature/hello",
        base: "main",
      }),
    ).rejects.toThrow(/pull request number/);
  });
});
