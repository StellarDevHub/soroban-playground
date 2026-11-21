/**
 * Unit tests for the FileTree component (Issue #923).
 *
 * Coverage:
 *  - Empty-state rendering
 *  - File leaf rendering (icon inference, active-state styling, aria attributes)
 *  - Folder rendering (open/close toggle, chevron, children visibility)
 *  - onSelectFile callback invocation
 *  - Keyboard accessibility (Enter / Space)
 *  - Nested hierarchy
 *  - Multiple roots
 */

import { fireEvent, render, screen } from "@testing-library/react";
import FileTree, { type FileTreeNode, flattenFileTree } from "../../components/FileTree";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const fileRs: FileTreeNode = {
  id: "src/lib.rs",
  name: "lib.rs",
  type: "file",
};

const fileCargo: FileTreeNode = {
  id: "Cargo.toml",
  name: "Cargo.toml",
  type: "file",
};

const folderSrc: FileTreeNode = {
  id: "src",
  name: "src",
  type: "folder",
  children: [fileRs],
};

const folderContracts: FileTreeNode = {
  id: "contracts",
  name: "contracts",
  type: "folder",
  children: [
    {
      id: "contracts/hello",
      name: "hello",
      type: "folder",
      children: [
        { id: "contracts/hello/lib.rs", name: "lib.rs", type: "file" },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FileTree", () => {
  // -------------------------------------------------------------------------
  // Empty state
  // -------------------------------------------------------------------------
  describe("empty state", () => {
    it("renders the default empty message when nodes array is empty", () => {
      render(<FileTree nodes={[]} />);
      expect(screen.getByTestId("filetree-empty")).toBeInTheDocument();
      expect(screen.getByText("No files found.")).toBeInTheDocument();
    });

    it("renders a custom emptyText when provided", () => {
      render(<FileTree nodes={[]} emptyText="Nothing here yet." />);
      expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
    });

    it("does NOT render the tree root when nodes is empty", () => {
      render(<FileTree nodes={[]} />);
      expect(screen.queryByTestId("filetree-root")).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Root rendering
  // -------------------------------------------------------------------------
  describe("tree root", () => {
    it("renders a <ul> with role='tree' when nodes are present", () => {
      render(<FileTree nodes={[fileRs]} />);
      const root = screen.getByTestId("filetree-root");
      expect(root).toBeInTheDocument();
      expect(root).toHaveAttribute("role", "tree");
    });

    it("applies an additional className from props", () => {
      render(<FileTree nodes={[fileRs]} className="overflow-y-auto" />);
      const root = screen.getByTestId("filetree-root");
      expect(root.className).toContain("overflow-y-auto");
    });
  });

  // -------------------------------------------------------------------------
  // File leaf
  // -------------------------------------------------------------------------
  describe("file leaf", () => {
    it("renders the file name", () => {
      render(<FileTree nodes={[fileRs]} />);
      expect(screen.getByText("lib.rs")).toBeInTheDocument();
    });

    it("has role='treeitem' and aria-selected='false' when not active", () => {
      render(<FileTree nodes={[fileRs]} activeNodeId={null} />);
      const item = screen.getByRole("treeitem", { name: "lib.rs" });
      expect(item).toHaveAttribute("aria-selected", "false");
    });

    it("has aria-selected='true' when it is the active node", () => {
      render(<FileTree nodes={[fileRs]} activeNodeId="src/lib.rs" />);
      const item = screen.getByRole("treeitem", { name: "lib.rs" });
      expect(item).toHaveAttribute("aria-selected", "true");
    });

    it("fires onSelectFile with the correct node on click", () => {
      const onSelect = jest.fn();
      render(<FileTree nodes={[fileRs]} onSelectFile={onSelect} />);
      fireEvent.click(screen.getByRole("treeitem", { name: "lib.rs" }));
      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledWith(fileRs);
    });

    it("fires onSelectFile on Enter keydown", () => {
      const onSelect = jest.fn();
      render(<FileTree nodes={[fileRs]} onSelectFile={onSelect} />);
      fireEvent.keyDown(screen.getByRole("treeitem", { name: "lib.rs" }), {
        key: "Enter",
      });
      expect(onSelect).toHaveBeenCalledWith(fileRs);
    });

    it("fires onSelectFile on Space keydown", () => {
      const onSelect = jest.fn();
      render(<FileTree nodes={[fileRs]} onSelectFile={onSelect} />);
      fireEvent.keyDown(screen.getByRole("treeitem", { name: "lib.rs" }), {
        key: " ",
      });
      expect(onSelect).toHaveBeenCalledWith(fileRs);
    });

    it("does NOT fire onSelectFile on unrelated keydown", () => {
      const onSelect = jest.fn();
      render(<FileTree nodes={[fileRs]} onSelectFile={onSelect} />);
      fireEvent.keyDown(screen.getByRole("treeitem", { name: "lib.rs" }), {
        key: "Tab",
      });
      expect(onSelect).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Folder
  // -------------------------------------------------------------------------
  describe("folder", () => {
    it("renders the folder name", () => {
      render(<FileTree nodes={[folderSrc]} />);
      expect(screen.getByText("src")).toBeInTheDocument();
    });

    it("has role='treeitem' and aria-expanded attribute", () => {
      render(<FileTree nodes={[folderSrc]} />);
      const folder = screen.getByRole("treeitem", { name: "src" });
      expect(folder).toHaveAttribute("aria-expanded");
    });

    it("shows children by default (defaultOpen=true for root folders)", () => {
      render(<FileTree nodes={[folderSrc]} />);
      // lib.rs is a child of src
      expect(screen.getByText("lib.rs")).toBeInTheDocument();
    });

    it("hides children after clicking the folder header to close it", () => {
      render(<FileTree nodes={[folderSrc]} />);
      // The clickable header is the div[role='button'] inside the <li>
      const folderHeader = screen
        .getByRole("treeitem", { name: "src" })
        .querySelector("[role='button']") as HTMLElement;
      fireEvent.click(folderHeader);
      expect(screen.queryByText("lib.rs")).not.toBeInTheDocument();
    });

    it("toggles open again on a second click", () => {
      render(<FileTree nodes={[folderSrc]} />);
      const folderHeader = screen
        .getByRole("treeitem", { name: "src" })
        .querySelector("[role='button']") as HTMLElement;
      fireEvent.click(folderHeader); // close
      fireEvent.click(folderHeader); // re-open
      expect(screen.getByText("lib.rs")).toBeInTheDocument();
    });

    it("toggles on Enter keydown on the folder treeitem", () => {
      render(<FileTree nodes={[folderSrc]} />);
      const folder = screen.getByRole("treeitem", { name: "src" });
      fireEvent.keyDown(folder, { key: "Enter" });
      expect(screen.queryByText("lib.rs")).not.toBeInTheDocument();
    });

    it("does NOT call onSelectFile when toggling a folder", () => {
      const onSelect = jest.fn();
      render(<FileTree nodes={[folderSrc]} onSelectFile={onSelect} />);
      const folderHeader = screen
        .getByRole("treeitem", { name: "src" })
        .querySelector("[role='button']") as HTMLElement;
      fireEvent.click(folderHeader);
      expect(onSelect).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Mixed roots
  // -------------------------------------------------------------------------
  describe("multiple root nodes", () => {
    it("renders both file and folder roots", () => {
      render(<FileTree nodes={[folderSrc, fileCargo]} />);
      expect(screen.getByText("src")).toBeInTheDocument();
      expect(screen.getByText("Cargo.toml")).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Deep nesting
  // -------------------------------------------------------------------------
  describe("nested folders", () => {
    it("renders deeply nested file nodes", () => {
      render(<FileTree nodes={[folderContracts]} />);
      // Root folder is open by default
      expect(screen.getByText("contracts")).toBeInTheDocument();
      // Child folder "hello" is NOT set to defaultOpen (depth>0) — it starts closed
      // so we click it to open
      const helloHeader = screen
        .getByRole("treeitem", { name: "hello" })
        .querySelector("[role='button']") as HTMLElement;
      fireEvent.click(helloHeader);
      expect(screen.getByText("lib.rs")).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Dirty file indicators (issue #1727)
  // -------------------------------------------------------------------------
  describe("dirty indicators", () => {
    it("does not render the marker for a clean file", () => {
      render(<FileTree nodes={[fileRs]} />);
      expect(screen.queryByTestId("filetree-dirty")).not.toBeInTheDocument();
    });

    it("renders the marker for a dirty file", () => {
      render(<FileTree nodes={[{ ...fileRs, dirty: true }]} />);
      expect(screen.getByTestId("filetree-dirty")).toBeInTheDocument();
    });

    it("renders the Git status badge", () => {
      render(
        <FileTree nodes={[{ ...fileRs, dirty: true, status: "M" }]} />,
      );
      expect(screen.getByTestId("filetree-dirty")).toHaveTextContent("M");
    });

    it("falls back to the modified badge", () => {
      render(<FileTree nodes={[{ ...fileRs, dirty: true }]} />);
      expect(screen.getByTestId("filetree-dirty")).toHaveTextContent("M");
    });

    it("marks the file with an accessible label", () => {
      render(<FileTree nodes={[{ ...fileRs, dirty: true }]} />);
      expect(
        screen.getByLabelText("Uncommitted changes in lib.rs"),
      ).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // onSelectFile not provided (no crash)
  // -------------------------------------------------------------------------
  describe("optional callbacks", () => {
    it("does not throw when onSelectFile is not provided and a file is clicked", () => {
      render(<FileTree nodes={[fileRs]} />);
      expect(() =>
        fireEvent.click(screen.getByRole("treeitem", { name: "lib.rs" })),
      ).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Issue #2044: Virtualization, Flattening & Drag-and-Drop Reordering
  // -------------------------------------------------------------------------
  describe("flattenFileTree helper", () => {
    it("flattens tree respecting open and closed folder states", () => {
      const openSet = new Set(["src"]);
      const flat = flattenFileTree([folderSrc, fileCargo], openSet);
      expect(flat).toHaveLength(3); // folderSrc, fileRs, fileCargo
      expect(flat[0].node.id).toBe("src");
      expect(flat[1].node.id).toBe("src/lib.rs");
      expect(flat[1].depth).toBe(1);
      expect(flat[2].node.id).toBe("Cargo.toml");
      expect(flat[2].depth).toBe(0);
    });

    it("omits children when parent folder is closed", () => {
      const closedSet = new Set<string>();
      const flat = flattenFileTree([folderSrc, fileCargo], closedSet);
      expect(flat).toHaveLength(2); // folderSrc, fileCargo
      expect(flat.find((i) => i.node.id === "src/lib.rs")).toBeUndefined();
    });
  });

  describe("virtualized mode", () => {
    it("renders virtualized list container when virtualized prop is true", () => {
      render(<FileTree nodes={[folderSrc, fileCargo]} virtualized={true} virtualHeight={300} />);
      const tree = screen.getByRole("tree");
      expect(tree).toBeInTheDocument();
      expect(screen.getByText("Cargo.toml")).toBeInTheDocument();
    });
  });

  describe("drag and drop reordering", () => {
    it("triggers onMoveNode callback when dropping a node into a target folder", () => {
      const handleMove = jest.fn();
      render(<FileTree nodes={[fileRs, folderContracts]} onMoveNode={handleMove} />);

      const fileItem = screen.getByRole("treeitem", { name: "lib.rs" });
      const folderItem = screen.getByRole("treeitem", { name: "contracts" });

      // Start dragging file
      fireEvent.dragStart(fileItem, {
        dataTransfer: { setData: jest.fn(), getData: jest.fn() },
      });

      // Drag over and drop on contracts folder
      fireEvent.dragOver(folderItem, {
        dataTransfer: { dropEffect: "move" },
      });
      fireEvent.drop(folderItem);

      expect(handleMove).toHaveBeenCalledWith("src/lib.rs", "contracts");
    });
  });

  describe("inline CRUD operations with optimistic updates", () => {
    it("creates a new file optimistically when using toolbar", () => {
      const handleCreate = jest.fn();
      render(<FileTree nodes={[fileCargo]} onCreateNode={handleCreate} />);

      const newFileBtn = screen.getByTestId("filetree-new-file");
      fireEvent.click(newFileBtn);

      const inlineInput = screen.getByTestId("filetree-inline-input");
      expect(inlineInput).toBeInTheDocument();

      fireEvent.change(inlineInput, { target: { value: "README.md" } });
      fireEvent.keyDown(inlineInput, { key: "Enter" });

      expect(handleCreate).toHaveBeenCalledWith(null, "README.md", "file");
      expect(screen.getByText("README.md")).toBeInTheDocument();
    });

    it("renames a node optimistically", () => {
      const handleRename = jest.fn();
      render(<FileTree nodes={[fileCargo]} onRenameNode={handleRename} />);

      const renameBtn = screen.getByTestId("filetree-rename-Cargo.toml");
      fireEvent.click(renameBtn);

      const renameInput = screen.getByTestId("filetree-rename-input-Cargo.toml");
      expect(renameInput).toBeInTheDocument();

      fireEvent.change(renameInput, { target: { value: "Cargo_v2.toml" } });
      fireEvent.keyDown(renameInput, { key: "Enter" });

      expect(handleRename).toHaveBeenCalledWith("Cargo.toml", "Cargo_v2.toml");
      expect(screen.getByText("Cargo_v2.toml")).toBeInTheDocument();
    });

    it("deletes a node optimistically", () => {
      const handleDelete = jest.fn();
      render(<FileTree nodes={[fileCargo]} onDeleteNode={handleDelete} />);

      const deleteBtn = screen.getByTestId("filetree-delete-Cargo.toml");
      fireEvent.click(deleteBtn);

      expect(handleDelete).toHaveBeenCalledWith("Cargo.toml");
      expect(screen.queryByText("Cargo.toml")).not.toBeInTheDocument();
    });
  });
});
