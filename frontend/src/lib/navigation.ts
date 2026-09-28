// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Canonical application route index.
 *
 * This is the single source of truth for "where can the user go". It is
 * consumed by:
 *
 *  - `components/Sidebar.tsx` — the collapsible navigation drawer
 *  - `lib/commandRegistry.ts` — the Cmd+K palette index (issue #1527)
 *
 * Keeping one list means a new route is searchable the moment it is added to
 * the sidebar, instead of drifting across two hand-maintained arrays.
 *
 * The model is intentionally free of React and of icon components: `icon` is a
 * stable string key that the Sidebar resolves through its lucide-react map.
 * That keeps this module importable from server components, tests and the
 * service worker.
 */

export type NavigationIconKey =
  | "code"
  | "zap"
  | "layout-grid"
  | "book"
  | "shield"
  | "database"
  | "search"
  | "send"
  | "file-code"
  | "sliders"
  | "coins"
  | "boxes"
  | "waves"
  | "trending-up"
  | "activity"
  | "users"
  | "fingerprint"
  | "wallet"
  | "alert-triangle"
  | "building"
  | "file-text"
  | "music"
  | "globe"
  | "trophy"
  | "target"
  | "orbit"
  | "compass"
  | "gauge"
  | "flask"
  | "landmark"
  | "key"
  | "cloud-off";

export interface NavigationItem {
  /** Display name, also the primary palette match target. */
  name: string;
  /** Absolute app route. */
  href: string;
  /** lucide-react icon key resolved by the Sidebar. */
  icon: NavigationIconKey;
  /** One-line explanation shown in the palette and as `title` in the drawer. */
  description: string;
  /**
   * Extra search terms that never appear in `name` — abbreviations, synonyms
   * and Soroban domain vocabulary. The palette matches these as one extra
   * weighted field so `"rpc"` finds the price aggregator.
   */
  keywords: string[];
  /** Optional badge text rendered in the drawer. */
  badge?: string;
  /**
   * Hide from the sidebar while staying searchable in the palette. Used for
   * sub-pages that are reachable only by drilling down.
   */
  hiddenInSidebar?: boolean;
}

export interface NavigationGroup {
  groupName: string;
  items: NavigationItem[];
}

export const NAVIGATION: NavigationGroup[] = [
  {
    groupName: "Core IDE & Ops",
    items: [
      {
        name: "IDE Playground",
        href: "/playground",
        icon: "code",
        description: "Monaco editor, compile, deploy and invoke in one desk.",
        keywords: ["editor", "monaco", "ide", "contract", "rust"],
      },
      {
        name: "Compile Dashboard",
        href: "/compile-dashboard",
        icon: "zap",
        description: "Compile queue, timings and failure diagnostics.",
        keywords: ["build", "cargo", "wasm", "queue", "diagnostics"],
      },
      {
        name: "Template Library",
        href: "/template-library",
        icon: "layout-grid",
        description: "Curated Soroban contract templates and presets.",
        keywords: ["starter", "scaffold", "examples", "boilerplate"],
      },
      {
        name: "Docs & Reference",
        href: "/docs",
        icon: "book",
        description: "Guides, SDK reference and network walkthroughs.",
        keywords: ["documentation", "help", "guide", "manual", "sdk"],
      },
      {
        name: "Audit Explorer",
        href: "/audit",
        icon: "shield",
        description: "Inspect events, state diffs and ledger history.",
        keywords: ["security", "events", "trace", "ledger", "forensics"],
      },
      {
        name: "Storage Browser",
        href: "/storage-browser",
        icon: "database",
        description: "Walk contract storage entries and snapshots.",
        keywords: ["state", "ledger", "entries", "key value"],
      },
      {
        name: "Search Utility",
        href: "/search",
        icon: "search",
        description: "Cross-project search with facets and autocomplete.",
        keywords: ["find", "query", "facets", "fuzzy"],
      },
      {
        name: "Ledger Migration",
        href: "/migration",
        icon: "send",
        description: "Plan and submit a state migration transaction.",
        keywords: ["upgrade", "migrate", "state", "tx"],
      },
      {
        name: "XDR Inspector",
        href: "/xdr-decoder",
        icon: "file-code",
        description: "Decode and encode Stellar XDR payloads.",
        keywords: ["xdr", "base64", "encode", "decode", "wire"],
      },
      {
        name: "WASM Inspector",
        href: "/wasm-inspector",
        icon: "file-code",
        description: "Disassemble contract WASM and inspect memory.",
        keywords: ["wasm", "disassemble", "memory", "binary", "blob"],
      },
      {
        name: "Rate Limits",
        href: "/rate-limits",
        icon: "sliders",
        description: "Per-endpoint quota, tier and cooldown telemetry.",
        keywords: ["quota", "throttle", "limits", "usage"],
      },
      {
        name: "Admin Console",
        href: "/admin",
        icon: "gauge",
        description: "Operational controls, flags and health telemetry.",
        keywords: ["ops", "admin", "control", "flags", "telemetry"],
        hiddenInSidebar: true,
      },
      {
        name: "Wallet Management",
        href: "/wallet-management",
        icon: "key",
        description: "Connect, switch and authorise Stellar accounts.",
        keywords: ["freighter", "albedo", "connect", "account", "auth"],
        hiddenInSidebar: true,
      },
    ],
  },
  {
    groupName: "DeFi Suite",
    items: [
      {
        name: "Synthetic Assets",
        href: "/",
        icon: "coins",
        description: "Synthetic asset minting, collateral and backing.",
        keywords: ["synthetic", "mint", "collateral", "home", "overview"],
      },
      {
        name: "Limit Order Book",
        href: "/orderbook",
        icon: "boxes",
        description: "Place and match limit orders on-chain.",
        keywords: ["dex", "trades", "order", "liquidity"],
      },
      {
        name: "Stablecoin Peg",
        href: "/stablecoin",
        icon: "waves",
        description: "Track peg stability, rebase history and reserves.",
        keywords: ["peg", "rebase", "usdc", "depeg", "price"],
      },
      {
        name: "Yield Optimizer",
        href: "/yield-optimizer",
        icon: "trending-up",
        description: "Compare strategies and backtest allocations.",
        keywords: ["apy", "backtest", "strategy", "farming", "returns"],
      },
      {
        name: "NFT AMM Pool",
        href: "/nft-amm",
        icon: "activity",
        description: "Automated market maker pools for NFTs.",
        keywords: ["nft", "amm", "pool", "liquidity", "curve"],
      },
      {
        name: "Prediction Market",
        href: "/prediction-market",
        icon: "target",
        description: "Create markets and settle outcome positions.",
        keywords: ["prediction", "bet", "market", "odds", "outcome"],
        hiddenInSidebar: true,
      },
      {
        name: "Price Aggregator",
        href: "/price-aggregator",
        icon: "gauge",
        description: "Oracle price feed aggregation and staleness alerts.",
        keywords: ["oracle", "price", "feed", "twap", "rpc"],
        hiddenInSidebar: true,
      },
      {
        name: "Token Burn",
        href: "/token-burn",
        icon: "flask",
        description: "Burn allocations and deflationary token mechanics.",
        keywords: ["burn", "deflation", "supply", "sink"],
        hiddenInSidebar: true,
      },
      {
        name: "Token Gated Access",
        href: "/token-gated-access",
        icon: "key",
        description: "Gate contract calls behind a token balance.",
        keywords: ["gating", "access", "token", "allowlist"],
        hiddenInSidebar: true,
      },
    ],
  },
  {
    groupName: "Governance & Trust",
    items: [
      {
        name: "Governance Portal",
        href: "/governance/history",
        icon: "users",
        description: "Proposal history, quorum and voting outcomes.",
        keywords: ["governance", "proposal", "quorum", "vote", "dao"],
      },
      {
        name: "Quadratic Voting",
        href: "/quadratic-voting",
        icon: "fingerprint",
        description: "Weight votes by the square root of holdings.",
        keywords: ["quadratic", "sybil", "delegation", "vote"],
      },
      {
        name: "Treasury Panel",
        href: "/treasury",
        icon: "wallet",
        description: "Multi-sig treasury operations and approvals.",
        keywords: ["multisig", "signers", "approvals", "funds"],
      },
      {
        name: "Bug Bounty Program",
        href: "/bug-bounty",
        icon: "alert-triangle",
        description: "Report a vulnerability and track triage status.",
        keywords: ["bounty", "vulnerability", "report", "triage", "payout"],
      },
      {
        name: "Submit Bug Report",
        href: "/bug-bounty/submit",
        icon: "alert-triangle",
        description: "File a new disclosure with reproduction steps.",
        keywords: ["disclosure", "report", "submit", "finding"],
        hiddenInSidebar: true,
      },
      {
        name: "Oracle Node",
        href: "/oracle",
        icon: "gauge",
        description: "Oracle feeder health and price staleness.",
        keywords: ["oracle", "node", "heartbeat", "staleness"],
        hiddenInSidebar: true,
      },
    ],
  },
  {
    groupName: "Real World Assets",
    items: [
      {
        name: "Tokenized REIT",
        href: "/reit",
        icon: "building",
        description: "Fractional real estate shares and distributions.",
        keywords: ["real estate", "property", "rwa", "dividend", "shares"],
      },
      {
        name: "Patent Registry",
        href: "/patents",
        icon: "file-text",
        description: "Anchor and license patent filings on-chain.",
        keywords: ["patent", "ip", "licensing", "registry"],
      },
      {
        name: "Patent Registry (New)",
        href: "/patent-registry",
        icon: "file-text",
        description: "Redesigned patent filing and citation workspace.",
        keywords: ["patent", "filing", "citation", "prior art"],
        hiddenInSidebar: true,
      },
      {
        name: "Music Licensing",
        href: "/music-licensing",
        icon: "music",
        description: "Register tracks and issue usage licences.",
        keywords: ["music", "rights", "royalties", "licence", "audio"],
      },
      {
        name: "Upload Track",
        href: "/music-licensing/upload",
        icon: "music",
        description: "Upload an audio master and attach rights metadata.",
        keywords: ["upload", "audio", "track", "master"],
        hiddenInSidebar: true,
      },
      {
        name: "Data Marketplace",
        href: "/data-marketplace",
        icon: "database",
        description: "Buy and sell indexed datasets with provenance.",
        keywords: ["dataset", "provenance", "market", "feeds"],
      },
      {
        name: "Content Publishing",
        href: "/content-publishing",
        icon: "globe",
        description: "Publish and version on-chain long-form content.",
        keywords: ["publishing", "cms", "articles", "revisions"],
      },
      {
        name: "Warranty Registry",
        href: "/warranty",
        icon: "shield",
        description: "Register product warranties on-chain.",
        keywords: ["warranty", "product", "claims"],
        hiddenInSidebar: true,
      },
      {
        name: "Warranty Management",
        href: "/warranty-management",
        icon: "shield",
        description: "Operate warranty claims, transfers and redemptions.",
        keywords: ["warranty", "claims", "transfer", "redeem"],
        hiddenInSidebar: true,
      },
    ],
  },
  {
    groupName: "Gaming & Sports",
    items: [
      {
        name: "Sports Dashboard",
        href: "/sports",
        icon: "trophy",
        description: "Leagues, teams and live match telemetry.",
        keywords: ["sports", "teams", "league", "scores"],
      },
      {
        name: "Sports Prediction",
        href: "/sports-prediction",
        icon: "target",
        description: "Predict match outcomes and settle positions.",
        keywords: ["prediction", "betting", "match", "odds"],
      },
    ],
  },
  {
    groupName: "System",
    items: [
      {
        name: "Offline & Sync",
        href: "/offline",
        icon: "cloud-off",
        description: "Cached pages, queued changes and conflict status.",
        keywords: ["offline", "sync", "queue", "cached", "conflict", "network"],
      },
    ],
  },
];

/** Every route flattened out, in navigation order. */
export const ALL_ROUTES: NavigationItem[] = NAVIGATION.flatMap(
  (group) => group.items,
);

/** Look up the group that owns a route, or `undefined` for unknown routes. */
export function groupForRoute(href: string): string | undefined {
  return NAVIGATION.find((group) =>
    group.items.some((item) => item.href === href),
  )?.groupName;
}

/** Human-readable label for a route, falling back to the path itself. */
export function routeLabel(href: string): string {
  return ALL_ROUTES.find((item) => item.href === href)?.name ?? href;
}
