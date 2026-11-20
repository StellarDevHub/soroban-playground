// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * @file did.ts
 * W3C Verifiable Credentials and Decentralized Identity (DID) type definitions
 * for Stellar Soroban Playground.
 */

export interface CredentialSubject {
  id: string; // e.g. "did:soroban:CDLZ...:GABF..."
  name?: string;
  role?: string;
  reputation?: number;
  tier?: string;
  organization?: string;
  stellarAddress?: string;
  claims?: Record<string, string | number | boolean>;
}

export interface IssuerAttestation {
  id: string; // DID of issuer, e.g. "did:soroban:CDLZ...:GOVERNANCE_REGISTRY"
  name: string;
  stellarAddress?: string;
  contractId?: string;
  network?: "mainnet" | "testnet" | "futurenet" | "standalone";
}

export interface CredentialProof {
  type: "Ed25519Signature2020" | "SorobanSmartContractAttestation2026" | "JsonWebSignature2020";
  created: string;
  verificationMethod: string;
  proofPurpose: "assertionMethod" | "authentication";
  proofValue: string;
  contractAttestationHash?: string;
}

export interface VerifiableCredential {
  "@context": string[];
  id: string;
  type: string[];
  title: string;
  description?: string;
  issuer: IssuerAttestation;
  issuanceDate: string; // ISO 8601
  expirationDate?: string; // ISO 8601
  credentialSubject: CredentialSubject;
  proof: CredentialProof;
  status: "Active" | "Revoked" | "Suspended";
  metadataHash?: string;
}

export interface VerifiablePresentation {
  "@context": string[];
  type: string[];
  id: string;
  verifiableCredential: VerifiableCredential[];
  holder: string; // DID
  presentationSubmission?: {
    descriptor_map: Array<{
      id: string;
      format: string;
      path: string;
    }>;
  };
  proof?: CredentialProof;
  challenge?: string;
  nonce?: string;
  issuedAt: string;
  expiresAt: string;
}

export interface PresentationClaimToken {
  version: "1.0.0";
  protocol: "soroban-did-vp";
  presentationId: string;
  subjectDid: string;
  issuerDid: string;
  credentialTitle: string;
  claims: Record<string, unknown>;
  attestationHash: string;
  validFrom: string;
  validUntil: string;
  status: "Active" | "Expired" | "Revoked";
  rawVpPayload: string; // serialized JSON
}

export type CardThemePreset =
  | "stellar-cyan"
  | "soroban-purple"
  | "aurora-emerald"
  | "cyber-amber"
  | "midnight-obsidian";

export interface CardCustomization {
  theme: CardThemePreset;
  showQrCode: boolean;
  showIssuerAttestation: boolean;
  showValidityTimestamps: boolean;
  showSubjectDid: boolean;
  showHologram: boolean;
  showChip: boolean;
  qrSize: number;
  qrErrorCorrection: "L" | "M" | "Q" | "H";
  accentColor?: string;
}

export interface AppleWalletPass {
  formatVersion: 1;
  passTypeIdentifier: string;
  serialNumber: string;
  teamIdentifier: string;
  organizationName: string;
  description: string;
  foregroundColor: string;
  backgroundColor: string;
  labelColor: string;
  generic: {
    primaryFields: Array<{ key: string; label: string; value: string }>;
    secondaryFields: Array<{ key: string; label: string; value: string }>;
    auxiliaryFields: Array<{ key: string; label: string; value: string }>;
    backFields: Array<{ key: string; label: string; value: string }>;
  };
  barcode: {
    format: "PKBarcodeFormatQR";
    message: string;
    messageEncoding: "iso-8859-1" | "utf-8";
    altText?: string;
  };
}

export interface GoogleWalletPass {
  id: string;
  classId: string;
  genericObject: {
    header: { defaultValue: { language: "en"; value: string } };
    subheader?: { defaultValue: { language: "en"; value: string } };
    cardTitle: { defaultValue: { language: "en"; value: string } };
    textModulesData: Array<{ id: string; header: string; body: string }>;
    barcode: {
      type: "QR_CODE";
      value: string;
      alternateText?: string;
    };
  };
}
