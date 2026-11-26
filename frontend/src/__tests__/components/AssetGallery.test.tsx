// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Test suite for AssetGallery – Issue #949
 *
 * Covers:
 *  - Renders all asset cards
 *  - Shows symbol, name, balance, issuer, description
 *  - Shows placeholder when imageUrl is absent
 *  - Shows img when imageUrl is provided
 *  - Loading state (skeleton, no list)
 *  - Error state with and without retry
 *  - Empty assets state (default and custom)
 *  - Search / filter: matches symbol, name, issuer; shows no-results state
 *  - Search bar can be hidden with showSearch=false
 *  - Selection: aria-selected, onSelect callback
 *  - Keyboard navigation: Enter & Space on asset cards
 *  - Custom ariaLabel
 */

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import AssetGallery, { AssetItem } from "../../components/AssetGallery";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const assets: AssetItem[] = [
  {
    id: "XLM:native",
    symbol: "XLM",
    name: "Stellar Lumens",
    balance: 1000,
    description: "Native Stellar asset",
  },
  {
    id: "USDC:GA5Z",
    symbol: "USDC",
    name: "USD Coin",
    issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    imageUrl: "https://example.com/usdc.png",
    balance: 250,
  },
  {
    id: "yXLM:GBUY",
    symbol: "yXLM",
    name: "Yield XLM",
    issuer: "GBUYUAI75XXWDZEKLY66CFYKQPET5JR4EAIGKFD3IA2LJVZSXKM26QY",
    balance: 0,
  },
];

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("AssetGallery – rendering", () => {
  it("renders a card for each asset", () => {
    render(<AssetGallery assets={assets} />);
    expect(screen.getByTestId("asset-card-XLM:native")).toBeInTheDocument();
    expect(screen.getByTestId("asset-card-USDC:GA5Z")).toBeInTheDocument();
    expect(screen.getByTestId("asset-card-yXLM:GBUY")).toBeInTheDocument();
  });

  it("displays symbol and name for each asset", () => {
    render(<AssetGallery assets={assets} />);
    expect(screen.getByTestId("asset-symbol-XLM:native")).toHaveTextContent(
      "XLM",
    );
    expect(screen.getByTestId("asset-name-XLM:native")).toHaveTextContent(
      "Stellar Lumens",
    );
  });

  it("displays balance when provided", () => {
    render(<AssetGallery assets={assets} />);
    expect(screen.getByTestId("asset-balance-XLM:native")).toHaveTextContent(
      "1,000",
    );
  });

  it("displays issuer when provided", () => {
    render(<AssetGallery assets={assets} />);
    expect(screen.getByTestId("asset-issuer-USDC:GA5Z")).toHaveTextContent(
      "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    );
  });

  it("displays description when provided", () => {
    render(<AssetGallery assets={assets} />);
    expect(
      screen.getByTestId("asset-description-XLM:native"),
    ).toHaveTextContent("Native Stellar asset");
  });

  it("shows logo image when imageUrl is provided", () => {
    render(<AssetGallery assets={assets} />);
    const img = screen.getByTestId("asset-image-USDC:GA5Z");
    expect(img).toHaveAttribute("src", "https://example.com/usdc.png");
    expect(img).toHaveAttribute("alt", "USDC logo");
  });

  it("shows placeholder initials when imageUrl is absent", () => {
    render(<AssetGallery assets={assets} />);
    expect(
      screen.getByTestId("asset-placeholder-XLM:native"),
    ).toHaveTextContent("XL");
  });

  it("renders the listbox with the correct aria-label", () => {
    render(<AssetGallery assets={assets} ariaLabel="My assets" />);
    const lists = screen.getAllByRole("listbox");
    expect(lists[0]).toHaveAttribute("aria-label", "My assets");
  });

  it("attaches className to the root section", () => {
    render(<AssetGallery assets={assets} className="gallery-class" />);
    expect(screen.getByTestId("asset-gallery-root")).toHaveClass(
      "gallery-class",
    );
  });
});

// ---------------------------------------------------------------------------
// Loading state
// ---------------------------------------------------------------------------

describe("AssetGallery – loading state", () => {
  it("renders the skeleton and hides the list when isLoading=true", () => {
    render(<AssetGallery assets={[]} isLoading={true} />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByTestId("asset-gallery-list")).not.toBeInTheDocument();
  });

  it("renders the list after loading finishes", () => {
    const { rerender } = render(<AssetGallery assets={[]} isLoading={true} />);
    rerender(<AssetGallery assets={assets} isLoading={false} />);
    expect(screen.getByTestId("asset-gallery-list")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

describe("AssetGallery – error state", () => {
  it("renders an alert when error is an Error object", () => {
    render(<AssetGallery assets={[]} error={new Error("RPC error")} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/rpc error/i)).toBeInTheDocument();
  });

  it("renders an alert when error is a string", () => {
    render(<AssetGallery assets={[]} error="Network timeout" />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/network timeout/i)).toBeInTheDocument();
  });

  it("shows Retry button when onRetry is provided", () => {
    render(
      <AssetGallery assets={[]} error="Network timeout" onRetry={jest.fn()} />,
    );
    expect(screen.getByTestId("skeleton-retry-button")).toBeInTheDocument();
  });

  it("calls onRetry when Retry is clicked", () => {
    const onRetry = jest.fn();
    render(
      <AssetGallery assets={[]} error="Network timeout" onRetry={onRetry} />,
    );
    fireEvent.click(screen.getByTestId("skeleton-retry-button"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("does not render the gallery list when error is set", () => {
    render(<AssetGallery assets={assets} error="Error!" />);
    expect(screen.queryByTestId("asset-gallery-list")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe("AssetGallery – empty state", () => {
  it("shows the default empty message when assets is empty", () => {
    render(<AssetGallery assets={[]} />);
    expect(screen.getByTestId("asset-gallery-empty")).toBeInTheDocument();
    expect(screen.getByText(/no assets found/i)).toBeInTheDocument();
  });

  it("shows custom emptyState when assets is empty", () => {
    render(
      <AssetGallery
        assets={[]}
        emptyState={<span>Your wallet is empty</span>}
      />,
    );
    expect(screen.getByText("Your wallet is empty")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Search / filter
// ---------------------------------------------------------------------------

describe("AssetGallery – search", () => {
  it("renders the search bar by default", () => {
    render(<AssetGallery assets={assets} />);
    expect(screen.getByTestId("asset-gallery-search")).toBeInTheDocument();
  });

  it("hides the search bar when showSearch=false", () => {
    render(<AssetGallery assets={assets} showSearch={false} />);
    expect(
      screen.queryByTestId("asset-gallery-search"),
    ).not.toBeInTheDocument();
  });

  it("filters assets by symbol", () => {
    render(<AssetGallery assets={assets} />);
    fireEvent.change(screen.getByTestId("asset-gallery-search"), {
      target: { value: "USDC" },
    });
    expect(screen.getByTestId("asset-card-USDC:GA5Z")).toBeInTheDocument();
    expect(
      screen.queryByTestId("asset-card-XLM:native"),
    ).not.toBeInTheDocument();
  });

  it("filters assets by name (case-insensitive)", () => {
    render(<AssetGallery assets={assets} />);
    fireEvent.change(screen.getByTestId("asset-gallery-search"), {
      target: { value: "yield" },
    });
    expect(screen.getByTestId("asset-card-yXLM:GBUY")).toBeInTheDocument();
    expect(
      screen.queryByTestId("asset-card-XLM:native"),
    ).not.toBeInTheDocument();
  });

  it("filters assets by issuer", () => {
    render(<AssetGallery assets={assets} />);
    fireEvent.change(screen.getByTestId("asset-gallery-search"), {
      target: { value: "GBUY" },
    });
    expect(screen.getByTestId("asset-card-yXLM:GBUY")).toBeInTheDocument();
    expect(
      screen.queryByTestId("asset-card-XLM:native"),
    ).not.toBeInTheDocument();
  });

  it("shows default no-results state when filter matches nothing", () => {
    render(<AssetGallery assets={assets} />);
    fireEvent.change(screen.getByTestId("asset-gallery-search"), {
      target: { value: "NONEXISTENT" },
    });
    expect(screen.getByTestId("asset-gallery-no-results")).toBeInTheDocument();
    expect(
      screen.getByText(/no assets match your search/i),
    ).toBeInTheDocument();
  });

  it("shows custom noResultsState when filter matches nothing", () => {
    render(
      <AssetGallery
        assets={assets}
        noResultsState={<span>Try a different search</span>}
      />,
    );
    fireEvent.change(screen.getByTestId("asset-gallery-search"), {
      target: { value: "XXXXXX" },
    });
    expect(screen.getByText("Try a different search")).toBeInTheDocument();
  });

  it("shows all assets when search is cleared", () => {
    render(<AssetGallery assets={assets} />);
    const searchInput = screen.getByTestId("asset-gallery-search");
    fireEvent.change(searchInput, { target: { value: "XLM" } });
    fireEvent.change(searchInput, { target: { value: "" } });
    // All 3 cards visible again
    expect(screen.getByTestId("asset-card-XLM:native")).toBeInTheDocument();
    expect(screen.getByTestId("asset-card-USDC:GA5Z")).toBeInTheDocument();
    expect(screen.getByTestId("asset-card-yXLM:GBUY")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

describe("AssetGallery – selection", () => {
  it("marks the selected card with aria-selected=true", () => {
    render(<AssetGallery assets={assets} selectedId="XLM:native" />);
    expect(screen.getByTestId("asset-card-XLM:native")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("asset-card-USDC:GA5Z")).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("calls onSelect with the asset when a card is clicked", () => {
    const onSelect = jest.fn();
    render(<AssetGallery assets={assets} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId("asset-card-XLM:native"));
    expect(onSelect).toHaveBeenCalledWith(assets[0]);
  });

  it("calls onSelect via Enter key on asset card", () => {
    const onSelect = jest.fn();
    render(<AssetGallery assets={assets} onSelect={onSelect} />);
    fireEvent.keyDown(screen.getByTestId("asset-card-USDC:GA5Z"), {
      key: "Enter",
    });
    expect(onSelect).toHaveBeenCalledWith(assets[1]);
  });

  it("calls onSelect via Space key on asset card", () => {
    const onSelect = jest.fn();
    render(<AssetGallery assets={assets} onSelect={onSelect} />);
    fireEvent.keyDown(screen.getByTestId("asset-card-USDC:GA5Z"), { key: " " });
    expect(onSelect).toHaveBeenCalledWith(assets[1]);
  });

  it("does not throw when clicking a card with no onSelect handler", () => {
    render(<AssetGallery assets={assets} />);
    // Should not throw
    fireEvent.click(screen.getByTestId("asset-card-XLM:native"));
  });
});

// ---------------------------------------------------------------------------
// [FRONTEND-290] Lazy Loading, WebP & Virtualization Tests
// ---------------------------------------------------------------------------

describe("AssetGallery – [FRONTEND-290] Performance & Virtualization", () => {
  it("enforces loading='lazy' and decoding='async' on asset images", () => {
    render(<AssetGallery assets={assets} />);
    const img = screen.getByTestId("asset-image-USDC:GA5Z");
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("decoding", "async");
    expect(img).toHaveAttribute("data-loading", "lazy");
  });

  it("renders responsive <picture> with image/webp source for WebP browser support", () => {
    render(<AssetGallery assets={assets} />);
    const picture = screen.getByTestId("asset-picture-USDC:GA5Z");
    expect(picture).toBeInTheDocument();

    const source = picture.querySelector("source");
    expect(source).not.toBeNull();
    expect(source).toHaveAttribute("type", "image/webp");
    expect(source?.getAttribute("srcset")).toMatch(/\.webp/);
  });

  it("renders lightweight SVG shimmer while image is loading, then hides it on load", () => {
    render(<AssetGallery assets={assets} />);
    const shimmer = screen.getByTestId("asset-shimmer-USDC:GA5Z");
    expect(shimmer).toBeInTheDocument();

    const img = screen.getByTestId("asset-image-USDC:GA5Z");
    // Trigger successful image load
    fireEvent.load(img);

    // After load, shimmer is removed and image opacity is 1
    expect(screen.queryByTestId("asset-shimmer-USDC:GA5Z")).not.toBeInTheDocument();
    expect(img).toHaveStyle("opacity: 1");
  });

  it("falls back gracefully to initials placeholder when image fails to load", () => {
    render(<AssetGallery assets={assets} />);
    const img = screen.getByTestId("asset-image-USDC:GA5Z");

    // Trigger image loading failure
    fireEvent.error(img);

    // Image container is replaced with placeholder initials
    expect(screen.queryByTestId("asset-image-USDC:GA5Z")).not.toBeInTheDocument();
    expect(screen.getByTestId("asset-placeholder-USDC:GA5Z")).toBeInTheDocument();
    expect(screen.getByTestId("asset-placeholder-USDC:GA5Z")).toHaveTextContent("US");
  });

  it("renders virtualized container when virtualized=true with a large collection", () => {
    const largeAssets: AssetItem[] = Array.from({ length: 40 }, (_, i) => ({
      id: `NFT-${i}`,
      symbol: `NFT${i}`,
      name: `Soroban Collectible #${i}`,
      imageUrl: `https://example.com/nft-${i}.png`,
    }));

    render(
      <AssetGallery
        assets={largeAssets}
        virtualized={true}
        viewportHeight={500}
        estimatedCardHeight={150}
      />,
    );

    const virtualContainer = screen.getByTestId("asset-gallery-virtualized-container");
    expect(virtualContainer).toBeInTheDocument();
    expect(virtualContainer).toHaveStyle("overflow-y: auto");

    // Check that items are windowed and rendered
    expect(screen.getByTestId("asset-card-NFT-0")).toBeInTheDocument();
  });

  it("updates virtual window on scroll event without crash", () => {
    const largeAssets: AssetItem[] = Array.from({ length: 40 }, (_, i) => ({
      id: `NFT-${i}`,
      symbol: `NFT${i}`,
      name: `Soroban Collectible #${i}`,
      imageUrl: `https://example.com/nft-${i}.png`,
    }));

    render(
      <AssetGallery
        assets={largeAssets}
        virtualized={true}
        viewportHeight={500}
        estimatedCardHeight={150}
      />,
    );

    const virtualContainer = screen.getByTestId("asset-gallery-virtualized-container");
    fireEvent.scroll(virtualContainer, { target: { scrollTop: 450 } });

    expect(virtualContainer).toBeInTheDocument();
  });
});
