"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import TemplateCard, { type TemplateData } from "./TemplateCard";
import TemplateSearchBar from "./TemplateSearchBar";

const FAVORITES_KEY = "template-favorites";
const RECENT_KEY = "template-recent";

const CATEGORIES = [
  "financial",
  "governance",
  "utility",
  "identity",
  "data",
  "social",
  "gaming",
  "oracle",
  "supply-chain",
  "cross-chain",
] as const;

const templateManifest: TemplateData[] = [
  // ── Financial ──
  {
    id: "amm-pool",
    name: "AMM Pool",
    category: "financial",
    description: "Constant product automated market maker with LP tokens, swap fees, slippage protection, and TWAP price accumulator.",
    tags: ["amm", "swap", "liquidity", "defi", "pool"],
    path: "contracts/amm-pool",
    code: `// Copyright (c) 2026 StellarDevTools\n// SPDX-License-Identifier: MIT\n\n//! # Automated Market Maker (AMM) — Constant Product Pool\n//!\n//! Implements x * y = k with:\n//! - LP token minting/burning\n//! - 0.30% swap fee (configurable)`,
  },
  {
    id: "dex-aggregator",
    name: "DEX Aggregator",
    category: "financial",
    description: "Aggregates multiple on-chain liquidity pools and finds the optimal swap route with slippage protection.",
    tags: ["dex", "aggregator", "swap", "routing", "defi"],
    path: "contracts/dex-aggregator",
    code: `// Copyright (c) 2026 StellarDevTools\n// SPDX-License-Identifier: MIT\n\n//! # DEX Aggregator\n//!\n//! Aggregates multiple on-chain liquidity pools and finds the optimal swap route:\n//! - Register AMM-style pools with configurable fees and reserves.`,
  },
  {
    id: "flash-loan",
    name: "Flash Loan",
    category: "financial",
    description: "Uncollateralised flash loan provider with a 0.5% fee charged on each loan and added to the liquidity pool.",
    tags: ["flash-loan", "lending", "defi", "uncollateralized"],
    path: "contracts/flash-loan",
    code: `// Copyright (c) 2026 StellarDevTools\n// SPDX-License-Identifier: MIT\n\n//! # Flash Loan Provider\n//!\n//! Provides uncollateralised flash loans within a single transaction.\n//! A 0.5% fee is charged on each loan and added to the liquidity pool.`,
  },
  {
    id: "lending-protocol",
    name: "Lending Protocol",
    category: "financial",
    description: "Over-collateralised lending pool with a 150% minimum collateralisation ratio and liquidation mechanics.",
    tags: ["lending", "borrow", "collateral", "defi"],
    path: "contracts/lending-protocol",
    code: `// Copyright (c) 2026 StellarDevTools\n// SPDX-License-Identifier: MIT\n\n//! # Lending Protocol\n//!\n//! A simple over-collateralised lending pool.\n//!\n//! ## Collateral rules\n//! - **Borrow**: \`(borrowed + amount) * 150 <= deposited * 100\``,
  },
  {
    id: "limit-order-book",
    name: "Limit Order Book",
    category: "financial",
    description: "On-chain limit order book with price-time priority matching, partial fills, and comprehensive event emissions.",
    tags: ["orderbook", "trading", "limit-order", "defi"],
    path: "contracts/limit-order-book",
    code: `// Copyright (c) 2026 StellarDevTools\n// SPDX-License-Identifier: MIT\n\n//! # Limit Order Book\n//!\n//! On-chain limit order book with price-time priority matching:\n//! - Place buy/sell limit orders with price and quantity.\n//! - Automatic matching: best bid meets best ask.`,
  },
  {
    id: "nft-amm",
    name: "NFT AMM",
    category: "financial",
    description: "NFT automated market maker with linear and exponential bonding curves, supporting buy-only, sell-only, and trade pools.",
    tags: ["nft", "amm", "bonding-curve", "defi"],
    path: "contracts/nft-amm",
    code: `// Copyright (c) 2026 StellarDevTools\n// SPDX-License-Identifier: MIT\n\n//! # NFT AMM — Automated Market Maker for NFTs\n//!\n//! Implements a sudoswap-style NFT AMM with:\n//! - **Linear and exponential bonding curves** for dynamic pricing`,
  },
  {
    id: "nft-marketplace",
    name: "NFT Marketplace",
    category: "financial",
    description: "General purpose NFT marketplace with listing, buying, selling, and auction functionality.",
    tags: ["nft", "marketplace", "listing", "defi"],
    path: "contracts/nft-marketplace",
    code: `#![no_std]\n\n#[cfg(test)]\nmod test;\n\nuse soroban_sdk::{contract, contractimpl, contracttype, Address, Env, token};\n\n#[contracttype]\n#[derive(Clone)]\npub enum DataKey {`,
  },
  {
    id: "options-protocol",
    name: "Options Protocol",
    category: "financial",
    description: "On-chain call and put options where writers lock collateral, holders pay a premium, and can exercise before expiry.",
    tags: ["options", "derivatives", "defi"],
    path: "contracts/options-protocol",
    code: `// Copyright (c) 2026 StellarDevTools\n// SPDX-License-Identifier: MIT\n\n//! # Options Protocol\n//!\n//! On-chain call/put options: a writer locks collateral, a holder pays a\n//! premium, and can exercise before expiry.`,
  },
  {
    id: "prediction-market",
    name: "Prediction Market",
    category: "financial",
    description: "Decentralized prediction market platform for creating and trading on event outcomes.",
    tags: ["prediction", "market", "betting", "defi"],
    path: "contracts/prediction-market",
    code: `#![no_std]\n\nmod storage;\nmod types;\n\n#[cfg(test)]\nmod test;\n\nuse soroban_sdk::{contract, contractimpl, Address, Env, String};`,
  },
  {
    id: "stablecoin",
    name: "Stablecoin",
    category: "financial",
    description: "Stablecoin contract with minting, burning, and stability mechanisms for maintaining a soft peg.",
    tags: ["stablecoin", "peg", "defi"],
    path: "contracts/stablecoin",
    code: `#![cfg_attr(not(test), no_std)]\n\nuse soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env, Symbol, Vec};\n\n#[contracterror]\n#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]`,
  },
  {
    id: "synthetic-assets",
    name: "Synthetic Assets",
    category: "financial",
    description: "Synthetic asset minting against collateral with oracle price feeds, leveraged trading, and liquidation engine.",
    tags: ["synthetic", "assets", "defi", "collateral"],
    path: "contracts/synthetic-assets",
    code: `#![no_std]\n\nmod collateral;\nmod oracle;\nmod storage;\n#[cfg(test)]\nmod test;\nmod trading;\nmod types;\n\nuse soroban_sdk::{`,
  },
  {
    id: "token_contract",
    name: "Token Contract",
    category: "financial",
    description: "Standard Soroban token implementation supporting mint, burn, transfer, and balance operations.",
    tags: ["token", "standard", "soroban"],
    path: "contracts/token_contract",
    code: `//! Dummy Token Contract with robust error handling\nuse soroban_sdk::{contractimpl, Env, Symbol, Bytes, Error};\n\n#[derive(Debug, Clone, PartialEq, Eq)]\npub enum TokenError {\n    /// Returned when trying to mint zero amount\n    ZeroMint,`,
  },
  {
    id: "token-burn",
    name: "Token Burn",
    category: "financial",
    description: "Token burning mechanism with admin-controlled burning and supply tracking.",
    tags: ["token", "burn", "supply", "deflation"],
    path: "contracts/token-burn",
    code: `#![cfg_attr(not(test), no_std)]\n\nuse soroban_sdk::{contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env};\n\n// --- Errors ---\n\n#[contracterror]\n#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]`,
  },
  {
    id: "token-vesting",
    name: "Token Vesting",
    category: "financial",
    description: "Vesting schedule management with milestone-based token releases and multiple vesting types.",
    tags: ["vesting", "token", "schedule", "defi"],
    path: "contracts/token-vesting",
    code: `#![no_std]\n\nmod storage;\nmod types;\n\n#[cfg(test)]\nmod test;\n\nuse soroban_sdk::{contract, contractimpl, token, Address, Env, Vec};`,
  },
  {
    id: "tokenized-reit",
    name: "Tokenized REIT",
    category: "financial",
    description: "Tokenized real estate investment trust with fractional shares, dividend distribution, and share transfers.",
    tags: ["reit", "real-estate", "tokenized", "defi"],
    path: "contracts/tokenized-reit",
    code: `// Copyright (c) 2026 StellarDevTools\n// SPDX-License-Identifier: MIT\n\n//! # Tokenized REIT with Dividend Distribution\n//!\n//! A Soroban smart contract providing:\n//! - REIT creation: admin tokenizes real estate trusts into fractional shares.`,
  },
  {
    id: "yield-farming",
    name: "Yield Farming",
    category: "financial",
    description: "Yield farming aggregator with auto-compounding, strategy optimization, and per-user portfolio tracking.",
    tags: ["yield", "farming", "defi", "strategy"],
    path: "contracts/yield-farming",
    code: `// Copyright (c) 2026 StellarDevTools\n// SPDX-License-Identifier: MIT\n\n//! # Yield Farming Aggregator\n//!\n//! A Soroban smart contract that aggregates yield strategies with:\n//! - Auto-compounding: reinvests accrued rewards back into the principal.`,
  },
  {
    id: "yield-optimizer",
    name: "Yield Optimizer",
    category: "financial",
    description: "Automated yield optimization strategy manager with position tracking across multiple vault strategies.",
    tags: ["yield", "optimizer", "defi", "vault"],
    path: "contracts/yield-optimizer",
    code: `#![no_std]\n\nmod storage;\nmod test;\nmod types;\n\nuse soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, String, Vec};`,
  },
  {
    id: "payment_splitter",
    name: "Payment Splitter",
    category: "financial",
    description: "Dummy payment splitter contract with robust error handling for splitting payments among recipients.",
    tags: ["payment", "splitter", "defi"],
    path: "contracts/payment_splitter",
    code: `//! Dummy Payment Splitter contract with robust error handling\nuse soroban_sdk::{contractimpl, Env, Symbol, Vec, Bytes, Error};\n\n#[derive(Debug, Clone, PartialEq, Eq)]\npub enum SplitterError {`,
  },

  // ── Governance ──
  {
    id: "access-control",
    name: "Access Control",
    category: "governance",
    description: "Flexible role-based permission management with built-in Admin, Minter, Burner, Pauser, and Upgrader roles.",
    tags: ["access-control", "rbac", "permissions", "auth"],
    path: "contracts/access-control",
    code: `// Copyright (c) 2026 StellarDevTools\n// SPDX-License-Identifier: MIT\n\n//! # Access Control Contract  (Issue #594)\n//!\n//! Provides flexible, role-based permission management for Soroban applications.\n//!\n//! ## Roles\n//! Roles are stored as \`u32\` discriminants.`,
  },
  {
    id: "governance",
    name: "Governance",
    category: "governance",
    description: "Full DAO governance with proposal lifecycle, token-based voting, delegation, quorum, and execution timelock.",
    tags: ["dao", "governance", "voting", "proposal"],
    path: "contracts/governance",
    code: `// Copyright (c) 2026 StellarDevTools\n// SPDX-License-Identifier: MIT\n\n//! # DAO Governance Contract\n//!\n//! Proposal lifecycle: Draft -> Active -> Passed/Defeated -> Executed/Cancelled\n//! - One governance token = one vote (with delegation).`,
  },
  {
    id: "quadratic-voting",
    name: "Quadratic Voting",
    category: "governance",
    description: "Quadratic voting where voters spend credits and vote power scales as sqrt(credits), preventing whale dominance.",
    tags: ["quadratic", "voting", "governance", "credits"],
    path: "contracts/quadratic-voting",
    code: `// Copyright (c) 2026 StellarDevTools\n// SPDX-License-Identifier: MIT\n\n//! # Quadratic Voting Contract\n//!\n//! Voters spend **credits** to cast votes. The number of votes received equals\n//! \`floor(sqrt(credits))\`, making each additional vote progressively more`,
  },
  {
    id: "voting",
    name: "Voting",
    category: "governance",
    description: "Simple voting contract supporting multiple options, voter registration, and vote tracking.",
    tags: ["voting", "poll", "governance"],
    path: "contracts/voting",
    code: `#![no_std]\n\nmod storage;\nmod test;\nmod types;\n\nuse soroban_sdk::{contract, contractimpl, Address, Env, Symbol, Vec};`,
  },
  {
    id: "dao-treasury",
    name: "DAO Treasury",
    category: "governance",
    description: "Multi-signature treasury with role-based access, 24-hour timelock on transactions, and emergency pause.",
    tags: ["dao", "treasury", "multisig", "timelock"],
    path: "contracts/dao-treasury",
    code: `// Copyright (c) 2026 StellarDevTools\n// SPDX-License-Identifier: MIT\n\n//! # DAO Treasury Contract\n//!\n//! A multi-signature treasury with role-based access control, a 24-hour\n//! timelock on queued transactions, and an emergency pause mechanism.`,
  },
  {
    id: "multisig-wallet",
    name: "Multisig Wallet",
    category: "governance",
    description: "M-of-N multi-signature wallet with role-based access control, timelock, replay protection, and daily limits.",
    tags: ["multisig", "wallet", "rbac", "governance"],
    path: "contracts/multisig-wallet",
    code: `// Copyright (c) 2026 StellarDevTools\n// SPDX-License-Identifier: MIT\n\n//! # Multi-Signature Wallet with RBAC\n//!\n//! Features:\n//! - Configurable M-of-N threshold (e.g. 2-of-3, 3-of-5).`,
  },
  {
    id: "pause-toggle-contract",
    name: "Pause Toggle",
    category: "governance",
    description: "Admin-controlled emergency pause/unpause mechanism with role-based authorization for contract circuit breakers.",
    tags: ["pause", "circuit-breaker", "admin"],
    path: "contracts/pause-toggle-contract",
    code: `#![cfg_attr(not(test), no_std)]\n\nuse soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env};\n\n#[contracterror]\n#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]`,
  },
  {
    id: "admin-setter",
    name: "Admin Setter",
    category: "governance",
    description: "Simple admin management contract for setting and transferring administrative control.",
    tags: ["admin", "management", "governance"],
    path: "contracts/admin-setter",
    code: `#![no_std]\nuse soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, Symbol};\n\nconst ADMIN: Symbol = symbol_short!("ADMIN");\nconst VALUE: Symbol = symbol_short!("VALUE");\n\n#[contract]\npub struct AdminSetterContract;`,
  },
  {
    id: "allowlist",
    name: "Allowlist",
    category: "governance",
    description: "Address allowlist contract for permissioned access control to other contracts.",
    tags: ["allowlist", "whitelist", "access"],
    path: "contracts/allowlist",
    code: `#![no_std]\nuse soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, Symbol};\n\nconst ADMIN: Symbol = symbol_short!("ADMIN");\n\n#[contracttype]\npub enum DataKey {\n    Allow(Address),\n}`,
  },

  // ── Utility ──
  {
    id: "hello-world",
    name: "Hello World",
    category: "utility",
    description: "Minimal Soroban contract example that returns a greeting string. The starting point for learning Soroban.",
    tags: ["hello-world", "example", "tutorial", "starter"],
    path: "contracts/hello-world",
    code: `#![no_std]\n\nuse soroban_sdk::{contract, contractimpl, Env, String};\n\n#[contract]\npub struct HelloWorldContract;\n\n#[contractimpl]\nimpl HelloWorldContract {\n    pub fn hello(env: Env) -> String {`,
  },
  {
    id: "counter",
    name: "Counter",
    category: "utility",
    description: "Simple counter demonstrating persistent contract storage with increment and get functions.",
    tags: ["counter", "example", "storage", "tutorial"],
    path: "contracts/counter",
    code: `#![no_std]\nuse soroban_sdk::{contract, contractimpl, symbol_short, Env, Symbol};\n\nconst COUNTER: Symbol = symbol_short!("COUNTER");\n\n#[contract]\npub struct CounterContract;\n\n#[contractimpl]\nimpl CounterContract {`,
  },
  {
    id: "key-value-store",
    name: "Key-Value Store",
    category: "utility",
    description: "Generic key-value storage contract with CRUD operations and error handling.",
    tags: ["kv-store", "storage", "database", "utility"],
    path: "contracts/key-value-store",
    code: `// Copyright (c) 2026 StellarDevTools\n// SPDX-License-Identifier: MIT\n\n#![no_std]\n\nuse soroban_sdk::{contract, contracterror, contractimpl, contracttype, Bytes, Env};`,
  },
  {
    id: "debugging-utils",
    name: "Debugging Utils",
    category: "utility",
    description: "Collection of debugging utilities including logger, state inspector, execution tracer, gas profiler, and error debugger.",
    tags: ["debugging", "utils", "developer-tools"],
    path: "contracts/debugging-utils",
    code: `// Copyright (c) 2026 StellarDevTools\n// SPDX-License-Identifier: MIT\n\n//! # Debugging Utilities Contract\n//!\n//! Collection of debugging utilities for Soroban smart contracts:\n//! - DebugLogger: Log messages with sanitization`,
  },
  {
    id: "proxy-pattern",
    name: "Proxy Pattern",
    category: "utility",
    description: "Upgradeable proxy pattern implementation supporting WASM upgrades with preserved state and address.",
    tags: ["proxy", "upgradeable", "pattern"],
    path: "contracts/proxy-pattern",
    code: `#![no_std]\n\nuse soroban_sdk::{\n    contract, contractimpl, contracttype, symbol_short, Address, Env, Symbol, String, Vec,\n};`,
  },
  {
    id: "upgradeable",
    name: "Upgradeable",
    category: "utility",
    description: "Contract upgrade mechanism enabling admins to replace WASM implementation while preserving on-chain state.",
    tags: ["upgradeable", "proxy", "wasm"],
    path: "contracts/upgradeable",
    code: `// Copyright (c) 2026 StellarDevTools\n// SPDX-License-Identifier: MIT\n\n//! # Upgradeable Contract  (Issue #587)\n//!\n//! Enables admins to upgrade the WASM implementation of a contract while\n//! preserving on-chain state and address.`,
  },
  {
    id: "versioned",
    name: "Versioned",
    category: "utility",
    description: "Semantic version tracking for Soroban contracts with migration history and rollback support.",
    tags: ["versioning", "migration", "semver"],
    path: "contracts/versioned",
    code: `// Copyright (c) 2026 StellarDevTools\n// SPDX-License-Identifier: MIT\n\n//! # Versioned Contract  (Issue #588)\n//!\n//! Tracks the semantic version history of a Soroban application on-chain,\n//! supports forward migrations and rollbacks, and persists an audit log of`,
  },
  {
    id: "storage-utils",
    name: "Storage Utils",
    category: "utility",
    description: "Reusable gas-efficient storage patterns: StorageMap, StorageVec, StorageQueue, StorageStack, and StorageSet.",
    tags: ["storage", "utils", "patterns"],
    path: "contracts/storage-utils",
    code: `// Copyright (c) 2026 StellarDevTools\n// SPDX-License-Identifier: MIT\n\n//! # Storage Utilities Contract\n//!\n//! Provides reusable, gas-efficient storage patterns for Soroban contracts:\n//! - **StorageMap**: key-value mapping`,
  },
  {
    id: "cross-contract-utils",
    name: "Cross-Contract Utils",
    category: "utility",
    description: "Utilities for cross-contract calls including batched invocations, retry logic, and argument encoding helpers.",
    tags: ["cross-contract", "utils", "calls"],
    path: "contracts/cross-contract-utils",
    code: `#![no_std]\n\nmod test;\n\nuse soroban_sdk::{\n    contract, contracterror, contractimpl, symbol_short, Address, Env, String, Val, Vec, Map, Symbol,\n};`,
  },
  {
    id: "analysis-utils",
    name: "Analysis Utils",
    category: "utility",
    description: "On-chain storage for contract analysis results from off-chain tooling including security, gas, and code quality.",
    tags: ["analysis", "audit", "security", "gas"],
    path: "contracts/analysis-utils",
    code: `// Copyright (c) 2026 StellarDevTools\n// SPDX-License-Identifier: MIT\n\n//! # Analysis Utils Contract  (Issue #595)\n//!\n//! Provides on-chain storage of contract analysis results produced by off-chain\n//! tooling (static analysers, gas estimators, formal verifiers).`,
  },
  {
    id: "simulation-engine",
    name: "Simulation Engine",
    category: "utility",
    description: "Mock environment simulation engine for testing contract behavior under various conditions.",
    tags: ["simulation", "testing", "devtools"],
    path: "contracts/simulation-engine",
    code: `#![no_std]\n\nuse soroban_sdk::{\n    contract, contractimpl, contracttype, symbol_short, Address, Env, Symbol, Vec, Map,\n    String, U256,\n};`,
  },

  // ── Identity ──
  {
    id: "did-registry",
    name: "DID Registry",
    category: "identity",
    description: "Decentralized identifier registry for managing W3C-compliant DIDs on Soroban.",
    tags: ["did", "identity", "w3c", "registry"],
    path: "contracts/did-registry",
    code: `// Copyright (c) 2026 StellarDevTools\n// SPDX-License-Identifier: MIT\n\n#![no_std]\n\nmod storage;\nmod types;\n\n#[cfg(test)]\nmod test;\n\nuse soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, String};`,
  },
  {
    id: "profile-registry",
    name: "Profile Registry",
    category: "identity",
    description: "User profile registry storing on-chain names and bios linked to Stellar addresses.",
    tags: ["profile", "registry", "identity", "social"],
    path: "contracts/profile-registry",
    code: `#![no_std]\nuse soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String};\n\n#[contracttype]\n#[derive(Clone, Debug, Eq, PartialEq)]\npub struct UserProfile {\n    pub name: String,\n    pub bio: String,`,
  },
  {
    id: "erc-721",
    name: "ERC-721",
    category: "identity",
    description: "NFT token standard implementation compatible with the ERC-721 interface for unique asset management.",
    tags: ["nft", "erc721", "token", "standard"],
    path: "contracts/erc-721",
    code: `#![no_std]\n\nmod test;\n\nuse soroban_sdk::{\n    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, String, Vec,\n};`,
  },
  {
    id: "carbon-credit",
    name: "Carbon Credit",
    category: "identity",
    description: "Carbon credit tokenization platform with issuance, trading, retirement, and verified issuer management.",
    tags: ["carbon", "credit", "sustainability", "esg"],
    path: "contracts/carbon-credit",
    code: `#![no_std]\nuse soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, Symbol, symbol_short, log, vec, Vec};`,
  },
  {
    id: "patent-registry",
    name: "Patent Registry",
    category: "identity",
    description: "Patent filing and management system with licensing, transfers, dispute resolution, and admin controls.",
    tags: ["patent", "registry", "ip", "licensing"],
    path: "contracts/patent-registry",
    code: `// Copyright (c) 2026 StellarDevTools\n// SPDX-License-Identifier: MIT\n\n//! # Patent Registry\n//!\n//! A Soroban smart contract providing:\n//! - Patent filing: inventors register patents with title, description, and expiry.`,
  },
  {
    id: "music-licensing",
    name: "Music Licensing",
    category: "identity",
    description: "Decentralized music licensing platform for registering tracks, issuing licenses, and managing rights.",
    tags: ["music", "licensing", "copyright", "ip"],
    path: "contracts/music-licensing",
    code: `#![no_std]\nmod test;\n\nuse soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, String, Symbol, Vec};`,
  },
  {
    id: "music-royalty",
    name: "Music Royalty",
    category: "identity",
    description: "Music royalty distribution system tracking songs, usage records, licenses, and revenue splits.",
    tags: ["music", "royalty", "revenue", "ip"],
    path: "contracts/music-royalty",
    code: `#![no_std]\n\nmod storage;\nmod types;\n\nuse soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, String, Vec};`,
  },
  {
    id: "real-estate",
    name: "Real Estate",
    category: "identity",
    description: "Tokenized real estate platform for fractional property investment, rental distribution, and share transfers.",
    tags: ["real-estate", "tokenized", "property", "rwa"],
    path: "contracts/real-estate",
    code: `// Copyright (c) 2026 StellarDevTools\n// SPDX-License-Identifier: MIT\n\n//! # Tokenized Real Estate\n//!\n//! A Soroban smart contract providing:\n//! - Property listing: admin tokenizes properties into fractional shares.`,
  },
  {
    id: "real-estate-oracle",
    name: "Real Estate Oracle",
    category: "identity",
    description: "Real estate data oracle providing property valuations and market data for the tokenized real estate ecosystem.",
    tags: ["real-estate", "oracle", "data", "rwa"],
    path: "contracts/real-estate-oracle",
    code: `// No lib.rs — Cargo.toml only\n// Real estate data oracle providing property valuations\n// and market data for the tokenized real estate ecosystem.`,
  },

  // ── Data ──
  {
    id: "cloud-storage",
    name: "Cloud Storage",
    category: "data",
    description: "Decentralized cloud storage marketplace connecting storage providers with users seeking data persistence.",
    tags: ["storage", "cloud", "marketplace"],
    path: "contracts/cloud-storage",
    code: `#![no_std]\n\nmod storage;\nmod types;\n\nuse soroban_sdk::{contract, contractimpl, Address, Env, String};`,
  },
  {
    id: "content-publishing",
    name: "Content Publishing",
    category: "data",
    description: "Decentralized content platform with channels, articles, subscriptions, tips, and creator analytics.",
    tags: ["content", "publishing", "subscription", "social"],
    path: "contracts/content-publishing",
    code: `#![no_std]\n//! Decentralized Content Publishing Platform\n//!\n//! Authors register channels, publish articles (off-chain content referenced by hash),\n//! collect tips from readers, and sell time-bounded subscriptions.`,
  },
  {
    id: "data-marketplace",
    name: "Data Marketplace",
    category: "data",
    description: "Privacy-preserving data marketplace with encrypted datasets, license-based access, and commitment queries.",
    tags: ["data", "marketplace", "privacy", "license"],
    path: "contracts/data-marketplace",
    code: `#![no_std]\n//! Decentralized Data Marketplace with Privacy-Preserving Queries\n//!\n//! Providers list datasets (referenced by manifest + schema hashes; the actual\n//! payload lives off-chain, encrypted under the dataset's public key).`,
  },
  {
    id: "file-notary",
    name: "File Notary",
    category: "data",
    description: "File hash notarization service for proving file existence and integrity at a point in time.",
    tags: ["notary", "file", "hash", "verification"],
    path: "contracts/file-notary",
    code: `#![cfg_attr(not(test), no_std)]\n\nuse soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, BytesN, Env, String};`,
  },
  {
    id: "donation-tracker",
    name: "Donation Tracker",
    category: "data",
    description: "Donation tracking contract that records contributions and donor addresses with cumulative totals.",
    tags: ["donation", "charity", "tracking"],
    path: "contracts/donation-tracker",
    code: `#![no_std]\nuse soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, Symbol};\n\nconst TOTAL_DONATIONS: Symbol = symbol_short!("TOTAL");\nconst DONORS: Symbol = symbol_short!("DONORS");`,
  },
  {
    id: "subscription_manager",
    name: "Subscription Manager",
    category: "data",
    description: "Subscription management contract for recurring payments and membership access control.",
    tags: ["subscription", "recurring", "membership"],
    path: "contracts/subscription_manager",
    code: `// No lib.rs — Cargo.toml only\n// Subscription management contract for recurring payments\n// and membership access control.`,
  },

  // ── Social ──
  {
    id: "message-board",
    name: "Message Board",
    category: "social",
    description: "Decentralized message board for posting and managing messages with content validation and moderation.",
    tags: ["message", "board", "social", "forum"],
    path: "contracts/message-board",
    code: `// Copyright (c) 2026 StellarDevTools\n// SPDX-License-Identifier: MIT\n\n#![no_std]\n\nuse soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env, String, Vec};`,
  },
  {
    id: "social-media",
    name: "Social Media",
    category: "social",
    description: "Decentralized social media platform with profiles, posts, follows, and social graph management.",
    tags: ["social", "media", "profiles", "posts"],
    path: "contracts/social-media",
    code: `#![no_std]\nuse soroban_sdk::{\n    contract, contractimpl, contracttype, Address, Env, String, Vec, log, symbol_short, vec,\n};`,
  },

  // ── Gaming ──
  {
    id: "lottery",
    name: "Lottery",
    category: "gaming",
    description: "On-chain lottery system with ticket purchasing, random draw, prize distribution, and round management.",
    tags: ["lottery", "gaming", "random", "prize"],
    path: "contracts/lottery",
    code: `#![no_std]\n\nmod storage;\nmod types;\n\n#[cfg(test)]\nmod test;\n\nuse soroban_sdk::{contract, contractimpl, Address, Bytes, Env};`,
  },
  {
    id: "sports-prediction",
    name: "Sports Prediction",
    category: "gaming",
    description: "Sports prediction market for betting on sports outcomes with oracle-based resolution.",
    tags: ["sports", "prediction", "betting", "gaming"],
    path: "contracts/sports-prediction",
    code: `#![no_std]\n\nmod storage;\nmod types;\n\n#[cfg(test)]\nmod test;\n\nuse soroban_sdk::{contract, contractimpl, Address, Env, String, Vec, symbol_short};`,
  },
  {
    id: "sports-prediction-market",
    name: "Sports Prediction Market",
    category: "gaming",
    description: "Decentralized sports betting with three-way markets, basis point odds, and proportional payouts.",
    tags: ["sports", "prediction", "market", "betting", "gaming"],
    path: "contracts/sports-prediction-market",
    code: `//! # Sports Prediction Market\n//!\n//! A Soroban smart contract for decentralized sports betting with:\n//! - Three-way markets (Home / Draw / Away)\n//! - Odds stored as basis points (10000 = 1.00x, 20000 = 2.00x)`,
  },
  {
    id: "job-marketplace",
    name: "Job Marketplace",
    category: "gaming",
    description: "Decentralized job marketplace for listing positions, applying, and managing the hiring workflow.",
    tags: ["job", "marketplace", "hiring", "gig"],
    path: "contracts/job-marketplace",
    code: `#![no_std]\nuse soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, Symbol, token};`,
  },

  // ── Oracle ──
  {
    id: "insurance-oracle",
    name: "Insurance Oracle",
    category: "oracle",
    description: "Insurance data oracle providing tamper-resistant data from multiple sources with verification thresholds.",
    tags: ["insurance", "oracle", "data", "verification"],
    path: "contracts/insurance-oracle",
    code: `#![no_std]\n\nmod test;\n\nuse soroban_sdk::{\n    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, String, Vec,\n};`,
  },
  {
    id: "insurance-protocol",
    name: "Insurance Protocol",
    category: "oracle",
    description: "Decentralized insurance marketplace with risk assessment, policy purchase, claim filing, and claim voting.",
    tags: ["insurance", "claims", "risk", "coverage"],
    path: "contracts/insurance-protocol",
    code: `// Copyright (c) 2026 StellarDevTools\n// SPDX-License-Identifier: MIT\n\n//! # Decentralized Insurance Protocol\n//!\n//! A Soroban smart contract providing:\n//! - Coverage marketplace: admin lists products with risk scores and premiums.`,
  },
  {
    id: "interest-rate-model",
    name: "Interest Rate Model",
    category: "oracle",
    description: "Configurable interest rate model with tiered rates, utilization curves, and rate snapshots for lending protocols.",
    tags: ["interest", "rate", "lending", "model"],
    path: "contracts/interest-rate-model",
    code: `#![no_std]\n\nmod storage;\nmod types;\n\n#[cfg(test)]\nmod test;\n\nuse soroban_sdk::{contract, contractimpl, Address, Env, Vec};`,
  },
  {
    id: "price_feed_adapter",
    name: "Price Feed Adapter",
    category: "oracle",
    description: "Price feed adapter providing standardized price data for various asset symbols with error handling.",
    tags: ["price-feed", "oracle", "price"],
    path: "contracts/price_feed_adapter",
    code: `//! Dummy Price Feed Adapter contract with robust error handling\nuse soroban_sdk::{contractimpl, Env, Symbol, Bytes, Error};\n\n#[derive(Debug, Clone, PartialEq, Eq)]\npub enum PriceFeedError {\n    /// Returned when the requested symbol is not supported`,
  },
  {
    id: "sports-results-oracle",
    name: "Sports Results Oracle",
    category: "oracle",
    description: "Tamper-resistant sports results data provider with multi-source verification and circuit breaker mechanisms.",
    tags: ["sports", "oracle", "results", "data"],
    path: "contracts/sports-results-oracle",
    code: `// Copyright (c) 2026 StellarDevTools\n// SPDX-License-Identifier: MIT\n\n//! # Sports Results Oracle Contract\n//!\n//! Provides tamper-resistant sports data for Soroban applications.\n//! Supports multiple data sources, verification thresholds, and circuit breakers.`,
  },

  // ── Supply Chain ──
  {
    id: "supply-chain",
    name: "Supply Chain",
    category: "supply-chain",
    description: "End-to-end supply chain tracking with provenance verification, checkpoint traceability, and recall mechanisms.",
    tags: ["supply-chain", "tracking", "logistics", "provenance"],
    path: "contracts/supply-chain",
    code: `// Copyright (c) 2026 StellarDevTools\n// SPDX-License-Identifier: MIT\n\n//! # Supply Chain Tracking Contract\n//!\n//! Tracks products from registration through delivery with:\n//! - Provenance verification via metadata hashes`,
  },
  {
    id: "supply-chain-data-oracle",
    name: "Supply Chain Data Oracle",
    category: "supply-chain",
    description: "Tamper-resistant logistics data provider with IoT sensor support, multi-source verification, and provenance tracking.",
    tags: ["supply-chain", "oracle", "iot", "logistics"],
    path: "contracts/supply-chain-data-oracle",
    code: `// Copyright (c) 2026 StellarDevTools\n// SPDX-License-Identifier: MIT\n\n//! # Supply Chain Data Oracle Contract\n//!\n//! Provides tamper-resistant logistics data for Soroban applications.\n//! Supports IoT sensor data, multi-source verification, provenance tracking,`,
  },
  {
    id: "supply-chain-oracle",
    name: "Supply Chain Oracle",
    category: "supply-chain",
    description: "Full shipment lifecycle oracle with multi-source consensus, provenance events, circuit breakers, and admin controls.",
    tags: ["supply-chain", "oracle", "shipment", "logistics"],
    path: "contracts/supply-chain-oracle",
    code: `// Copyright (c) 2026 StellarDevTools\n// SPDX-License-Identifier: MIT\n\n//! # Supply Chain Oracle Contract\n//!\n//! Full shipment lifecycle tracking with multi-source consensus, provenance\n//! events, circuit breakers, and admin controls.`,
  },
  {
    id: "warranty-management",
    name: "Warranty Management",
    category: "supply-chain",
    description: "Product warranty management system with status tracking for active, claimed, and expired warranties.",
    tags: ["warranty", "product", "claims", "supply-chain"],
    path: "contracts/warranty-management",
    code: `// Copyright (c) 2026 StellarDevTools\n// SPDX-License-Identifier: MIT\n\n#![no_std]\n\nuse soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, String};`,
  },
  {
    id: "escrow",
    name: "Escrow",
    category: "supply-chain",
    description: "Escrow contract with milestone-based release, arbitration, and dispute resolution for secure transactions.",
    tags: ["escrow", "escrow", "dispute", "arbitration"],
    path: "contracts/escrow",
    code: `#![no_std]\n\nmod storage;\nmod types;\n\n#[cfg(test)]\nmod test;\n\nuse soroban_sdk::{contract, contractimpl, Address, Env, Vec};`,
  },
  {
    id: "airdrop",
    name: "Airdrop",
    category: "supply-chain",
    description: "Token airdrop distribution contract supporting multiple recipients, claim windows, and vesting schedules.",
    tags: ["airdrop", "distribution", "token"],
    path: "contracts/airdrop",
    code: `#![no_std]\n\nmod storage;\nmod types;\n\n#[cfg(test)]\nmod test;\n\nuse soroban_sdk::{`,
  },
  {
    id: "bug-bounty",
    name: "Bug Bounty",
    category: "supply-chain",
    description: "Vulnerability disclosure program with severity-based rewards, lifecycle tracking, and emergency pause.",
    tags: ["bug-bounty", "security", "vulnerability", "rewards"],
    path: "contracts/bug-bounty",
    code: `// Copyright (c) 2026 StellarDevTools\n// SPDX-License-Identifier: MIT\n\n//! # Bug Bounty Contract\n//!\n//! Manages vulnerability disclosure reports with severity-based rewards,\n//! lifecycle tracking, and an emergency pause mechanism.`,
  },
  {
    id: "staking",
    name: "Staking",
    category: "supply-chain",
    description: "Token staking contract with rewards distribution, share tracking, and unstaking mechanics.",
    tags: ["staking", "rewards", "defi"],
    path: "contracts/staking",
    code: `#![no_std]\n\nmod storage;\nmod types;\n\n#[cfg(test)]\nmod test;\n\nuse soroban_sdk::{contract, contractimpl, token, Address, Env};`,
  },

  // ── Cross-Chain ──
  {
    id: "cross-chain-bridge",
    name: "Cross-Chain Bridge",
    category: "cross-chain",
    description: "Stellar to Ethereum bridge using lock-mint pattern with relayer confirmation, expiry, and admin controls.",
    tags: ["bridge", "cross-chain", "ethereum", "interoperability"],
    path: "contracts/cross-chain-bridge",
    code: `// Copyright (c) 2026 StellarDevTools\n// SPDX-License-Identifier: MIT\n\n//! # Cross-Chain Bridge (Lock-Mint)\n//!\n//! Stellar-side of a Stellar ↔ Ethereum bridge:\n//! - Users lock tokens on Stellar; a trusted relayer confirms the ETH mint.`,
  },
];

function loadFavorites(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function saveFavorites(ids: string[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(ids));
}

function loadRecent(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function saveRecent(ids: string[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(RECENT_KEY, JSON.stringify(ids));
}

export default function TemplateLibraryGrid() {
  const [searchText, setSearchText] = useState("");
  const [activeCategories, setActiveCategories] = useState<Set<string>>(
    new Set()
  );
  const [favorites, setFavorites] = useState<string[]>([]);
  const [, setRecent] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      setFavorites(loadFavorites());
      setRecent(loadRecent());
    } catch {
      setError("Failed to load persisted data");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleToggleFavorite = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = prev.includes(id)
        ? prev.filter((fid) => fid !== id)
        : [...prev, id];
      saveFavorites(next);
      return next;
    });
  }, []);

  const handleSelectTemplate = useCallback((id: string) => {
    setRecent((prev) => {
      const next = [id, ...prev.filter((rid) => rid !== id)].slice(0, 5);
      saveRecent(next);
      return next;
    });
  }, []);

  const toggleCategory = useCallback((cat: string) => {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) {
        next.delete(cat);
      } else {
        next.add(cat);
      }
      return next;
    });
  }, []);

  const clearFilters = useCallback(() => {
    setSearchText("");
    setActiveCategories(new Set());
  }, []);

  const filtered = useMemo(() => {
    let result = templateManifest;

    if (searchText.trim()) {
      const q = searchText.toLowerCase();
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q))
      );
    }

    if (activeCategories.size > 0) {
      result = result.filter((t) => activeCategories.has(t.category));
    }

    return result;
  }, [searchText, activeCategories]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
          <p className="text-sm text-slate-400">Loading templates...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="rounded-xl border border-rose-700 bg-rose-900/30 p-4 text-sm text-rose-300"
        role="alert"
      >
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <TemplateSearchBar
        value={searchText}
        onChange={setSearchText}
        resultCount={filtered.length}
      />

      <div
        role="group"
        aria-label="Filter by category"
        className="flex flex-wrap gap-2"
      >
        {CATEGORIES.map((cat) => {
          const active = activeCategories.has(cat);
          return (
            <button
              key={cat}
              type="button"
              role="checkbox"
              aria-checked={active}
              onClick={() => toggleCategory(cat)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? "bg-cyan-600/30 text-cyan-200 border border-cyan-500/40"
                  : "bg-slate-800/60 text-slate-400 border border-slate-700/40 hover:border-slate-600 hover:text-slate-300"
              }`}
            >
              {cat}
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <p className="text-sm text-slate-400">
            No templates match your search or filters.
          </p>
          <button
            type="button"
            onClick={clearFilters}
            className="rounded-lg border border-slate-700 bg-slate-800/60 px-4 py-2 text-xs font-medium text-slate-300 transition hover:border-slate-600 hover:text-white"
          >
            Clear all filters
          </button>
        </div>
      ) : (
        <div
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          aria-label="Contract templates"
        >
          {filtered.map((template) => (
            <div
              key={template.id}
              onClick={() => handleSelectTemplate(template.id)}
            >
              <TemplateCard
                template={template}
                isFavorite={favorites.includes(template.id)}
                onToggleFavorite={handleToggleFavorite}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export { templateManifest, CATEGORIES };
