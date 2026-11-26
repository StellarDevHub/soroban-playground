"use client";

/**
 * FileTree – a high-performance, virtualized file-explorer component for the Soroban
 * Playground IDE with drag-and-drop reordering, optimistic inline CRUD, and keyboard navigation.
 *
 * Resolves Issue #2044 [FRONTEND-274]
 */

import React, {
  KeyboardEvent,
  memo,
  useCallback,
  useId,
  useState,
  useMemo,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  File,
  FileCode,
  FileJson,
  FileLock,
  FileText,
  Folder,
  FolderOpen,
  Plus,
  FolderPlus,
  Edit2,
  Trash2,
  Check,
  X,
} from "lucide-react";
import { List, type RowComponentProps } from "react-window";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface FileTreeNode {
  id: string;
  name: string;
  type: "file" | "folder";
  children?: FileTreeNode[];
  extension?: string;
  dirty?: boolean;
  status?: string;
}

export interface FileTreeProps {
  nodes: FileTreeNode[];
  activeNodeId?: string | null;
  onSelectFile?: (node: FileTreeNode) => void;
  className?: string;
  emptyText?: string;
  virtualized?: boolean;
  virtualHeight?: number;
  onMoveNode?: (sourceId: string, targetFolderId: string | null) => void;
  onCreateNode?: (parentId: string | null, name: string, type: "file" | "folder") => void;
  onRenameNode?: (nodeId: string, newName: string) => void;
  onDeleteNode?: (nodeId: string) => void;
}

export interface FlatFileNode {
  node: FileTreeNode;
  depth: number;
  parentId: string | null;
  isOpen?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getExtension(name: string, hint?: string): string {
  if (hint) return hint.toLowerCase().replace(/^\./, "");
  const dot = name.lastIndexOf(".");
  return dot !== -1 ? name.slice(dot + 1).toLowerCase() : "";
}

export function resolveFileIcon(
  ext: string
): React.ComponentType<{ className?: string; size?: number }> {
  switch (ext) {
    case "rs":
      return FileCode;
    case "json":
    case "toml":
    case "yaml":
    case "yml":
      return FileJson;
    case "md":
    case "txt":
      return FileText;
    case "lock":
      return FileLock;
    default:
      return File;
  }
}

function FileIconDisplay({ ext, isActive }: { ext: string; isActive: boolean }) {
  const iconClass = [
    "shrink-0 transition-colors",
    isActive ? "text-teal-400" : "text-slate-500 group-hover:text-slate-300",
  ].join(" ");

  switch (ext) {
    case "rs":
      return <FileCode size={13} className={iconClass} />;
    case "json":
    case "toml":
    case "yaml":
    case "yml":
      return <FileJson size={13} className={iconClass} />;
    case "md":
    case "txt":
      return <FileText size={13} className={iconClass} />;
    case "lock":
      return <FileLock size={13} className={iconClass} />;
    default:
      return <File size={13} className={iconClass} />;
  }
}

function FolderIconDisplay({ open }: { open: boolean }) {
  const iconClass = [
    "shrink-0 transition-colors",
    open ? "text-teal-400/80" : "text-slate-500 group-hover:text-slate-300",
  ].join(" ");

  return open ? (
    <FolderOpen size={13} className={iconClass} />
  ) : (
    <Folder size={13} className={iconClass} />
  );
}

/**
 * Flattens nested directory tree into a 1D list of currently visible nodes
 */
export function flattenFileTree(
  nodes: FileTreeNode[],
  openFolderIds: Set<string>,
  depth = 0,
  parentId: string | null = null
): FlatFileNode[] {
  const result: FlatFileNode[] = [];
  for (const node of nodes) {
    const isOpen = node.type === "folder" ? openFolderIds.has(node.id) : undefined;
    result.push({ node, depth, parentId, isOpen });
    if (node.type === "folder" && isOpen && node.children && node.children.length > 0) {
      result.push(...flattenFileTree(node.children, openFolderIds, depth + 1, node.id));
    }
  }
  return result;
}

// Immutable tree manipulation helpers for optimistic UI updates
function cloneTree(nodes: FileTreeNode[]): FileTreeNode[] {
  return nodes.map((node) => ({
    ...node,
    children: node.children ? cloneTree(node.children) : undefined,
  }));
}

function removeNodeFromTree(nodes: FileTreeNode[], id: string): { updated: FileTreeNode[]; removed: FileTreeNode | null } {
  let removed: FileTreeNode | null = null;
  const filterList = (list: FileTreeNode[]): FileTreeNode[] => {
    const next: FileTreeNode[] = [];
    for (const item of list) {
      if (item.id === id) {
        removed = item;
      } else {
        if (item.children) {
          const res = removeNodeFromTree(item.children, id);
          if (res.removed) removed = res.removed;
          next.push({ ...item, children: res.updated });
        } else {
          next.push(item);
        }
      }
    }
    return next;
  };
  return { updated: filterList(nodes), removed };
}

function insertNodeIntoTree(nodes: FileTreeNode[], targetFolderId: string | null, nodeToInsert: FileTreeNode): FileTreeNode[] {
  if (targetFolderId === null) {
    return [...nodes, nodeToInsert];
  }
  return nodes.map((item) => {
    if (item.id === targetFolderId && item.type === "folder") {
      return {
        ...item,
        children: [...(item.children ?? []), nodeToInsert],
      };
    }
    if (item.children) {
      return {
        ...item,
        children: insertNodeIntoTree(item.children, targetFolderId, nodeToInsert),
      };
    }
    return item;
  });
}

function renameNodeInTree(nodes: FileTreeNode[], id: string, newName: string): FileTreeNode[] {
  return nodes.map((item) => {
    if (item.id === id) {
      return { ...item, name: newName };
    }
    if (item.children) {
      return { ...item, children: renameNodeInTree(item.children, id, newName) };
    }
    return item;
  });
}

// ---------------------------------------------------------------------------
// FileNode Component
// ---------------------------------------------------------------------------

interface FileNodeProps {
  node: FileTreeNode;
  depth: number;
  isActive: boolean;
  onSelect: (node: FileTreeNode) => void;
  treeId: string;
  onDragStart?: (e: React.DragEvent, node: FileTreeNode) => void;
  onDragOver?: (e: React.DragEvent, node: FileTreeNode) => void;
  onDrop?: (e: React.DragEvent, node: FileTreeNode) => void;
  onRename?: (id: string, newName: string) => void;
  onDelete?: (id: string) => void;
}

const FileNode = memo(function FileNode({
  node,
  depth,
  isActive,
  onSelect,
  treeId,
  onDragStart,
  onDragOver,
  onDrop,
  onRename,
  onDelete,
}: FileNodeProps) {
  const ext = getExtension(node.name, node.extension);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(node.name);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLLIElement>) => {
      if (isRenaming) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect(node);
      }
    },
    [isRenaming, node, onSelect]
  );

  const handleRenameSubmit = () => {
    if (renameValue.trim() && renameValue.trim() !== node.name) {
      onRename?.(node.id, renameValue.trim());
    }
    setIsRenaming(false);
  };

  return (
    <li
      id={`${treeId}-node-${node.id}`}
      role="treeitem"
      aria-selected={isActive}
      tabIndex={0}
      draggable={!isRenaming}
      onDragStart={(e) => onDragStart?.(e, node)}
      onDragOver={(e) => onDragOver?.(e, node)}
      onDrop={(e) => onDrop?.(e, node)}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
      className={[
        "group relative flex items-center gap-2 py-1 pr-2 rounded-lg cursor-pointer",
        "text-xs font-medium select-none outline-none",
        "transition-colors duration-100",
        isActive
          ? "bg-teal-500/15 border border-teal-500/25 text-teal-300"
          : "text-slate-400 hover:text-slate-200 hover:bg-white/[0.03] border border-transparent",
        "focus-visible:ring-1 focus-visible:ring-teal-400/60",
      ].join(" ")}
      onClick={() => onSelect(node)}
      onKeyDown={handleKeyDown}
      aria-label={node.name}
    >
      <FileIconDisplay ext={ext} isActive={isActive} />

      {isRenaming ? (
        <div className="flex items-center gap-1 flex-1" onClick={(e) => e.stopPropagation()}>
          <input
            type="text"
            data-testid={`filetree-rename-input-${node.id}`}
            value={renameValue}
            autoFocus
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRenameSubmit();
              if (e.key === "Escape") setIsRenaming(false);
            }}
            className="w-full px-1.5 py-0.5 text-xs bg-gray-950 border border-teal-500 rounded text-teal-200 font-mono"
          />
          <button
            type="button"
            onClick={handleRenameSubmit}
            className="p-0.5 hover:text-teal-400 text-gray-400"
          >
            <Check size={12} />
          </button>
          <button
            type="button"
            onClick={() => setIsRenaming(false)}
            className="p-0.5 hover:text-rose-400 text-gray-400"
          >
            <X size={12} />
          </button>
        </div>
      ) : (
        <>
          <span className="truncate">{node.name}</span>
          {node.dirty && (
            <span
              data-testid="filetree-dirty"
              title="Uncommitted changes"
              aria-label={`Uncommitted changes in ${node.name}`}
              className="ml-auto shrink-0 rounded bg-amber-400/15 px-1 font-mono text-[9px] font-semibold text-amber-300"
            >
              {node.status ?? "M"}
            </span>
          )}
          {ext && (
            <span
              className={[
                "font-mono text-[9px] text-slate-600 group-hover:text-slate-500 shrink-0",
                node.dirty ? "ml-1" : "ml-auto",
              ].join(" ")}
            >
              .{ext}
            </span>
          )}

          {/* Inline Action Buttons (Hover) */}
          <div className="ml-1 opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity">
            <button
              type="button"
              data-testid={`filetree-rename-${node.id}`}
              aria-label="Rename"
              onClick={(e) => {
                e.stopPropagation();
                setIsRenaming(true);
              }}
              className="p-0.5 text-gray-500 hover:text-teal-400 hover:bg-gray-800 rounded"
            >
              <Edit2 size={11} />
            </button>
            <button
              type="button"
              data-testid={`filetree-delete-${node.id}`}
              aria-label="Delete"
              onClick={(e) => {
                e.stopPropagation();
                onDelete?.(node.id);
              }}
              className="p-0.5 text-gray-500 hover:text-rose-400 hover:bg-rose-950/40 rounded"
            >
              <Trash2 size={11} />
            </button>
          </div>
        </>
      )}
    </li>
  );
});

// ---------------------------------------------------------------------------
// FolderNode Component
// ---------------------------------------------------------------------------

interface FolderNodeProps {
  node: FileTreeNode;
  depth: number;
  activeNodeId: string | null | undefined;
  onSelect: (node: FileTreeNode) => void;
  treeId: string;
  defaultOpen?: boolean;
  onDragStart?: (e: React.DragEvent, node: FileTreeNode) => void;
  onDragOver?: (e: React.DragEvent, node: FileTreeNode) => void;
  onDrop?: (e: React.DragEvent, node: FileTreeNode) => void;
  onRename?: (id: string, newName: string) => void;
  onDelete?: (id: string) => void;
  onCreateInFolder?: (parentId: string, type: "file" | "folder") => void;
}

const FolderNode = memo(function FolderNode({
  node,
  depth,
  activeNodeId,
  onSelect,
  treeId,
  defaultOpen = false,
  onDragStart,
  onDragOver,
  onDrop,
  onRename,
  onDelete,
  onCreateInFolder,
}: FolderNodeProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(node.name);

  const toggle = useCallback(() => setOpen((o) => !o), []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLLIElement>) => {
      if (isRenaming) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    },
    [isRenaming, toggle]
  );

  const handleRenameSubmit = () => {
    if (renameValue.trim() && renameValue.trim() !== node.name) {
      onRename?.(node.id, renameValue.trim());
    }
    setIsRenaming(false);
  };

  const ChevronIcon = open ? ChevronDown : ChevronRight;

  return (
    <li
      id={`${treeId}-node-${node.id}`}
      role="treeitem"
      aria-expanded={open}
      aria-selected={false}
      aria-label={node.name}
      tabIndex={0}
      draggable={!isRenaming}
      onDragStart={(e) => onDragStart?.(e, node)}
      onDragOver={(e) => onDragOver?.(e, node)}
      onDrop={(e) => onDrop?.(e, node)}
      className="select-none outline-none focus-visible:ring-1 focus-visible:ring-teal-400/60 rounded-lg"
      onKeyDown={handleKeyDown}
    >
      {/* Header row */}
      <div
        role="button"
        tabIndex={-1}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        className="group flex items-center gap-2 py-1 pr-2 rounded-lg cursor-pointer text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-white/[0.03] border border-transparent transition-colors"
        onClick={toggle}
        aria-hidden
      >
        <ChevronIcon
          size={11}
          className="shrink-0 text-slate-600 group-hover:text-slate-400 transition-transform"
        />
        <FolderIconDisplay open={open} />

        {isRenaming ? (
          <div className="flex items-center gap-1 flex-1" onClick={(e) => e.stopPropagation()}>
            <input
              type="text"
              data-testid={`filetree-rename-input-${node.id}`}
              value={renameValue}
              autoFocus
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRenameSubmit();
                if (e.key === "Escape") setIsRenaming(false);
              }}
              className="w-full px-1.5 py-0.5 text-xs bg-gray-950 border border-teal-500 rounded text-teal-200 font-mono"
            />
            <button
              type="button"
              onClick={handleRenameSubmit}
              className="p-0.5 hover:text-teal-400 text-gray-400"
            >
              <Check size={12} />
            </button>
            <button
              type="button"
              onClick={() => setIsRenaming(false)}
              className="p-0.5 hover:text-rose-400 text-gray-400"
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <>
            <span className="truncate">{node.name}</span>
            {node.children !== undefined && (
              <span className="ml-auto font-mono text-[9px] text-slate-600 shrink-0">
                {node.children.length}
              </span>
            )}

            {/* Folder Action Buttons */}
            <div className="ml-1 opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity">
              <button
                type="button"
                data-testid={`filetree-add-file-${node.id}`}
                aria-label="New file in folder"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(true);
                  onCreateInFolder?.(node.id, "file");
                }}
                className="p-0.5 text-gray-500 hover:text-teal-400 hover:bg-gray-800 rounded"
              >
                <Plus size={11} />
              </button>
              <button
                type="button"
                data-testid={`filetree-rename-${node.id}`}
                aria-label="Rename folder"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsRenaming(true);
                }}
                className="p-0.5 text-gray-500 hover:text-teal-400 hover:bg-gray-800 rounded"
              >
                <Edit2 size={11} />
              </button>
              <button
                type="button"
                data-testid={`filetree-delete-${node.id}`}
                aria-label="Delete folder"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete?.(node.id);
                }}
                className="p-0.5 text-gray-500 hover:text-rose-400 hover:bg-rose-950/40 rounded"
              >
                <Trash2 size={11} />
              </button>
            </div>
          </>
        )}
      </div>

      {/* Children */}
      {open && node.children && node.children.length > 0 && (
        <ul role="group" className="mt-0.5 space-y-0.5">
          {node.children.map((child) =>
            child.type === "folder" ? (
              <FolderNode
                key={child.id}
                node={child}
                depth={depth + 1}
                activeNodeId={activeNodeId}
                onSelect={onSelect}
                treeId={treeId}
                onDragStart={onDragStart}
                onDragOver={onDragOver}
                onDrop={onDrop}
                onRename={onRename}
                onDelete={onDelete}
                onCreateInFolder={onCreateInFolder}
              />
            ) : (
              <FileNode
                key={child.id}
                node={child}
                depth={depth + 1}
                isActive={activeNodeId === child.id}
                onSelect={onSelect}
                treeId={treeId}
                onDragStart={onDragStart}
                onDragOver={onDragOver}
                onDrop={onDrop}
                onRename={onRename}
                onDelete={onDelete}
              />
            )
          )}
        </ul>
      )}
    </li>
  );
});

// ---------------------------------------------------------------------------
// Virtualized Row Component
// ---------------------------------------------------------------------------

interface VirtualRowProps {
  items: FlatFileNode[];
  activeNodeId?: string | null;
  onSelect: (node: FileTreeNode) => void;
  treeId: string;
  onToggleFolder: (id: string) => void;
}

function VirtualRow({
  index,
  style,
  items,
  activeNodeId,
  onSelect,
  treeId,
  onToggleFolder,
}: RowComponentProps<VirtualRowProps>) {
  const item = items?.[index];
  if (!item) return null;

  const { node, depth, isOpen } = item;
  const isActive = activeNodeId === node.id;
  const isFolder = node.type === "folder";

  const ext = getExtension(node.name, node.extension);
  const ChevronIcon = isOpen ? ChevronDown : ChevronRight;

  return (
    <div style={style} className="px-1">
      <div
        role="treeitem"
        id={`${treeId}-node-${node.id}`}
        aria-selected={!isFolder ? isActive : false}
        aria-expanded={isFolder ? isOpen : undefined}
        tabIndex={0}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        onClick={() => {
          if (isFolder) {
            onToggleFolder(node.id);
          } else {
            onSelect(node);
          }
        }}
        className={[
          "group flex items-center gap-2 h-7 rounded-md cursor-pointer text-xs font-mono select-none outline-none transition-colors",
          isActive
            ? "bg-teal-500/15 border border-teal-500/30 text-teal-300"
            : "text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]",
        ].join(" ")}
      >
        {isFolder && <ChevronIcon size={11} className="shrink-0 text-slate-500" />}
        {isFolder ? (
          <FolderIconDisplay open={Boolean(isOpen)} />
        ) : (
          <FileIconDisplay ext={ext} isActive={isActive} />
        )}
        <span className="truncate">{node.name}</span>
        {node.dirty && (
          <span
            data-testid="filetree-dirty"
            className="ml-auto shrink-0 rounded bg-amber-400/15 px-1 text-[9px] font-semibold text-amber-300"
          >
            {node.status ?? "M"}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FileTree Main Component
// ---------------------------------------------------------------------------

export const FileTree: React.FC<FileTreeProps> = ({
  nodes: initialNodes,
  activeNodeId,
  onSelectFile,
  className = "",
  emptyText = "No files found.",
  virtualized = false,
  virtualHeight = 360,
  onMoveNode,
  onCreateNode,
  onRenameNode,
  onDeleteNode,
}) => {
  const treeId = useId();
  const [nodes, setNodes] = useState<FileTreeNode[]>(initialNodes);
  const [prevInitialNodes, setPrevInitialNodes] = useState<FileTreeNode[]>(initialNodes);
  const [draggedNode, setDraggedNode] = useState<FileTreeNode | null>(null);

  // Sync state if initialNodes prop reference changes without cascading effect warning
  if (initialNodes !== prevInitialNodes) {
    setPrevInitialNodes(initialNodes);
    setNodes(initialNodes);
  }

  // Open folder state for virtualization
  const [openFolderIds, setOpenFolderIds] = useState<Set<string>>(() => {
    const set = new Set<string>();
    for (const n of initialNodes) {
      if (n.type === "folder") set.add(n.id);
    }
    return set;
  });

  const toggleFolder = useCallback((id: string) => {
    setOpenFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Inline creation state
  const [creatingType, setCreatingType] = useState<"file" | "folder" | null>(null);
  const [creatingParentId, setCreatingParentId] = useState<string | null>(null);
  const [newEntryName, setNewEntryName] = useState("");

  const handleSelect = useCallback(
    (node: FileTreeNode) => {
      onSelectFile?.(node);
    },
    [onSelectFile]
  );

  // Drag and Drop handlers
  const handleDragStart = useCallback((e: React.DragEvent, node: FileTreeNode) => {
    e.stopPropagation();
    setDraggedNode(node);
    e.dataTransfer.setData("text/plain", node.id);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, targetNode: FileTreeNode) => {
      e.preventDefault();
      e.stopPropagation();
      if (!draggedNode || draggedNode.id === targetNode.id) return;

      const targetFolderId = targetNode.type === "folder" ? targetNode.id : null;

      // Optimistic update
      setNodes((current) => {
        const cloned = cloneTree(current);
        const { updated, removed } = removeNodeFromTree(cloned, draggedNode.id);
        if (!removed) return current;
        return insertNodeIntoTree(updated, targetFolderId, removed);
      });

      onMoveNode?.(draggedNode.id, targetFolderId);
      setDraggedNode(null);
    },
    [draggedNode, onMoveNode]
  );

  // Inline CRUD Handlers (Optimistic Updates)
  const handleCreateSubmit = () => {
    if (!newEntryName.trim() || !creatingType) {
      setCreatingType(null);
      setNewEntryName("");
      return;
    }

    const name = newEntryName.trim();
    const id = creatingParentId ? `${creatingParentId}/${name}` : name;
    const newNode: FileTreeNode = {
      id,
      name,
      type: creatingType,
      children: creatingType === "folder" ? [] : undefined,
    };

    setNodes((current) => insertNodeIntoTree(cloneTree(current), creatingParentId, newNode));
    onCreateNode?.(creatingParentId, name, creatingType);

    setCreatingType(null);
    setNewEntryName("");
  };

  const handleRename = useCallback(
    (id: string, newName: string) => {
      setNodes((current) => renameNodeInTree(cloneTree(current), id, newName));
      onRenameNode?.(id, newName);
    },
    [onRenameNode]
  );

  const handleDelete = useCallback(
    (id: string) => {
      setNodes((current) => removeNodeFromTree(cloneTree(current), id).updated);
      onDeleteNode?.(id);
    },
    [onDeleteNode]
  );

  const flatItems = useMemo(
    () => flattenFileTree(nodes, openFolderIds),
    [nodes, openFolderIds]
  );

  if (nodes.length === 0) {
    return (
      <p
        className="py-8 text-center text-xs text-slate-500"
        aria-live="polite"
        data-testid="filetree-empty"
      >
        {emptyText}
      </p>
    );
  }

  return (
    <div className="flex flex-col w-full">
      {/* Explorer Action Toolbar */}
      <div className="flex items-center justify-between px-2 py-1 mb-1 border-b border-gray-800 text-xs text-gray-400">
        <span className="font-mono text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
          Explorer
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            data-testid="filetree-new-file"
            aria-label="New File"
            onClick={() => {
              setCreatingType("file");
              setCreatingParentId(null);
            }}
            className="p-1 rounded hover:bg-gray-800 hover:text-teal-400 transition-colors"
            title="New File"
          >
            <Plus size={13} />
          </button>
          <button
            type="button"
            data-testid="filetree-new-folder"
            aria-label="New Folder"
            onClick={() => {
              setCreatingType("folder");
              setCreatingParentId(null);
            }}
            className="p-1 rounded hover:bg-gray-800 hover:text-teal-400 transition-colors"
            title="New Folder"
          >
            <FolderPlus size={13} />
          </button>
        </div>
      </div>

      {/* Inline Creation Input Prompt */}
      {creatingType && (
        <div className="flex items-center gap-1.5 px-3 py-1 bg-gray-900 border border-teal-500/40 rounded-lg mb-1.5 animate-fadeIn">
          {creatingType === "folder" ? (
            <Folder size={13} className="text-teal-400 shrink-0" />
          ) : (
            <File size={13} className="text-teal-400 shrink-0" />
          )}
          <input
            type="text"
            data-testid="filetree-inline-input"
            value={newEntryName}
            autoFocus
            onChange={(e) => setNewEntryName(e.target.value)}
            placeholder={`Enter ${creatingType} name...`}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateSubmit();
              if (e.key === "Escape") setCreatingType(null);
            }}
            className="w-full px-1.5 py-0.5 text-xs bg-gray-950 border border-gray-700 rounded text-slate-200 font-mono"
          />
          <button
            type="button"
            data-testid="filetree-inline-submit"
            onClick={handleCreateSubmit}
            className="p-0.5 text-gray-400 hover:text-teal-400"
          >
            <Check size={13} />
          </button>
          <button
            type="button"
            data-testid="filetree-inline-cancel"
            onClick={() => setCreatingType(null)}
            className="p-0.5 text-gray-400 hover:text-rose-400"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* Virtualized Mode vs Recursive Tree */}
      {virtualized ? (
        <div
          data-testid="filetree-root"
          role="tree"
          aria-label="File explorer"
          className={["space-y-0.5 font-sans text-xs", className].join(" ")}
        >
          <List
            rowComponent={VirtualRow}
            rowCount={flatItems.length}
            rowHeight={28}
            rowProps={{
              items: flatItems,
              activeNodeId,
              onSelect: handleSelect,
              treeId,
              onToggleFolder: toggleFolder,
            }}
            style={{ height: virtualHeight, width: "100%" }}
          />
        </div>
      ) : (
        <ul
          role="tree"
          aria-label="File explorer"
          className={["space-y-0.5 font-sans text-xs", className].join(" ")}
          data-testid="filetree-root"
        >
          {nodes.map((node) =>
            node.type === "folder" ? (
              <FolderNode
                key={node.id}
                node={node}
                depth={0}
                activeNodeId={activeNodeId}
                onSelect={handleSelect}
                treeId={treeId}
                defaultOpen
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onRename={handleRename}
                onDelete={handleDelete}
                onCreateInFolder={(parentId, type) => {
                  setCreatingParentId(parentId);
                  setCreatingType(type);
                }}
              />
            ) : (
              <FileNode
                key={node.id}
                node={node}
                depth={0}
                isActive={activeNodeId === node.id}
                onSelect={handleSelect}
                treeId={treeId}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onRename={handleRename}
                onDelete={handleDelete}
              />
            )
          )}
        </ul>
      )}
    </div>
  );
};

export default FileTree;
