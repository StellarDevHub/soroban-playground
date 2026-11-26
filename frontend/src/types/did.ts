// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * @file did.ts
 * W3C Verifiable Credentials / Presentation types and supporting structures
 * for the DID Credential Card Designer (issue #2062).
 *
 * Spec references:
 *  - W3C VC Data Model 2.0  https://www.w3.org/TR/vc-data-model-2.0/
 *  - W3C VC Presentation Exchange https://identity.foundation/presentation-exchange/
 *  - OpenID4VP / VCDM QR envelope  https://openid.net/specs/openid-4-verifiable-presentations-1_0.html
 */

// ---------------------------------------------------------------------------
// W3C Verifiable Credential
// ---------------------------------------------------------------------------

/** Core subject claims carried inside a credential. */
export interface CredentialSubject {
  /** DID of the holder: `did:stellar:<publicKey>` */
  id: string;
  [claim: string]: unknown;
}

/** Cryptographic proof attached to a VC or VP. */
export interface CredentialProof {
  type: string;
  created: string;        // ISO-8601
  verificationMethod: string;
  proofPurpose: string;
  proofValue: string;     // base64url-encoded signature or ZK proof
}

/** W3C Verifiable Credential (DM 2.0 shape). */
export interface VerifiableCredential {
  "@context": string[];
  id: string;             // URI, e.g. `did:stellar:<issuer>#vc-<uuid>`
  type: string[];         // must include "VerifiableCredential"
  issuer: string | { id: string; name?: string };
  validFrom: string;      // ISO-8601 (replaces `issuanceDate` in DM 2.0)
  validUntil?: string;    // ISO-8601 (replaces `expirationDate`)
  credentialSubject: CredentialSubject;
  proof?: CredentialProof;
}

// ---------------------------------------------------------------------------
// W3C Verifiable Presentation
// ---------------------------------------------------------------------------

/** W3C Verifiable Presentation wrapping one or more VCs. */
export interface VerifiablePresentation {
  "@context": string[];
  id?: string;
  type: string[];         // must include "VerifiablePresentation"
  holder?: string;        // DID of the presenter
  verifiableCredential: VerifiableCredential[];
  proof?: CredentialProof;
}

// ---------------------------------------------------------------------------
// QR code payload (OpenID4VP / VP Token envelope)
// ---------------------------------------------------------------------------

/** Compact presentation request / response token encoded into the QR SVG. */
export interface VpQrPayload {
  /**
   * Token format: `VP_TOKEN/<base64url(JSON.stringify(VerifiablePresentation))>`
   * Follows the OpenID4VP VP Token response schema so any OIDC-based
   * mobile wallet (Bifrost, Trinsic, etc.) can parse it directly.
   */
  raw: string;

  /** Human-readable label shown below the QR code. */
  label: string;

  /** Presentation nonce for replay-protection (randomly generated per export). */
  nonce: string;

  /** Unix timestamp (seconds) when this QR token was generated. */
  issuedAt: number;

  /** Optional expiry in seconds from issuedAt (default 300 s = 5 min). */
  expiresIn?: number;
}

/** Result returned by the SVG QR generator. */
export interface QrCodeResult {
  /** Fully self-contained `<svg>` string — no external dependencies. */
  svg: string;
  /** The raw string that was encoded. */
  encoded: string;
  /** Width & height in px (the SVG `viewBox` size). */
  size: number;
}

// ---------------------------------------------------------------------------
// Credential card design / theming
// ---------------------------------------------------------------------------

export type CardColorScheme =
  | "stellar-dark"   // deep navy + teal accent (default)
  | "midnight-purple"
  | "emerald"
  | "gold"
  | "mono-light";

/** Visual customisation options for DidCredentialCard. */
export interface CardTheme {
  colorScheme: CardColorScheme;
  /** Override the accent hex color for the top gradient bar. */
  accentColor?: string;
  /** Show or hide the holder avatar / icon. */
  showAvatar: boolean;
  /** Show or hide the issuer logo placeholder. */
  showIssuerLogo: boolean;
  /** Show or hide the QR code panel. */
  showQr: boolean;
  /** QR code foreground color (CSS color string). */
  qrColor?: string;
}

/** Everything needed to render one credential card. */
export interface CredentialCardData {
  credential: VerifiableCredential;
  theme: CardTheme;
  /** Pre-generated QR result (generated lazily by the card component). */
  qr?: QrCodeResult;
}

// ---------------------------------------------------------------------------
// Wallet pass exports
// ---------------------------------------------------------------------------

/**
 * Minimal JSON representation of an Apple Wallet Generic Pass.
 * Full spec: https://developer.apple.com/documentation/walletpasses
 * This is the `pass.json` content; the caller wraps it into a .pkpass bundle.
 */
export interface AppleWalletPassJson {
  formatVersion: 1;
  passTypeIdentifier: string;   // e.g. "pass.com.stellardevhub.did"
  serialNumber: string;
  teamIdentifier: string;       // placeholder "STELLARDEVHUB"
  organizationName: string;
  description: string;
  logoText: string;
  foregroundColor: string;      // CSS rgb()
  backgroundColor: string;
  labelColor: string;
  generic: {
    primaryFields: WalletField[];
    secondaryFields: WalletField[];
    auxiliaryFields: WalletField[];
    backFields: WalletField[];
  };
  barcodes: WalletBarcode[];
  expirationDate?: string;      // ISO-8601
  voided?: boolean;
}

export interface WalletField {
  key: string;
  label: string;
  value: string;
  textAlignment?: "PKTextAlignmentLeft" | "PKTextAlignmentCenter" | "PKTextAlignmentRight";
  dateStyle?: "PKDateStyleShort" | "PKDateStyleMedium" | "PKDateStyleLong";
}

export interface WalletBarcode {
  message: string;
  format: "PKBarcodeFormatQR";
  messageEncoding: "iso-8859-1";
  altText?: string;
}

/**
 * Google Wallet Generic Pass payload (JWT claims).
 * Full spec: https://developers.google.com/wallet/generic/rest/v1/genericobject
 */
export interface GoogleWalletPassPayload {
  iss: string;         // issuer (service account email placeholder)
  aud: string;         // "google"
  typ: string;         // "savetowallet"
  iat: number;
  payload: {
    genericObjects: GoogleGenericObject[];
  };
}

export interface GoogleGenericObject {
  id: string;          // "<issuerId>.<objectSuffix>"
  classId: string;
  genericType: "GENERIC_TYPE_UNSPECIFIED";
  hexBackgroundColor: string;
  logo: { sourceUri: { uri: string } };
  cardTitle: { defaultValue: { language: string; value: string } };
  subheader: { defaultValue: { language: string; value: string } };
  header: { defaultValue: { language: string; value: string } };
  textModulesData: GoogleTextField[];
  barcode: { type: "QR_CODE"; value: string; alternateText?: string };
  validTimeInterval?: { start: { date: string }; end?: { date: string } };
  state: "ACTIVE" | "INACTIVE" | "EXPIRED";
}

export interface GoogleTextField {
  id: string;
  header: string;
  body: string;
}
