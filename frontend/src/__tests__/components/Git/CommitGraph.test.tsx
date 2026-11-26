/**
 * Unit tests for the CommitGraph component (issue #1727 / FE-27).
 */

import { fireEvent, render, screen } from "@testing-library/react";
import CommitGraph from "@/components/Git/CommitGraph";
import { getCommitGraph } from "@/lib/git/repository";
import type { GitAuthor, GitState } from "@/lib/git/types";

const AUTHOR: GitAuthor = { name: "Ada Lovelace", email: "ada@example.dev" };

function buildState(): GitState {
  return {
    currentBranch: "main",
    head: "b".repeat(40),
    branches: {
      main: { name: "main", head: "b".repeat(40) },
    },
    commits: {
      ["b".repeat(40)]: {
        id: "b".repeat(40),
        message: "Add the counter contract",
        author: { ...AUTHOR, avatarUrl: "https://avatars.example/ada.png" },
        timestamp: 1_700_000_000_000,
        tree: { "src/lib.rs": "fn main() {}\n" },
        parents: ["a".repeat(40)],
      },
      ["a".repeat(40)]: {
        id: "a".repeat(40),
        message: "Initial commit",
        author: AUTHOR,
        timestamp: 1_699_000_000_000,
        tree: {},
        parents: [],
      },
    },
    workingTree: {},
    stagedTree: {},
    remote: null,
    pushedCommits: [],
    remoteHeads: {},
  };
}

describe("components/Git/CommitGraph", () => {
  it("renders an empty state when there is no commit", () => {
    render(
      <CommitGraph
        graph={{ nodes: [], edges: [], laneCount: 1 }}
      />,
    );
    expect(screen.getByTestId("commit-graph-empty")).toBeInTheDocument();
  });

  it("renders one node per commit", () => {
    const graph = getCommitGraph(buildState());
    render(<CommitGraph graph={graph} />);

    expect(screen.getByTestId("commit-graph")).toBeInTheDocument();
    expect(screen.getAllByTestId("commit-graph-node")).toHaveLength(2);
  });

  it("renders the commit messages", () => {
    const graph = getCommitGraph(buildState());
    render(<CommitGraph graph={graph} />);

    const messages = screen.getAllByTestId("commit-graph-message");
    expect(messages[0]).toHaveTextContent("Add the counter contract");
    expect(messages[1]).toHaveTextContent("Initial commit");
  });

  it("draws an edge between a commit and its parent", () => {
    const graph = getCommitGraph(buildState());
    render(<CommitGraph graph={graph} />);
    expect(screen.getAllByTestId("commit-graph-edge")).toHaveLength(1);
  });

  it("renders the author avatar", () => {
    const graph = getCommitGraph(buildState());
    render(<CommitGraph graph={graph} />);
    expect(screen.getAllByTestId("commit-graph-avatar").length).toBeGreaterThan(0);
  });

  it("falls back to the initials when no avatar is available", () => {
    const graph = getCommitGraph(buildState());
    render(<CommitGraph graph={graph} />);
    expect(
      screen.getAllByTestId("commit-graph-avatar-fallback")[0],
    ).toHaveTextContent("AL");
  });

  it("labels the branches pointing at a commit", () => {
    const graph = getCommitGraph(buildState());
    render(<CommitGraph graph={graph} />);
    expect(screen.getAllByTestId("commit-graph-branch")[0]).toBeInTheDocument();
  });

  it("reports the selected commit", () => {
    const graph = getCommitGraph(buildState());
    const onSelectCommit = jest.fn();
    render(<CommitGraph graph={graph} onSelectCommit={onSelectCommit} />);

    fireEvent.click(screen.getAllByTestId("commit-graph-node")[0]);
    expect(onSelectCommit).toHaveBeenCalledWith("b".repeat(40));
  });
});
