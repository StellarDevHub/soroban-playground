// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * AssetGallery – Issue #949 & [FRONTEND-290] #2060
 *
 * A high-performance, virtualized responsive gallery component for displaying Soroban/Stellar asset cards.
 * Features:
 *  - Virtualized grid layout with configurable item sizing and scroll windowing
 *  - Progressive image loading with lightweight animated SVG shimmer placeholder
 *  - Responsive WebP format preference via HTML5 <picture> and srcset
 *  - Native lazy image decoding (loading="lazy", decoding="async")
 *  - Graceful image error fallback to token symbol initials
 *  - Filter assets by search term (name / symbol / issuer)
 *  - Loading state via LoadingSkeleton
 *  - Error state with optional retry
 *  - Empty / no-results states
 *  - Item selection callback
 *  - Accessible markup (listbox / option roles, aria-selected)
 */

import React, { useMemo, useState, useRef, useCallback } from "react";
import LoadingSkeleton from "./LoadingSkeleton";

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
  /** Enable virtual windowing for large asset collections. */
  virtualized?: boolean;
  /** Virtualized scroll viewport height in pixels (defaults to 600). */
  viewportHeight?: number;
  /** Estimated card height in pixels for virtualization (defaults to 180). */
  estimatedCardHeight?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function toWebPUrl(url: string): string {
  if (!url) return "";
  if (url.endsWith(".webp")) return url;
  if (/\.(png|jpg|jpeg)(\?.*)?$/i.test(url)) {
    return url.replace(/\.(png|jpg|jpeg)(\?.*)?$/i, ".webp$2");
  }
  return `${url}${url.includes("?") ? "&" : "?"}format=webp`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

export function AssetCard({
  asset,
  isSelected,
  onSelect,
}: {
  asset: AssetItem;
  isSelected: boolean;
  onSelect?: (asset: AssetItem) => void;
}): React.ReactElement {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);

  const handleClick = (): void => onSelect?.(asset);
  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect?.(asset);
    }
  };

  const webpUrl = asset.imageUrl ? toWebPUrl(asset.imageUrl) : undefined;

  return (
    <li
      role="option"
      aria-selected={isSelected}
      data-testid={`asset-card-${asset.id}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      style={{
        padding: "16px",
        borderRadius: "8px",
        border: isSelected ? "2px solid #6366f1" : "1px solid #e5e7eb",
        background: isSelected ? "#eef2ff" : "#fff",
        cursor: onSelect ? "pointer" : "default",
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        outline: "none",
        boxSizing: "border-box",
      }}
    >
      {/* Logo with progressive SVG shimmer & WebP */}
      {asset.imageUrl && !hasError ? (
        <div
          data-testid={`asset-image-container-${asset.id}`}
          style={{ position: "relative", width: "40px", height: "40px", minWidth: "40px" }}
        >
          {!isLoaded && (
            <svg
              data-testid={`asset-shimmer-${asset.id}`}
              width="40"
              height="40"
              viewBox="0 0 40 40"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                borderRadius: "50%",
                background: "#e2e8f0",
              }}
              aria-hidden="true"
            >
              <rect width="40" height="40" rx="20" fill="#e2e8f0" />
              <rect width="20" height="40" rx="10" fill="#cbd5e1" opacity="0.6">
                <animate attributeName="x" from="-20" to="40" dur="1.2s" repeatCount="indefinite" />
              </rect>
            </svg>
          )}
          <picture data-testid={`asset-picture-${asset.id}`}>
            {webpUrl && <source srcSet={webpUrl} type="image/webp" />}
            <img
              src={asset.imageUrl}
              alt={`${asset.symbol} logo`}
              data-testid={`asset-image-${asset.id}`}
              loading="lazy"
              decoding="async"
              data-loading="lazy"
              onLoad={() => setIsLoaded(true)}
              onError={() => setHasError(true)}
              style={{
                width: "40px",
                height: "40px",
                borderRadius: "50%",
                objectFit: "cover",
                opacity: isLoaded ? 1 : 0.001,
                transition: "opacity 0.2s ease-in-out",
                display: "block",
              }}
            />
          </picture>
        </div>
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
          }}
        >
          {asset.symbol.slice(0, 2).toUpperCase()}
        </span>
      )}

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
          style={{ fontSize: "11px", color: "#9ca3af", wordBreak: "break-all" }}
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
    </li>
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
  ariaLabel = "Assets gallery",
  className,
  skeletonCount = 6,
  virtualized = false,
  viewportHeight = 600,
  estimatedCardHeight = 180,
}: AssetGalleryProps): React.ReactElement {
  const [searchTerm, setSearchTerm] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Filter assets
  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return assets;
    return assets.filter(
      (a) =>
        a.symbol.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        (a.issuer && a.issuer.toLowerCase().includes(q)),
    );
  }, [assets, searchTerm]);

  // Virtual windowing calculations
  const isVirtualizedActive = virtualized && filtered.length > 12;
  const columnsCount = 3; // Standard grid columns
  const rowCount = Math.ceil(filtered.length / columnsCount);
  const totalHeight = rowCount * estimatedCardHeight;

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const visibleIndices = useMemo(() => {
    if (!isVirtualizedActive) {
      return { startRow: 0, endRow: rowCount };
    }
    const overscan = 2;
    const startRow = Math.max(0, Math.floor(scrollTop / estimatedCardHeight) - overscan);
    const visibleRowCount = Math.ceil(viewportHeight / estimatedCardHeight);
    const endRow = Math.min(rowCount, startRow + visibleRowCount + overscan * 2);
    return { startRow, endRow };
  }, [isVirtualizedActive, rowCount, scrollTop, estimatedCardHeight, viewportHeight]);

  const visibleAssets = useMemo(() => {
    if (!isVirtualizedActive) return filtered;
    const startIdx = visibleIndices.startRow * columnsCount;
    const endIdx = Math.min(filtered.length, visibleIndices.endRow * columnsCount);
    return filtered.slice(startIdx, endIdx);
  }, [isVirtualizedActive, filtered, visibleIndices, columnsCount]);

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
      ) : isVirtualizedActive ? (
        <div
          ref={scrollContainerRef}
          data-testid="asset-gallery-virtualized-container"
          onScroll={onScroll}
          style={{
            height: `${viewportHeight}px`,
            overflowY: "auto",
            position: "relative",
          }}
        >
          <div
            style={{
              height: `${totalHeight}px`,
              width: "100%",
              position: "relative",
            }}
          >
            <ul
              role="listbox"
              aria-label={ariaLabel}
              data-testid="asset-gallery-list"
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                gap: "16px",
                transform: `translateY(${visibleIndices.startRow * estimatedCardHeight}px)`,
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
              }}
            >
              {visibleAssets.map((asset) => (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  isSelected={selectedId === asset.id}
                  onSelect={onSelect}
                />
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <ul
          role="listbox"
          aria-label={ariaLabel}
          data-testid="asset-gallery-list"
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            gap: "16px",
          }}
        >
          {filtered.map((asset) => (
            <AssetCard
              key={asset.id}
              asset={asset}
              isSelected={selectedId === asset.id}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export default AssetGallery;
