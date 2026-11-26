/**
 * Unit tests for the in-app Git engine (issue #1727 / FE-27).
 */

import {
  checkoutBranch,
  commitChanges,
  commitMerge,
  createBranch,
  createInitialState,
  findMergeBase,
  getCommitGraph,
  getUnpushedCommits,
  getWorkingTreeStatus,
  mergeBranch,
  rebaseBranch,
  recordPush,
} from "@/lib/git/repository";
import type { GitAuthor, GitState } from "@/lib/git/types";

const AUTHOR: GitAuthor = { name: "Ada", email: "ada@example.dev" };

/** Build a repository with a single commit on `main`. */
function seedRepo(
  files: Record<string, string> = { "src/lib.rs": "fn main() {}\n" },
): GitState {
  let state = createInitialState();
  state = {
    ...state,
    workingTree: { ...state.workingTree, ...files },
  };
  const result = commitChanges(state, {
    message: "Initial commit",
    author: AUTHOR,
    now: 1_000,
  });
  expect(result.commitId).not.toBeNull();
  return result.state;
}

/** Check out `branch`, write `files` and commit them. */
function commitOn(
  state: GitState,
  branch: string,
  message: string,
  files: Record<string, string>,
  now: number,
): GitState {
  let next = checkoutBranch(state, branch);
  next = {
    ...next,
    workingTree: { ...next.workingTree, ...files },
  };
  return commitChanges(next, { message, author: AUTHOR, now }).state;
}

describe("git/repository – commits", () => {
  it("creates a pristine repository with a default branch", () => {
    const state = createInitialState();
    expect(state.currentBranch).toBe("main");
    expect(state.head).toBeNull();
    expect(state.commits).toEqual({});
  });

  it("commits the working tree", () => {
    const state = seedRepo();
    expect(state.head).not.toBeNull();
    expect(Object.keys(state.commits)).toHaveLength(1);
  });

  it("refuses to commit without a message", () => {
    const state = seedRepo();
    const result = commitChanges(state, { message: "  ", author: AUTHOR });
    expect(result.commitId).toBeNull();
    expect(result.message).toContain("message is required");
  });

  it("reports when there is nothing to commit", () => {
    const state = seedRepo();
    const result = commitChanges(state, { message: "noop", author: AUTHOR });
    expect(result.commitId).toBeNull();
    expect(result.message).toBe("Nothing to commit.");
  });

  it("records the file status of the working tree", () => {
    const state = seedRepo();
    const modified: GitState = {
      ...state,
      workingTree: {
        ...state.workingTree,
        "src/lib.rs": "fn main() { /* x */ }\n",
      },
    };

    const status = getWorkingTreeStatus(modified);
    expect(status).toHaveLength(1);
    expect(status[0]).toMatchObject({ path: "src/lib.rs", status: "modified" });
  });

  it("detects added files", () => {
    const state = seedRepo();
    const changed: GitState = {
      ...state,
      workingTree: {
        ...state.workingTree,
        "Cargo.toml": "[package]\n",
      },
    };

    const status = getWorkingTreeStatus(changed);
    expect(status).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "Cargo.toml", status: "added" }),
      ]),
    );
  });
});

describe("git/repository – branches", () => {
  it("creates a branch at the current head", () => {
    const state = seedRepo();
    const branched = createBranch(state, { name: "feature/x" });
    expect(branched.branches["feature/x"].head).toBe(state.head);
  });

  it("ignores an empty or duplicate branch name", () => {
    const state = seedRepo();
    expect(createBranch(state, { name: "  " })).toBe(state);
    const once = createBranch(state, { name: "feature/x" });
    expect(createBranch(once, { name: "feature/x" })).toBe(once);
  });

  it("checks out a branch and resets the working tree", () => {
    const state = seedRepo();
    const branched = createBranch(state, { name: "feature/x" });
    const changed: GitState = {
      ...branched,
      workingTree: { ...branched.workingTree, "src/lib.rs": "dirty\n" },
    };

    const checkedOut = checkoutBranch(changed, "feature/x");
    expect(checkedOut.currentBranch).toBe("feature/x");
    expect(checkedOut.workingTree["src/lib.rs"]).toBe("fn main() {}\n");
  });

  it("finds the merge base of two branches", () => {
    const state = seedRepo();
    const branched = createBranch(state, { name: "feature/x" });
    expect(
      findMergeBase(state, state.head, branched.branches["feature/x"].head),
    ).toBe(state.head);
  });

  it("chains commits made on a feature branch", () => {
    const base = seedRepo();
    let state = createBranch(base, { name: "feature/chain" });
    state = commitOn(
      state,
      "feature/chain",
      "First change",
      { "src/first.rs": "first\n" },
      2_000,
    );
    const second = commitOn(
      state,
      "feature/chain",
      "Second change",
      { "src/second.rs": "second\n" },
      3_000,
    );

    const tip = second.commits[second.head as string];
    const parent = second.commits[tip.parents[0]];
    expect(tip.message).toBe("Second change");
    expect(parent.message).toBe("First change");
    expect(parent.parents).toEqual([base.head]);
    expect(tip.tree["src/first.rs"]).toBe("first\n");
    expect(tip.tree["src/second.rs"]).toBe("second\n");
  });

  it("tracks the remote head and only returns unpushed commits", () => {
    let state = seedRepo();
    const pushedId = state.head as string;
    state = recordPush(state, {
      branch: "main",
      sha: "remote-sha-1",
      localCommitId: pushedId,
      commitIds: [pushedId],
    });
    expect(getUnpushedCommits(state, "main")).toEqual([]);
    expect(state.remoteHeads.main).toEqual({
      sha: "remote-sha-1",
      localCommitId: pushedId,
    });

    state = commitOn(state, "main", "Follow up", { "src/new.rs": "new\n" }, 2_000);
    const unpushed = getUnpushedCommits(state, "main");
    expect(unpushed).toHaveLength(1);
    expect(unpushed[0].message).toBe("Follow up");

    state = recordPush(state, {
      branch: "main",
      sha: "remote-sha-2",
      localCommitId: unpushed[0].id,
      commitIds: [unpushed[0].id],
    });
    expect(getUnpushedCommits(state, "main")).toEqual([]);
    expect(state.pushedCommits).toContain(unpushed[0].id);
  });
});

describe("git/repository – merging", () => {
  it("merges a branch that changed another file", () => {
    const base = seedRepo({
      "src/lib.rs": "fn main() {}\n",
      "Cargo.toml": "[package]\n",
    });
    const branched = createBranch(base, { name: "feature/x" });

    const featureState = commitOn(
      branched,
      "feature/x",
      "Add helper",
      { "src/helper.rs": "pub fn helper() {}\n" },
      2_000,
    );
    const mainState = commitOn(
      featureState,
      "main",
      "Add readme",
      { "README.md": "# Hello\n" },
      3_000,
    );

    const result = mergeBranch(mainState, "feature/x", AUTHOR, 4_000);

    expect(result.status).toBe("clean");
    expect(result.mergeCommitId).not.toBeNull();
    expect(
      result.state.commits[result.mergeCommitId as string].parents,
    ).toHaveLength(2);
    expect(result.state.workingTree["src/helper.rs"]).toBe(
      "pub fn helper() {}\n",
    );
    expect(result.state.workingTree["README.md"]).toBe("# Hello\n");
  });

  it("reports a conflict when both sides changed the same file", () => {
    const base = seedRepo({ "src/lib.rs": "fn main() {}\n" });
    const branched = createBranch(base, { name: "feature/x" });

    const featureState = commitOn(
      branched,
      "feature/x",
      "Feature edit",
      { "src/lib.rs": "feature\n" },
      2_000,
    );
    const mainState = commitOn(
      featureState,
      "main",
      "Main edit",
      { "src/lib.rs": "main\n" },
      3_000,
    );

    const result = mergeBranch(mainState, "feature/x", AUTHOR, 4_000);

    expect(result.status).toBe("conflict");
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].path).toBe("src/lib.rs");
    expect(result.conflicts[0].content).toContain("<<<<<<<");
    // The repository is left untouched while the conflict is unresolved.
    expect(result.state).toBe(mainState);
  });

  it("creates the merge commit once the conflict is resolved", () => {
    const base = seedRepo({ "src/lib.rs": "fn main() {}\n" });
    const branched = createBranch(base, { name: "feature/x" });

    const featureState = commitOn(
      branched,
      "feature/x",
      "Feature edit",
      { "src/lib.rs": "feature\n" },
      2_000,
    );
    const mainState = commitOn(
      featureState,
      "main",
      "Main edit",
      { "src/lib.rs": "main\n" },
      3_000,
    );

    const conflict = mergeBranch(mainState, "feature/x", AUTHOR, 4_000);
    const resolved = commitMerge(mainState, {
      sourceBranch: "feature/x",
      resolvedFiles: { "src/lib.rs": "resolved\n" },
      author: AUTHOR,
      now: 5_000,
    });

    expect(conflict.status).toBe("conflict");
    expect(resolved.commitId).not.toBeNull();
    expect(resolved.state.workingTree["src/lib.rs"]).toBe("resolved\n");
    expect(
      resolved.state.commits[resolved.commitId as string].parents,
    ).toHaveLength(2);
  });

  it("reports a branch that is already merged instead of duplicating parents", () => {
    const state = seedRepo();
    const branched = createBranch(state, { name: "feature/x" });

    const result = mergeBranch(branched, "feature/x", AUTHOR);

    expect(result.status).toBe("clean");
    expect(result.mergeCommitId).toBeNull();
    expect(result.message).toContain("already merged");
    expect(result.state).toBe(branched);
  });

  it("refuses to merge a branch into itself", () => {
    const state = seedRepo();
    const result = mergeBranch(state, "main", AUTHOR);
    expect(result.status).toBe("clean");
    expect(result.message).toContain("itself");
  });
});

describe("git/repository – rebasing", () => {
  it("replays the commits of the current branch onto another branch", () => {
    const base = seedRepo();
    const branched = createBranch(base, { name: "feature/x" });

    const featureState = commitOn(
      branched,
      "feature/x",
      "Feature edit",
      { "src/feature.rs": "feature\n" },
      2_000,
    );
    const mainState = commitOn(
      featureState,
      "main",
      "Main edit",
      { "src/main.rs": "main\n" },
      3_000,
    );

    const result = rebaseBranch(mainState, "feature/x", AUTHOR, 4_000);

    expect(result.status).toBe("clean");
    expect(result.replayedCommitIds).toHaveLength(1);
    expect(result.state.workingTree["src/feature.rs"]).toBe("feature\n");
    expect(result.state.workingTree["src/main.rs"]).toBe("main\n");
  });

  it("reports a conflict when the rebase cannot be applied", () => {
    const base = seedRepo({ "src/lib.rs": "fn main() {}\n" });
    const branched = createBranch(base, { name: "feature/x" });

    const featureState = commitOn(
      branched,
      "feature/x",
      "Feature edit",
      { "src/lib.rs": "feature\n" },
      2_000,
    );
    const mainState = commitOn(
      featureState,
      "main",
      "Main edit",
      { "src/lib.rs": "main\n" },
      3_000,
    );

    const result = rebaseBranch(mainState, "feature/x", AUTHOR, 4_000);
    expect(result.status).toBe("conflict");
    expect(result.conflicts.length).toBeGreaterThan(0);
  });

  it("refuses to rebase a branch onto itself", () => {
    const state = seedRepo();
    const result = rebaseBranch(state, "main", AUTHOR);
    expect(result.status).toBe("clean");
    expect(result.message).toContain("itself");
  });

  it("reports when the branch is already up to date", () => {
    const base = seedRepo();
    const branched = createBranch(base, { name: "feature/x" });
    const result = rebaseBranch(branched, "feature/x", AUTHOR);
    expect(result.status).toBe("clean");
    expect(result.message).toContain("up to date");
  });
});

describe("git/repository – commit graph", () => {
  it("produces an empty graph for a fresh repository", () => {
    const graph = getCommitGraph(createInitialState());
    expect(graph.nodes).toEqual([]);
    expect(graph.laneCount).toBe(1);
  });

  it("renders one node per commit", () => {
    const state = seedRepo();
    const graph = getCommitGraph(state);
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].isHead).toBe(true);
    expect(graph.nodes[0].isTip).toBe(true);
  });

  it("lists the branches pointing at a commit", () => {
    const state = seedRepo();
    const branched = createBranch(state, { name: "feature/x" });
    const graph = getCommitGraph(branched);
    expect(graph.nodes[0].branchNames).toEqual(
      expect.arrayContaining(["main", "feature/x"]),
    );
  });

  it("connects parents with children", () => {
    const state = seedRepo();
    const second = commitChanges(
      { ...state, workingTree: { ...state.workingTree, "a.txt": "a\n" } },
      { message: "Second", author: AUTHOR, now: 2_000 },
    ).state;

    const graph = getCommitGraph(second);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].to).toBe(graph.nodes[0].id);
  });

  it("never emits duplicate edges for duplicate parents", () => {
    const state = seedRepo();
    const second = commitChanges(
      { ...state, workingTree: { ...state.workingTree, "a.txt": "a\n" } },
      { message: "Second", author: AUTHOR, now: 2_000 },
    ).state;
    const head = second.head as string;
    const commit = second.commits[head];
    const parentId = state.head as string;
    const duplicated = {
      ...second,
      commits: {
        ...second.commits,
        [head]: { ...commit, parents: [parentId, parentId] },
      },
    };

    const graph = getCommitGraph(duplicated);
    const keys = graph.edges.map((edge) => `${edge.from}->${edge.to}`);
    expect(keys).toEqual([`${parentId}->${head}`]);
  });
});
