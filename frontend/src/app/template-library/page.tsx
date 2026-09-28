"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Star, StarOff, FileCode2, Tag, Layers, BookOpen } from "lucide-react";
import FavoritesSearchBar from "@/components/FavoritesSearchBar";
import FavoritesFilter, {
  FavoritesFilterState,
} from "@/components/FavoritesFilter";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { writeJson } from "@/lib/offline/storage";
import { LEGACY_FAVORITES_KEYS } from "@/lib/sync/workspaceStore";

/**
 * Pre-workspace key, still written so older cached chunks and bookmarks do not
 * lose the user's stars. One of {@link LEGACY_FAVORITES_KEYS}; the store folds
 * all of them into the workspace on first read.
 */
const FAVORITES_KEY = LEGACY_FAVORITES_KEYS[0];

export interface Template {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  difficulty: "Beginner" | "Intermediate" | "Advanced";
  code: string;
}

const TEMPLATES: Template[] = [
  {
    id: "hello-world",
    name: "Hello World",
    description: "Minimal Soroban contract that returns a greeting string.",
    category: "Basics",
    tags: ["beginner", "storage"],
    difficulty: "Beginner",
    code: `#![no_std]\nuse soroban_sdk::{contract, contractimpl, Env, Symbol, symbol_short};\n\n#[contract]\npub struct HelloContract;\n\n#[contractimpl]\nimpl HelloContract {\n    pub fn hello(env: Env, to: Symbol) -> Vec<Symbol> {\n        vec![&env, symbol_short!(\"Hello\"), to]\n    }\n}`,
  },
  {
    id: "fungible-token",
    name: "Fungible Token",
    description: "SEP-41 compliant token with mint, transfer, and allowance.",
    category: "Tokens",
    tags: ["token", "defi", "sep41"],
    difficulty: "Intermediate",
    code: `// Fungible Token contract skeleton\n// Implements basic ERC-20-style interface`,
  },
  {
    id: "nft-mint",
    name: "NFT Mint",
    description:
      "Non-fungible token contract with minting and ownership transfer.",
    category: "Tokens",
    tags: ["nft", "token"],
    difficulty: "Intermediate",
    code: `// NFT Mint contract skeleton`,
  },
  {
    id: "multisig",
    name: "Multisig Wallet",
    description: "M-of-N multisig contract for shared treasury control.",
    category: "Security",
    tags: ["multisig", "governance", "wallet"],
    difficulty: "Advanced",
    code: `// Multisig Wallet contract skeleton`,
  },
  {
    id: "vesting",
    name: "Token Vesting",
    description: "Linear vesting schedule with cliff period support.",
    category: "Finance",
    tags: ["vesting", "defi", "token"],
    difficulty: "Intermediate",
    code: `// Vesting contract skeleton`,
  },
  {
    id: "escrow",
    name: "Escrow",
    description: "Two-party escrow with arbiter dispute resolution.",
    category: "Finance",
    tags: ["escrow", "defi"],
    difficulty: "Intermediate",
    code: `// Escrow contract skeleton`,
  },
  {
    id: "storage-counter",
    name: "Storage Counter",
    description: "Simple persistent counter showing ledger storage patterns.",
    category: "Basics",
    tags: ["beginner", "storage"],
    difficulty: "Beginner",
    code: `// Storage counter skeleton`,
  },
  {
    id: "oracle",
    name: "Price Oracle",
    description: "On-chain price feed with admin update and TTL management.",
    category: "DeFi",
    tags: ["oracle", "defi", "price-feed"],
    difficulty: "Advanced",
    code: `// Oracle contract skeleton`,
  },
];

const DIFFICULTY_COLOR: Record<Template["difficulty"], string> = {
  Beginner: "text-green-700 bg-green-50",
  Intermediate: "text-yellow-700 bg-yellow-50",
  Advanced: "text-red-700 bg-red-50",
};

/** #1526 — one-line honest state for the workspace sync. */
const SYNC_BADGE: Record<string, { label: string; className: string }> = {
  idle: { label: "Local only", className: "border-slate-700 text-slate-400" },
  loading: { label: "Syncing…", className: "border-sky-500/40 text-sky-300" },
  synced: { label: "Synced", className: "border-emerald-500/40 text-emerald-300" },
  queued: { label: "Queued for sync", className: "border-amber-500/40 text-amber-300" },
  offline: { label: "Saved offline", className: "border-amber-500/40 text-amber-300" },
  error: { label: "Sync failed", className: "border-red-500/40 text-red-300" },
};

export default function TemplateLibraryPage() {
  // #1526 — favorites now live in the synced workspace snapshot, so they follow
  // the user across devices and are queued when the network is down.
  const {
    snapshot: workspace,
    toggleFavorite,
    status: syncStatus,
    error: syncError,
    conflicts,
  } = useWorkspace();
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState<FavoritesFilterState>({
    categories: [],
    tags: [],
  });
  const [previewId, setPreviewId] = useState<string | null>(null);

  const favorites = useMemo(
    () => new Set(workspace.favorites),
    [workspace.favorites],
  );

  // Keep writing the legacy key so anything still reading it (bookmarks, older
  // cached chunks) does not silently lose the user's stars.
  useEffect(() => {
    writeJson(FAVORITES_KEY, workspace.favorites);
  }, [workspace.favorites]);

  const allCategories = useMemo(
    () => [...new Set(TEMPLATES.map((t) => t.category))].sort(),
    [],
  );

  const allTags = useMemo(
    () => [...new Set(TEMPLATES.flatMap((t) => t.tags))].sort(),
    [],
  );

  const allSuggestions = useMemo(
    () => [...new Set(TEMPLATES.map((t) => t.name))].sort(),
    [],
  );

  const filtered = useMemo(() => {
    let list = showFavoritesOnly
      ? TEMPLATES.filter((t) => favorites.has(t.id))
      : TEMPLATES;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.category.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q)),
      );
    }

    if (filters.categories.length > 0) {
      list = list.filter((t) => filters.categories.includes(t.category));
    }

    if (filters.tags.length > 0) {
      list = list.filter((t) =>
        filters.tags.some((tag) => t.tags.includes(tag)),
      );
    }

    return list;
  }, [showFavoritesOnly, searchQuery, filters, favorites]);

  const previewTemplate = TEMPLATES.find((t) => t.id === previewId);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-5">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-2 mb-1">
            <BookOpen className="w-5 h-5 text-blue-600" />
            <h1 className="text-xl font-bold text-gray-900">
              Template Library
            </h1>
          </div>
          <p className="text-sm text-gray-500">
            Browse, favorite, and load Soroban contract templates into the IDE.
          </p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6 flex flex-col lg:flex-row gap-6">
        {/* Sidebar filters */}
        <aside className="w-full lg:w-56 shrink-0 space-y-4">
          {/* Favorites toggle */}
          <button
            onClick={() => setShowFavoritesOnly((v) => !v)}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
              showFavoritesOnly
                ? "bg-yellow-50 border-yellow-400 text-yellow-800"
                : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"
            }`}
          >
            <span className="flex items-center gap-2">
              <Star className="w-4 h-4" />
              Favorites only
            </span>
            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
              {favorites.size}
            </span>
          </button>

          <FavoritesFilter
            availableCategories={allCategories}
            availableTags={allTags}
            filters={filters}
            onFiltersChange={setFilters}
          />
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0">
          {/* Search bar */}
          <FavoritesSearchBar
            onSearch={setSearchQuery}
            suggestions={allSuggestions}
            className="mb-4"
          />

          {/* Workspace sync state (#1526) — says where the stars actually live. */}
          <div
            data-testid="workspace-sync-badge"
            className="mb-3 flex flex-wrap items-center gap-2"
          >
            <span
              className={[
                "rounded-full border px-2 py-0.5 text-[11px] font-medium",
                SYNC_BADGE[syncStatus]?.className ?? SYNC_BADGE.idle.className,
              ].join(" ")}
            >
              {SYNC_BADGE[syncStatus]?.label ?? SYNC_BADGE.idle.label}
            </span>
            {conflicts.length > 0 ? (
              <span className="text-[11px] text-amber-600">
                {conflicts.length} field
                {conflicts.length === 1 ? "" : "s"} needed a merge decision
              </span>
            ) : null}
            {syncError ? (
              <span className="text-[11px] text-red-500">{syncError}</span>
            ) : null}
          </div>

          {/* Results count */}
          <p className="text-xs text-gray-500 mb-3">
            {filtered.length} template{filtered.length !== 1 ? "s" : ""}
            {showFavoritesOnly ? " in favorites" : ""}
            {searchQuery ? ` for "${searchQuery}"` : ""}
          </p>

          {filtered.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <FileCode2 className="w-10 h-10 mx-auto mb-3 opacity-50" />
              <p className="font-medium">No templates found</p>
              <p className="text-sm mt-1">
                Try a different search or clear filters.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {filtered.map((template) => {
                const isFav = favorites.has(template.id);
                return (
                  <div
                    key={template.id}
                    className="bg-white border border-gray-200 rounded-lg p-4 flex flex-col hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        <FileCode2 className="w-4 h-4 text-blue-500 shrink-0" />
                        <h2 className="font-semibold text-sm text-gray-900 truncate">
                          {template.name}
                        </h2>
                      </div>
                      <button
                        onClick={() => toggleFavorite(template.id)}
                        aria-label={
                          isFav ? "Remove from favorites" : "Add to favorites"
                        }
                        className="ml-2 shrink-0 text-gray-400 hover:text-yellow-500 transition-colors"
                      >
                        {isFav ? (
                          <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />
                        ) : (
                          <StarOff className="w-4 h-4" />
                        )}
                      </button>
                    </div>

                    <p className="text-xs text-gray-600 mb-3 line-clamp-2 flex-1">
                      {template.description}
                    </p>

                    <div className="flex items-center gap-1.5 flex-wrap mb-3">
                      <span className="flex items-center gap-1 text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                        <Layers className="w-3 h-3" />
                        {template.category}
                      </span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded ${DIFFICULTY_COLOR[template.difficulty]}`}
                      >
                        {template.difficulty}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-1 mb-3">
                      {template.tags.map((tag) => (
                        <span
                          key={tag}
                          className="flex items-center gap-0.5 text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded"
                        >
                          <Tag className="w-2.5 h-2.5" />
                          {tag}
                        </span>
                      ))}
                    </div>

                    <div className="flex gap-2 mt-auto">
                      <button
                        onClick={() =>
                          setPreviewId(
                            previewId === template.id ? null : template.id,
                          )
                        }
                        className="flex-1 text-xs px-3 py-1.5 border border-gray-200 text-gray-700 rounded hover:bg-gray-50 transition-colors"
                      >
                        {previewId === template.id ? "Hide" : "Preview"}
                      </button>
                      <a
                        href={`/playground?template=${template.id}`}
                        className="flex-1 text-xs px-3 py-1.5 bg-blue-600 text-white rounded text-center hover:bg-blue-700 transition-colors"
                      >
                        Open in IDE
                      </a>
                    </div>

                    {previewId === template.id && (
                      <pre className="mt-3 text-xs bg-gray-900 text-green-400 rounded p-3 overflow-x-auto max-h-48 overflow-y-auto">
                        {template.code}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
