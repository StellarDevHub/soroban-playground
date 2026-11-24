// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

"use client";

/**
 * AssetGallery – Issue #949
 *
 * A responsive gallery component for displaying Soroban/Stellar asset cards.
 * Features:
 *  - Display a list of asset items in a grid layout
 *  - Filter assets by search term (name / symbol / issuer)
 *  - Loading state via LoadingSkeleton
 *  - Error state with optional retry
 *  - Empty / no-results states
 *  - Item selection callback
 *  - Accessible markup (listbox / option roles)
 */

import Image from "next/image";
import React, { useMemo, useState } from "react";
import { Grid, type CellComponentProps } from "react-window";
import LoadingSkeleton from "./LoadingSkeleton";

const MIN_COLUMN_WIDTH = 240;
const GRID_ROW_HEIGHT = 320;
const GRID_HEIGHT = 600;
const IMAGE_SHIMMER = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><defs><linearGradient id="g" x1="-1" x2="0"><stop offset="0" stop-color="#e5e7eb"/><stop offset=".5" stop-color="#f9fafb"/><stop offset="1" stop-color="#e5e7eb"/><animate attributeName="x1" values="-1;1" dur="1.4s" repeatCount="indefinite"/><animate attributeName="x2" values="0;2" dur="1.4s" repeatCount="indefinite"/></linearGradient></defs><rect width="400" height="400" fill="url(#g)"/></svg>',
)}`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AssetItem {
  /** Unique identifier (e.g. "XLM:native" or "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"). */
  id: string;
  /** Short ticker symbol (e.g. "XLM", "USDC"). */
  symbol: string;
  /** Human-readable name. */
  name: string;
  /** Issuer address (empty string for native). */
  issuer?: string;
  /** Optional image/logo URL. */
  imageUrl?: string;
  /** Optional description. */
  description?: string;
  /** Optional numeric balance / amount. */
  balance?: number;
  /** Optional arbitrary metadata. */
  meta?: Record<string, unknown>;
}

export interface AssetGalleryProps {
  /** Asset items to display. */
  assets: AssetItem[];
  /** Whether data is being fetched. */
  isLoading?: boolean;
  /** Error from the data layer. */
  error?: Error | string | null;
  /** Called when user clicks Retry in the error state. */
  onRetry?: () => void;
  /** Called when user selects (clicks) an asset card. */
  onSelect?: (asset: AssetItem) => void;
  /** Currently selected asset id. */
  selectedId?: string | null;
  /** Content rendered when there are no assets at all. */
  emptyState?: React.ReactNode;
  /** Content rendered when the search has no results. */
  noResultsState?: React.ReactNode;
  /** Whether to show the search/filter bar. Defaults to true. */
  showSearch?: boolean;
  /** Accessible label for the gallery region. */
  ariaLabel?: string;
  /** Optional CSS class on the root element. */
  className?: string;
  /** Number of skeleton cards to show while loading. Defaults to 6. */
  skeletonCount?: number;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function AssetCard({
  asset,
  isSelected,
  onSelect,
  style,
}: {
  asset: AssetItem;
  isSelected: boolean;
  onSelect?: (asset: AssetItem) => void;
  style: React.CSSProperties;
}): React.ReactElement {
  const handleClick = (): void => onSelect?.(asset);
  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect?.(asset);
    }
  };

  return (
    <li
      style={{
        ...style,
        boxSizing: "border-box",
        listStyle: "none",
        padding: "8px",
      }}
    >
      <div
        role="option"
        aria-selected={isSelected}
        data-testid={`asset-card-${asset.id}`}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        style={{
          width: "100%",
          height: "100%",
          boxSizing: "border-box",
          padding: "16px",
          borderRadius: "8px",
          border: isSelected ? "2px solid #6366f1" : "1px solid #e5e7eb",
          background: isSelected ? "#eef2ff" : "#fff",
          cursor: onSelect ? "pointer" : "default",
          display: "flex",
          flexDirection: "column",
          gap: "6px",
          outline: "none",
        }}
      >
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "160px",
            overflow: "hidden",
            borderRadius: "6px",
            background: "#e0e7ff",
          }}
        >
          {asset.imageUrl ? (
            <Image
              src={asset.imageUrl}
              alt={`${asset.symbol} logo`}
              fill
              loading="lazy"
              sizes="(max-width: 640px) 90vw, (max-width: 1024px) 45vw, 25vw"
              placeholder="blur"
              blurDataURL={IMAGE_SHIMMER}
              decoding="async"
              data-testid={`asset-image-${asset.id}`}
              style={{ objectFit: "cover" }}
            />
          ) : (
            <span
              aria-hidden="true"
              data-testid={`asset-placeholder-${asset.id}`}
              style={{
                display: "inline-flex",
                width: "40px",
                height: "40px",
                borderRadius: "50%",
                background: "#e0e7ff",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 700,
                color: "#6366f1",
                fontSize: "14px",
                position: "absolute",
                inset: 0,
                margin: "auto",
              }}
            >
              {asset.symbol.slice(0, 2).toUpperCase()}
            </span>
          )}
        </div>

        {/* Symbol + name */}
        <div>
          <span
            data-testid={`asset-symbol-${asset.id}`}
            style={{ fontWeight: 700, fontSize: "15px" }}
          >
            {asset.symbol}
          </span>{" "}
          <span
            data-testid={`asset-name-${asset.id}`}
            style={{ color: "#6b7280", fontSize: "13px" }}
          >
            {asset.name}
          </span>
        </div>

        {/* Balance */}
        {asset.balance !== undefined && (
          <span
            data-testid={`asset-balance-${asset.id}`}
            style={{ fontSize: "13px", color: "#374151" }}
          >
            Balance: <strong>{asset.balance.toLocaleString()}</strong>
          </span>
        )}

        {/* Issuer (truncated) */}
        {asset.issuer && (
          <span
            data-testid={`asset-issuer-${asset.id}`}
            style={{
              fontSize: "11px",
              color: "#9ca3af",
              wordBreak: "break-all",
            }}
          >
            {asset.issuer}
          </span>
        )}

        {/* Description */}
        {asset.description && (
          <p
            data-testid={`asset-description-${asset.id}`}
            style={{ margin: 0, fontSize: "12px", color: "#6b7280" }}
          >
            {asset.description}
          </p>
        )}
      </div>
    </li>
  );
}

interface AssetGridCellProps {
  assets: AssetItem[];
  columnCount: number;
  selectedId: string | null;
  onSelect?: (asset: AssetItem) => void;
}

function AssetGridCell({
  columnIndex,
  rowIndex,
  style,
  assets,
  columnCount,
  selectedId,
  onSelect,
}: CellComponentProps<AssetGridCellProps>): React.ReactElement | null {
  const asset = assets[rowIndex * columnCount + columnIndex];
  if (!asset) return null;

  return (
    <AssetCard
      asset={asset}
      isSelected={selectedId === asset.id}
      onSelect={onSelect}
      style={{ ...style, padding: "8px" }}
    />
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AssetGallery({
  assets,
  isLoading = false,
  error = null,
  onRetry,
  onSelect,
  selectedId = null,
  emptyState,
  noResultsState,
  showSearch = true,
  ariaLabel = "Asset gallery",
  className = "",
  skeletonCount = 6,
}: AssetGalleryProps): React.ReactElement {
  const [searchTerm, setSearchTerm] = useState("");
  const [gridWidth, setGridWidth] = useState(960);

  // --- Filter ---
  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return assets;
    return assets.filter(
      (a) =>
        a.symbol.toLowerCase().includes(term) ||
        a.name.toLowerCase().includes(term) ||
        (a.issuer ?? "").toLowerCase().includes(term),
    );
  }, [assets, searchTerm]);

  // --- Error state ---
  if (error) {
    return (
      <LoadingSkeleton
        error={error}
        onRetry={onRetry}
        isLoading={false}
        className={className}
      />
    );
  }

  // --- Loading state ---
  if (isLoading) {
    return (
      <LoadingSkeleton
        isLoading={true}
        rows={skeletonCount}
        variant="card"
        ariaLabel="Loading assets"
        className={className}
      />
    );
  }

  // --- Empty data set ---
  if (assets.length === 0) {
    return (
      <div
        role="status"
        aria-label="No assets"
        data-testid="asset-gallery-empty"
        className={className}
      >
        {emptyState ?? (
          <p
            style={{ textAlign: "center", color: "#6b7280", padding: "32px 0" }}
          >
            No assets found.
          </p>
        )}
      </div>
    );
  }

  return (
    <section
      role="region"
      aria-label={ariaLabel}
      data-testid="asset-gallery-root"
      className={className}
    >
      {/* Search bar */}
      {showSearch && (
        <div style={{ marginBottom: "16px" }}>
          <label
            htmlFor="asset-gallery-search"
            style={{
              display: "block",
              marginBottom: "4px",
              fontSize: "13px",
              fontWeight: 600,
            }}
          >
            Search assets
          </label>
          <input
            id="asset-gallery-search"
            type="search"
            role="searchbox"
            placeholder="Symbol, name or issuer…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            data-testid="asset-gallery-search"
            aria-label="Search assets"
            style={{
              width: "100%",
              padding: "8px 12px",
              borderRadius: "6px",
              border: "1px solid #d1d5db",
              fontSize: "14px",
              boxSizing: "border-box",
            }}
          />
        </div>
      )}

      {/* No-results state */}
      {filtered.length === 0 ? (
        <div
          role="status"
          aria-label="No results"
          data-testid="asset-gallery-no-results"
        >
          {noResultsState ?? (
            <p
              style={{
                textAlign: "center",
                color: "#6b7280",
                padding: "24px 0",
              }}
            >
              No assets match your search.
            </p>
          )}
        </div>
      ) : (
        <Grid
          cellComponent={AssetGridCell}
          cellProps={{
            assets: filtered,
            columnCount: Math.max(
              1,
              Math.floor(gridWidth / MIN_COLUMN_WIDTH),
            ),
            selectedId,
            onSelect,
          }}
          columnCount={Math.max(1, Math.floor(gridWidth / MIN_COLUMN_WIDTH))}
          columnWidth={
            gridWidth / Math.max(1, Math.floor(gridWidth / MIN_COLUMN_WIDTH))
          }
          defaultHeight={GRID_HEIGHT}
          defaultWidth={gridWidth}
          onResize={({ width }) => {
            if (width > 0) setGridWidth(width);
          }}
          overscanCount={0}
          rowCount={Math.ceil(
            filtered.length /
              Math.max(1, Math.floor(gridWidth / MIN_COLUMN_WIDTH)),
          )}
          rowHeight={GRID_ROW_HEIGHT}
          role="listbox"
          aria-label={ariaLabel}
          data-testid="asset-gallery-list"
          tagName="ul"
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            width: "100%",
            height: GRID_HEIGHT,
          }}
        />
      )}
    </section>
  );
}

export default AssetGallery;
