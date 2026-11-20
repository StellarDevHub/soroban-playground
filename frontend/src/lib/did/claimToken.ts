// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * @file claimToken.ts
 * W3C Verifiable Presentation (VP) Claim Token encoder, decoder and verifier
 * for Stellar Soroban Decentralized Identity credentials.
 */

import type {
  VerifiableCredential,
  VerifiablePresentation,
  PresentationClaimToken,
} from "../../types/did";

/**
 * Encodes a string to URL-safe Base64 without padding.
 */
export function base64UrlEncode(str: string): string {
  if (typeof btoa !== "undefined") {
    return btoa(unescape(encodeURIComponent(str)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }
  return Buffer.from(str, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Decodes a URL-safe Base64 string.
 */
export function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) {
    base64 += "=";
  }
  if (typeof atob !== "undefined") {
    return decodeURIComponent(escape(atob(base64)));
  }
  return Buffer.from(base64, "base64").toString("utf8");
}

/**
 * Builds a W3C-compliant Verifiable Presentation from a Verifiable Credential.
 */
export function createVerifiablePresentation(
  credential: VerifiableCredential,
  options: {
    challenge?: string;
    nonce?: string;
    expiresInSeconds?: number;
  } = {},
): VerifiablePresentation {
  const issuedAt = new Date().toISOString();
  const validitySeconds = options.expiresInSeconds ?? 86400 * 30; // 30 days
  const expiresAt = new Date(Date.now() + validitySeconds * 1000).toISOString();

  return {
    "@context": [
      "https://www.w3.org/2018/credentials/v1",
      "https://w3id.org/security/suites/ed25519-2020/v1",
      "https://stellar.org/soroban/did/v1",
    ],
    type: ["VerifiablePresentation", "SorobanCredentialPresentation"],
    id: `urn:uuid:presentation-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    verifiableCredential: [credential],
    holder: credential.credentialSubject.id,
    challenge: options.challenge ?? "soroban-playground-verify-gate",
    nonce: options.nonce ?? `nonce-${Math.random().toString(36).substring(2, 11)}`,
    issuedAt,
    expiresAt,
    proof: {
      type: "SorobanSmartContractAttestation2026",
      created: issuedAt,
      verificationMethod: `${credential.credentialSubject.id}#key-1`,
      proofPurpose: "authentication",
      proofValue: credential.proof.proofValue,
      contractAttestationHash: credential.proof.contractAttestationHash,
    },
  };
}

/**
 * Encodes a Verifiable Presentation into a compact Claim Token string for QR code generation.
 */
export function encodePresentationClaimToken(presentation: VerifiablePresentation): string {
  const credential = presentation.verifiableCredential[0];
  const claimToken: PresentationClaimToken = {
    version: "1.0.0",
    protocol: "soroban-did-vp",
    presentationId: presentation.id,
    subjectDid: presentation.holder,
    issuerDid: credential?.issuer.id ?? "unknown-issuer",
    credentialTitle: credential?.title ?? "Decentralized Credential",
    claims: {
      name: credential?.credentialSubject.name,
      role: credential?.credentialSubject.role,
      reputation: credential?.credentialSubject.reputation,
      tier: credential?.credentialSubject.tier,
      organization: credential?.credentialSubject.organization,
      stellarAddress: credential?.credentialSubject.stellarAddress,
      ...credential?.credentialSubject.claims,
    },
    attestationHash: credential?.proof.contractAttestationHash ?? credential?.proof.proofValue ?? "",
    validFrom: credential?.issuanceDate ?? presentation.issuedAt,
    validUntil: credential?.expirationDate ?? presentation.expiresAt,
    status: credential?.status ?? "Active",
    rawVpPayload: JSON.stringify(presentation),
  };

  const serialized = JSON.stringify(claimToken);
  return `soroban-vp:v1:${base64UrlEncode(serialized)}`;
}

export interface VerificationResult {
  valid: boolean;
  errors: string[];
  claimToken?: PresentationClaimToken;
  presentation?: VerifiablePresentation;
  verifiedAt: string;
}

/**
 * Decodes and verifies a QR code presentation token string.
 */
export function verifyPresentationClaimToken(tokenString: string): VerificationResult {
  const errors: string[] = [];
  const now = new Date();

  if (!tokenString || typeof tokenString !== "string") {
    return {
      valid: false,
      errors: ["Empty or invalid token string provided."],
      verifiedAt: now.toISOString(),
    };
  }

  let rawJson = "";
  if (tokenString.startsWith("soroban-vp:v1:")) {
    const b64 = tokenString.substring("soroban-vp:v1:".length);
    try {
      rawJson = base64UrlDecode(b64);
    } catch {
      return {
        valid: false,
        errors: ["Failed to decode base64url payload."],
        verifiedAt: now.toISOString(),
      };
    }
  } else if (tokenString.trim().startsWith("{")) {
    rawJson = tokenString;
  } else {
    return {
      valid: false,
      errors: ["Unknown token format. Expected 'soroban-vp:v1:<base64url>' or JSON string."],
      verifiedAt: now.toISOString(),
    };
  }

  let claimToken: PresentationClaimToken;
  try {
    claimToken = JSON.parse(rawJson);
  } catch {
    return {
      valid: false,
      errors: ["Invalid JSON syntax in claim token payload."],
      verifiedAt: now.toISOString(),
    };
  }

  // Validate protocol & version
  if (claimToken.protocol !== "soroban-did-vp") {
    errors.push(`Unsupported protocol: ${claimToken.protocol}`);
  }

  // Validate Subject DID
  if (!claimToken.subjectDid || !claimToken.subjectDid.startsWith("did:")) {
    errors.push("Invalid or missing subject DID. Must follow 'did:<method>:...' standard.");
  }

  // Validate Issuer DID
  if (!claimToken.issuerDid || !claimToken.issuerDid.startsWith("did:")) {
    errors.push("Invalid or missing issuer DID.");
  }

  // Validate validity timestamps
  if (claimToken.validUntil) {
    const expiry = new Date(claimToken.validUntil);
    if (!isNaN(expiry.getTime()) && expiry.getTime() < now.getTime()) {
      errors.push(`Credential presentation has expired on ${claimToken.validUntil}`);
    }
  }

  if (claimToken.validFrom) {
    const issuance = new Date(claimToken.validFrom);
    // Allow up to 120s of clock drift
    if (!isNaN(issuance.getTime()) && issuance.getTime() > now.getTime() + 120000) {
      errors.push(`Credential issuance timestamp is set in the future (${claimToken.validFrom})`);
    }
  }

  // Validate status
  if (claimToken.status === "Revoked") {
    errors.push("Credential has been revoked by issuer.");
  }

  // Extract nested presentation if available
  let presentation: VerifiablePresentation | undefined;
  if (claimToken.rawVpPayload) {
    try {
      presentation = JSON.parse(claimToken.rawVpPayload);
    } catch {
      // Non-fatal, presentation remains undefined
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    claimToken,
    presentation,
    verifiedAt: now.toISOString(),
  };
}

/**
 * Realistic default sample credentials for Soroban developers and ecosystem actors.
 */
export const SAMPLE_CREDENTIALS: VerifiableCredential[] = [
  {
    "@context": [
      "https://www.w3.org/2018/credentials/v1",
      "https://stellar.org/soroban/did/v1",
    ],
    id: "urn:uuid:cred-soroban-lead-architect-01",
    type: ["VerifiableCredential", "SorobanDeveloperCredential"],
    title: "Lead Soroban Smart Contract Architect",
    description: "Certified protocol architect with verified contract audits on Stellar Soroban.",
    issuer: {
      id: "did:soroban:CCJDEVBHOOD7X6H6R47B5Z6T2K9QW:STELLAR_GOVERNANCE_COUNCIL",
      name: "Stellar Developer Foundation Governance",
      stellarAddress: "GABFQIK63R2NETJM7T673EAMZN4RJLLGP3OFUEJU5SZVTGWUKULZJNL6",
      contractId: "CCJDEVBHOOD7X6H6R47B5Z6T2K9QW3F6V4Y5N7K8M9P1",
      network: "testnet",
    },
    issuanceDate: "2026-01-15T12:00:00Z",
    expirationDate: "2027-01-15T12:00:00Z",
    credentialSubject: {
      id: "did:soroban:CDLZFC3SYJYDZT7K67VZ45IVHP2X4:GABFQIK63R2NETJM7T673E",
      name: "Anas Al Shlah",
      role: "Frontend & Web3 Lead Architect",
      reputation: 98,
      tier: "Diamond Tier",
      organization: "Stellar Soroban Dev Hub",
      stellarAddress: "GABFQIK63R2NETJM7T673EAMZN4RJLLGP3OFUEJU5SZVTGWUKULZJNL6",
      claims: {
        verifiedSmartContracts: 42,
        auditsPassed: 15,
        securityRating: "A+",
        offlineFirstCertified: true,
      },
    },
    proof: {
      type: "SorobanSmartContractAttestation2026",
      created: "2026-01-15T12:00:00Z",
      verificationMethod: "did:soroban:CCJDEVBHOOD7X6H6R47B5Z6T2K9QW:STELLAR_GOVERNANCE_COUNCIL#key-1",
      proofPurpose: "assertionMethod",
      proofValue: "ed25519_sig_9f83a04b12c8e439d0fa73b98c41e8201fa95bc4390e189d97a6e138bb8c983a",
      contractAttestationHash: "0x8fa910cb33418e7bcde51109a4736f98234ea789dc129845ef130283ab74619d",
    },
    status: "Active",
    metadataHash: "sha256:d8a2307ef69103cba519409831aef710a34b2201948dcaef",
  },
  {
    "@context": [
      "https://www.w3.org/2018/credentials/v1",
      "https://stellar.org/soroban/did/v1",
    ],
    id: "urn:uuid:cred-stellar-validator-02",
    type: ["VerifiableCredential", "StellarValidatorCredential"],
    title: "Stellar Tier-1 Consensus Validator",
    description: "Operates an active Stellar Core Tier-1 validator node with 99.99% uptime.",
    issuer: {
      id: "did:soroban:CVLDTR8829NMA48B2Z5V6K1QW:STELLAR_VALIDATOR_REGISTRY",
      name: "Stellar Validator Registry",
      stellarAddress: "GCKF7J3KQL5XN8Z2V4W9M1P3Q5T7R9B2D4F6H8J1L3N5",
      contractId: "CVLDTR8829NMA48B2Z5V6K1QW98103A4B8F910E1234",
      network: "testnet",
    },
    issuanceDate: "2026-02-01T08:00:00Z",
    expirationDate: "2027-02-01T08:00:00Z",
    credentialSubject: {
      id: "did:soroban:CVLDTR8829NMA48B2Z5V6K1QW:GCKF7J3KQL5XN8Z",
      name: "Nexus Stellar Validator Node #04",
      role: "Tier-1 Quorum Validator",
      reputation: 99,
      tier: "Platinum",
      organization: "Nexus Infrastructure",
      stellarAddress: "GCKF7J3KQL5XN8Z2V4W9M1P3Q5T7R9B2D4F6H8J1L3N5",
      claims: {
        uptimePercent: 99.99,
        ledgerCloseLatencyMs: 412,
        historyArchiveVerified: true,
      },
    },
    proof: {
      type: "SorobanSmartContractAttestation2026",
      created: "2026-02-01T08:00:00Z",
      verificationMethod: "did:soroban:CVLDTR8829NMA48B2Z5V6K1QW:STELLAR_VALIDATOR_REGISTRY#key-1",
      proofPurpose: "assertionMethod",
      proofValue: "ed25519_sig_3b8a91c47f02d948ba9e173059ca22384918ef93021948bac7e103984afcb819",
      contractAttestationHash: "0x3b8a91c47f02d948ba9e173059ca22384918ef93021948bac7e103984afcb819",
    },
    status: "Active",
  },
  {
    "@context": [
      "https://www.w3.org/2018/credentials/v1",
      "https://stellar.org/soroban/did/v1",
    ],
    id: "urn:uuid:cred-kyc-verified-03",
    type: ["VerifiableCredential", "KycAttestationCredential"],
    title: "Stellar Institutional KYC Level-2",
    description: "Identity verified against international AML/PEP sanction lists with zero-knowledge zk-proof.",
    issuer: {
      id: "did:soroban:CKYC99023418MNBVCXZPOIUYTREWQ:STELLAR_KYC_ANCHOR",
      name: "Stellar KYC Anchor & Compliance Hub",
      stellarAddress: "GBKYC991823746501928374650192837465019283746",
      contractId: "CKYC99023418MNBVCXZPOIUYTREWQ19283746501928",
      network: "testnet",
    },
    issuanceDate: "2026-03-10T15:30:00Z",
    expirationDate: "2027-03-10T15:30:00Z",
    credentialSubject: {
      id: "did:soroban:CKYC99023418MNBVCXZPOIUYTREWQ:GABFQIK63R2NETJM7T673E",
      name: "Anas Al Shlah",
      role: "Verified Operator",
      reputation: 95,
      tier: "Level-2 Verified",
      organization: "Global Compliance Consortium",
      stellarAddress: "GABFQIK63R2NETJM7T673EAMZN4RJLLGP3OFUEJU5SZVTGWUKULZJNL6",
      claims: {
        kycLevel: 2,
        sanctionsScreening: "Passed",
        jurisdiction: "Worldwide / Remote",
      },
    },
    proof: {
      type: "SorobanSmartContractAttestation2026",
      created: "2026-03-10T15:30:00Z",
      verificationMethod: "did:soroban:CKYC99023418MNBVCXZPOIUYTREWQ:STELLAR_KYC_ANCHOR#key-1",
      proofPurpose: "assertionMethod",
      proofValue: "ed25519_sig_5511883399002244aabbccddeeff11223344556677889900aabbccddeeff1122",
      contractAttestationHash: "0x5511883399002244aabbccddeeff11223344556677889900aabbccddeeff1122",
    },
    status: "Active",
  },
];
