/**
 * Contract template catalog shared by the template gallery and the IDE.
 *
 * The gallery links to `/playground?template=<id>`, so the catalog lives here
 * rather than inside the gallery page: the IDE has to resolve the same ids to
 * the same sources, and a second copy would silently drift.
 */

export interface Template {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  difficulty: "Beginner" | "Intermediate" | "Advanced";
  code: string;
  communityRating?: number;
  ratingCount?: number;
  forksCount?: number;
}

export const TEMPLATES: Template[] = [
  {
    id: "hello-world",
    name: "Hello World",
    description: "Minimal Soroban contract that returns a greeting symbol.",
    category: "Basics",
    tags: ["beginner", "storage"],
    difficulty: "Beginner",
    code: `#![no_std]
use soroban_sdk::{contract, contractimpl, Env, Symbol, symbol_short};

#[contract]
pub struct HelloContract;

#[contractimpl]
impl HelloContract {
    pub fn hello(env: Env, to: Symbol) -> Vec<Symbol> {
        vec![&env, symbol_short!("Hello"), to]
    }
}
`,
  },
  {
    id: "fungible-token",
    name: "Fungible Token",
    description: "SEP-41 compliant token with mint, transfer, and allowance.",
    category: "Tokens",
    tags: ["token", "defi", "sep41"],
    difficulty: "Intermediate",
    code: `// Fungible Token contract skeleton
// Implements basic ERC-20-style interface
`,
  },
  {
    id: "nft-mint",
    name: "NFT Mint",
    description:
      "Non-fungible token contract with minting and ownership transfer.",
    category: "Tokens",
    tags: ["nft", "token"],
    difficulty: "Intermediate",
    code: `// NFT Mint contract skeleton
`,
  },
  {
    id: "multisig",
    name: "Multisig Wallet",
    description: "M-of-N multisig contract for shared treasury control.",
    category: "Security",
    tags: ["multisig", "governance", "wallet"],
    difficulty: "Advanced",
    code: `// Multisig Wallet contract skeleton
`,
  },
  {
    id: "vesting",
    name: "Token Vesting",
    description: "Linear vesting schedule with cliff period support.",
    category: "Finance",
    tags: ["vesting", "defi", "token"],
    difficulty: "Intermediate",
    code: `// Vesting contract skeleton
`,
  },
  {
    id: "escrow",
    name: "Escrow",
    description: "Two-party escrow with arbiter dispute resolution.",
    category: "Finance",
    tags: ["escrow", "defi"],
    difficulty: "Intermediate",
    code: `// Escrow contract skeleton
`,
  },
  {
    id: "storage-counter",
    name: "Storage Counter",
    description: "Simple persistent counter showing ledger storage patterns.",
    category: "Basics",
    tags: ["beginner", "storage"],
    difficulty: "Beginner",
    code: `// Storage counter skeleton
`,
  },
  {
    id: "oracle",
    name: "Price Oracle",
    description: "On-chain price feed with admin update and TTL management.",
    category: "DeFi",
    tags: ["oracle", "defi", "price-feed"],
    difficulty: "Advanced",
    communityRating: 4.8,
    ratingCount: 156,
    forksCount: 420,
    code: `// Oracle contract skeleton
`,
  },
  {
    id: "gaming-arena",
    name: "Turn-Based Gaming Arena",
    description: "Turn-based gaming state machine with move verification, player turn timers, and reward pools.",
    category: "Gaming",
    tags: ["gaming", "state-machine", "pvp"],
    difficulty: "Intermediate",
    communityRating: 4.8,
    ratingCount: 124,
    forksCount: 312,
    code: `// Turn-Based Gaming Arena contract skeleton
`,
  },
  {
    id: "rwa-treasury-vault",
    name: "RWA Tokenized Yield Vault",
    description: "Real-World Asset (RWA) compliance vault with oracle yield distributions and identity whitelisting.",
    category: "RWA",
    tags: ["rwa", "yield", "vault", "institutional"],
    difficulty: "Advanced",
    communityRating: 4.9,
    ratingCount: 205,
    forksCount: 540,
    code: `// RWA Tokenized Yield Vault contract skeleton
`,
  },
  {
    id: "identity-verifier",
    name: "Decentralized Identity Credential Registry",
    description: "W3C-compliant DID registry with zero-knowledge proof verification and claim attestation.",
    category: "Identity",
    tags: ["identity", "did", "zk", "credentials"],
    difficulty: "Intermediate",
    communityRating: 4.7,
    ratingCount: 98,
    forksCount: 265,
    code: `// Identity Credential Registry contract skeleton
`,
  },
  {
    id: "defi-amm",
    name: "Constant-Product AMM Liquidity Pool",
    description: "Decentralized automated market maker with x * y = k liquidity pools and swap fees.",
    category: "DeFi",
    tags: ["defi", "amm", "swap", "liquidity"],
    difficulty: "Advanced",
    communityRating: 4.9,
    ratingCount: 382,
    forksCount: 890,
    code: `// DeFi Constant-Product AMM contract skeleton
`,
  },
];

/** True when the template ships a real contract body rather than a skeleton. */
export function isRunnableTemplate(template: Template): boolean {
  return !/^\/\/.*skeleton/m.test(template.code.trim());
}

/**
 * Resolve a `?template=<id>` value to its catalog entry.
 *
 * Returns `null` for unknown or malformed ids so callers can fall back to their
 * default source instead of loading attacker-controlled text into the editor.
 */
export function findTemplate(id: string | null | undefined): Template | null {
  if (!id) {
    return null;
  }

  const normalized = id.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  return TEMPLATES.find((template) => template.id === normalized) ?? null;
}
