/**
 * Unit tests for the BranchConflictResolver component (issue #1727 / FE-27).
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import BranchConflictResolver from "@/components/Git/BranchConflictResolver";
import { useGitStore } from "@/state/gitStore";

function resetStore() {
  const store = useGitStore.getState();
  store.reset();
  store.setAuthor({ name: "Ada Lovelace", email: "ada@example.dev" });
}

beforeEach(() => {
  resetStore();
});

describe("components/Git/BranchConflictResolver", () => {
  it("renders the panel with the current branch", () => {
    render(<BranchConflictResolver />);

    expect(screen.getByTestId("branch-conflict-resolver")).toBeInTheDocument();
    expect(screen.getByTestId("current-branch")).toHaveTextContent("main");
  });

  it("creates the initial commit from the editor buffer", () => {
    render(<BranchConflictResolver code={"fn main() {}\n"} />);

    expect(useGitStore.getState().repo.head).not.toBeNull();
    expect(useGitStore.getState().repo.workingTree["src/lib.rs"]).toBe(
      "fn main() {}\n",
    );
  });

  it("marks files with uncommitted changes as dirty", () => {
    const { rerender } = render(
      <BranchConflictResolver code={"fn main() {}\n"} />,
    );
    rerender(<BranchConflictResolver code={"fn main() { /* changed */ }\n"} />);

    expect(screen.getByTestId("dirty-count")).toHaveTextContent("1 uncommitted");
    expect(screen.getAllByTestId("filetree-dirty").length).toBeGreaterThan(0);
  });

  it("commits the working tree", () => {
    const { rerender } = render(
      <BranchConflictResolver code={"fn main() {}\n"} />,
    );
    rerender(<BranchConflictResolver code={"fn main() { /* changed */ }\n"} />);

    fireEvent.change(screen.getByTestId("commit-message-input"), {
      target: { value: "Add the contract" },
    });
    fireEvent.click(screen.getByTestId("diff-reviewed-checkbox"));
    fireEvent.click(screen.getByTestId("commit-button"));

    expect(useGitStore.getState().repo.head).not.toBeNull();
    expect(
      Object.values(useGitStore.getState().repo.commits).some(
        (commit) => commit.message === "Add the contract",
      ),
    ).toBe(true);
    expect(screen.getByTestId("git-status-message")).toBeInTheDocument();
  });

  it("shows the diff and requires a review before committing", () => {
    const { rerender } = render(
      <BranchConflictResolver code={"fn main() {}\n"} />,
    );
    rerender(<BranchConflictResolver code={"fn main() { /* changed */ }\n"} />);

    expect(screen.getByTestId("commit-diff-review")).toBeInTheDocument();
    expect(screen.getAllByTestId("commit-diff-add").length).toBeGreaterThan(0);
    expect(screen.getByTestId("commit-button")).toBeDisabled();

    fireEvent.change(screen.getByTestId("commit-message-input"), {
      target: { value: "Reviewed change" },
    });
    fireEvent.click(screen.getByTestId("commit-button"));
    expect(
      Object.values(useGitStore.getState().repo.commits).some(
        (commit) => commit.message === "Reviewed change",
      ),
    ).toBe(false);

    fireEvent.click(screen.getByTestId("diff-reviewed-checkbox"));
    expect(screen.getByTestId("commit-button")).toBeEnabled();
  });

  it("renders the pull request form", () => {
    render(<BranchConflictResolver code={"fn main() {}\n"} />);
    expect(screen.getByTestId("pr-branch-input")).toBeInTheDocument();
    expect(screen.getByTestId("pr-title-input")).toBeInTheDocument();
    expect(screen.getByTestId("github-create-pr")).toBeDisabled();
  });

  it("creates a branch", () => {
    render(<BranchConflictResolver code={"fn main() {}\n"} />);

    fireEvent.change(screen.getByTestId("new-branch-input"), {
      target: { value: "feature/hello" },
    });
    fireEvent.click(screen.getByTestId("create-branch"));

    expect(useGitStore.getState().repo.branches["feature/hello"]).toBeDefined();
  });

  it("refuses to create a branch without a name", () => {
    render(<BranchConflictResolver code={"fn main() {}\n"} />);
    fireEvent.click(screen.getByTestId("create-branch"));
    expect(Object.keys(useGitStore.getState().repo.branches)).toHaveLength(1);
  });

  it("checks out a branch and writes the file back to the editor", () => {
    const onApplyCode = jest.fn();
    render(<BranchConflictResolver code={"fn main() {}\n"} onApplyCode={onApplyCode} />);

    fireEvent.change(screen.getByTestId("new-branch-input"), {
      target: { value: "feature/hello" },
    });
    fireEvent.click(screen.getByTestId("create-branch"));

    fireEvent.change(screen.getByTestId("branch-select"), {
      target: { value: "feature/hello" },
    });
    fireEvent.click(screen.getByTestId("checkout-branch"));

    expect(useGitStore.getState().repo.currentBranch).toBe("feature/hello");
    expect(onApplyCode).toHaveBeenCalledWith("fn main() {}\n");
  });

  it("shows the commit graph", () => {
    render(<BranchConflictResolver code={"fn main() {}\n"} />);
    expect(screen.getByTestId("commit-graph")).toBeInTheDocument();
  });

  it("merges a branch and reports the result", () => {
    render(<BranchConflictResolver code={"fn main() {}\n"} />);

    fireEvent.change(screen.getByTestId("new-branch-input"), {
      target: { value: "feature/hello" },
    });
    fireEvent.click(screen.getByTestId("create-branch"));

    fireEvent.change(screen.getByTestId("branch-select"), {
      target: { value: "feature/hello" },
    });
    fireEvent.click(screen.getByTestId("merge-branch"));

    expect(useGitStore.getState().repo.currentBranch).toBe("main");
    expect(screen.getByTestId("git-status-message")).toBeInTheDocument();
  });

  it("opens the conflict editor when a merge conflicts", async () => {
    const store = useGitStore.getState();
    store.setFile("src/lib.rs", "base\n");
    store.commit("Base");

    // Build a conflicting branch.
    store.createBranch("feature/hello");
    store.checkoutBranch("feature/hello");
    store.setFile("src/lib.rs", "feature\n");
    store.commit("Feature edit");
    store.checkoutBranch("main");
    store.setFile("src/lib.rs", "main\n");
    store.commit("Main edit");

    render(<BranchConflictResolver />);

    fireEvent.change(screen.getByTestId("branch-select"), {
      target: { value: "feature/hello" },
    });
    fireEvent.click(screen.getByTestId("merge-branch"));

    await waitFor(() => {
      expect(screen.getByTestId("conflict-editor")).toBeInTheDocument();
    });
    expect(screen.getByTestId("commit-merge")).toBeInTheDocument();
    expect(screen.getByTestId("cancel-merge")).toBeInTheDocument();
  });

  it("resolves a conflict and creates the merge commit", async () => {
    const store = useGitStore.getState();
    store.setFile("src/lib.rs", "base\n");
    store.commit("Base");
    store.createBranch("feature/hello");
    store.checkoutBranch("feature/hello");
    store.setFile("src/lib.rs", "feature\n");
    store.commit("Feature edit");
    store.checkoutBranch("main");
    store.setFile("src/lib.rs", "main\n");
    store.commit("Main edit");

    render(<BranchConflictResolver />);

    fireEvent.change(screen.getByTestId("branch-select"), {
      target: { value: "feature/hello" },
    });
    fireEvent.click(screen.getByTestId("merge-branch"));

    await waitFor(() => {
      expect(screen.getByTestId("conflict-1-accept-current")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("conflict-1-accept-current"));
    fireEvent.click(screen.getByTestId("commit-merge"));

    await waitFor(() => {
      expect(screen.queryByTestId("conflict-editor")).not.toBeInTheDocument();
    });

    expect(useGitStore.getState().repo.workingTree["src/lib.rs"]).toBe("main\n");
    const head = useGitStore.getState().repo.head as string;
    expect(useGitStore.getState().repo.commits[head].parents).toHaveLength(2);
  });

  it("aborts a pending merge", async () => {
    const store = useGitStore.getState();
    store.setFile("src/lib.rs", "base\n");
    store.commit("Base");
    store.createBranch("feature/hello");
    store.checkoutBranch("feature/hello");
    store.setFile("src/lib.rs", "feature\n");
    store.commit("Feature edit");
    store.checkoutBranch("main");
    store.setFile("src/lib.rs", "main\n");
    store.commit("Main edit");

    render(<BranchConflictResolver />);

    fireEvent.change(screen.getByTestId("branch-select"), {
      target: { value: "feature/hello" },
    });
    fireEvent.click(screen.getByTestId("merge-branch"));

    await waitFor(() => {
      expect(screen.getByTestId("conflict-editor")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("cancel-merge"));

    expect(screen.queryByTestId("conflict-editor")).not.toBeInTheDocument();
    expect(useGitStore.getState().conflicts).toHaveLength(0);
  });

  it("renders the GitHub remote panel", () => {
    render(<BranchConflictResolver code={"fn main() {}\n"} />);
    expect(screen.getByTestId("github-remote-panel")).toBeInTheDocument();
  });
});
