// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * @file walletPass.ts
 * Exporters for Apple Wallet (.pkpass pass.json skeleton) and
 * Google Wallet (unsigned JWT save-to-wallet payload).
 *
 * Neither format requires a signing key to generate the downloadable JSON;
 * the caller is responsible for signing the Google JWT with their service-
 * account private key before redirecting to the save URL, and for signing +
 * zipping the .pkpass bundle with their Apple certificate.
 *
 * Both builders are pure functions — no I/O, no external dependencies.
 *
 * References:
 *  Apple Wallet Pass Design Guide
 *    https://developer.apple.com/documentation/walletpasses
 *  Google Wallet Generic Pass REST Reference
 *    https://developers.google.com/wallet/generic/rest/v1/genericobject
 */

import type {
  VerifiableCredential,
  AppleWalletPassJson,
  GoogleWalletPassPayload,
  WalletField,
  WalletBarcode,
  GoogleGenericObject,
  GoogleTextField,
} from "@/types/did";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Extract a plain-string issuer name from the VC issuer field. */
function issuerName(vc: VerifiableCredential): string {
  if (typeof vc.issuer === "string") return vc.issuer;
  return vc.issuer.name ?? vc.issuer.id;
}

/** Extract the holder DID from credentialSubject.id. */
function holderDid(vc: VerifiableCredential): string {
  return vc.credentialSubject.id ?? "did:stellar:unknown";
}

/** Shorten a DID for display: `did:stellar:GABC…XYZ`. */
function shortDid(did: string): string {
  if (did.length <= 24) return did;
  return did.slice(0, 20) + "…" + did.slice(-6);
}

/** Format an ISO-8601 string to a locale date string (YYYY-MM-DD fallback). */
function fmtDate(iso: string | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

/** Safe ISO-8601 format string, ensuring the `T…Z` portion is present. */
function toIso(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  // If already has time component, return as-is
  if (iso.includes("T")) return iso;
  return iso + "T00:00:00Z";
}

// ---------------------------------------------------------------------------
// Theme accent → wallet colors
// ---------------------------------------------------------------------------

export interface PassColorHints {
  /**
   * Background color for the pass face.
   * Accepts any CSS hex (#rrggbb) or rgb() string.
   * Defaults to the Stellar dark-blue brand color.
   */
  backgroundColor?: string;
  /** Foreground (text) color. Defaults to white. */
  foregroundColor?: string;
  /** Label color. Defaults to a mid-grey. */
  labelColor?: string;
}

/** Convert a hex color (#rrggbb) to `rgb(r, g, b)` as Apple Wallet expects. */
function hexToRgb(hex: string): string {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return hex; // already rgb() or other format
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

/** Canonical Google Wallet hex format requires the leading `#`. */
function toGoogleHex(color: string): string {
  if (color.startsWith("#")) return color;
  // Parse rgb(r,g,b) → #rrggbb
  const m = color.match(/rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\)/);
  if (m) {
    return (
      "#" +
      [m[1], m[2], m[3]]
        .map((n) => parseInt(n).toString(16).padStart(2, "0"))
        .join("")
    );
  }
  return color;
}

// ---------------------------------------------------------------------------
// Apple Wallet pass.json builder
// ---------------------------------------------------------------------------

/**
 * Build the `pass.json` content for a Generic Apple Wallet pass.
 *
 * The returned object must be serialised to JSON, bundled with the required
 * manifest.json and signature files, and zipped to produce a valid `.pkpass`.
 * This function only produces the data layer; signing requires an Apple
 * Developer certificate (not available in a browser context).
 *
 * @param vc          The Verifiable Credential to embed.
 * @param qrPayload   The VP_TOKEN string to encode as the pass barcode.
 * @param colors      Optional color hints derived from the card theme.
 */
export function buildAppleWalletPass(
  vc: VerifiableCredential,
  qrPayload: string,
  colors: PassColorHints = {}
): AppleWalletPassJson {
  const bg = hexToRgb(colors.backgroundColor ?? "#0f172a");
  const fg = hexToRgb(colors.foregroundColor ?? "#f8fafc");
  const label = hexToRgb(colors.labelColor ?? "#94a3b8");

  const credTypes = vc.type.filter((t) => t !== "VerifiableCredential");
  const credTypeLabel = credTypes.join(", ") || "Verifiable Credential";
  const issuer = issuerName(vc);
  const holder = shortDid(holderDid(vc));

  const primaryFields: WalletField[] = [
    {
      key: "credentialType",
      label: "CREDENTIAL",
      value: credTypeLabel,
      textAlignment: "PKTextAlignmentLeft",
    },
  ];

  const secondaryFields: WalletField[] = [
    {
      key: "issuer",
      label: "ISSUER",
      value: issuer,
    },
    {
      key: "holder",
      label: "HOLDER",
      value: holder,
    },
  ];

  const auxiliaryFields: WalletField[] = [
    {
      key: "validFrom",
      label: "VALID FROM",
      value: fmtDate(vc.validFrom),
    },
    ...(vc.validUntil
      ? [
          {
            key: "validUntil",
            label: "EXPIRES",
            value: fmtDate(vc.validUntil),
          } satisfies WalletField,
        ]
      : []),
  ];

  // Back of pass: full DID + credential ID for auditors
  const backFields: WalletField[] = [
    {
      key: "credentialId",
      label: "Credential ID",
      value: vc.id,
    },
    {
      key: "holderDid",
      label: "Holder DID",
      value: holderDid(vc),
    },
    {
      key: "proofType",
      label: "Proof Type",
      value: vc.proof?.type ?? "None",
    },
    {
      key: "proofValue",
      label: "Proof Value",
      value: vc.proof?.proofValue
        ? vc.proof.proofValue.slice(0, 48) + "…"
        : "Not signed",
    },
    {
      key: "context",
      label: "Context",
      value: vc["@context"].join(", "),
    },
  ];

  const barcodes: WalletBarcode[] = [
    {
      message: qrPayload,
      format: "PKBarcodeFormatQR",
      messageEncoding: "iso-8859-1",
      altText: `VP Token · ${credTypeLabel}`,
    },
  ];

  // Serial number: last 20 chars of the credential ID (URL-safe)
  const serial = vc.id.replace(/[^a-zA-Z0-9]/g, "").slice(-20) || "0000000000";

  return {
    formatVersion: 1,
    passTypeIdentifier: "pass.com.stellardevhub.did",
    serialNumber: serial,
    teamIdentifier: "STELLARDEVHUB",
    organizationName: issuer,
    description: `${credTypeLabel} issued by ${issuer}`,
    logoText: "StellarDevHub",
    foregroundColor: fg,
    backgroundColor: bg,
    labelColor: label,
    generic: {
      primaryFields,
      secondaryFields,
      auxiliaryFields,
      backFields,
    },
    barcodes,
    ...(vc.validUntil ? { expirationDate: toIso(vc.validUntil) } : {}),
    voided: false,
  };
}

/**
 * Trigger a browser download of the `pass.json` file.
 * The user still needs to zip + sign this to produce a real `.pkpass`.
 */
export function downloadApplePassJson(
  vc: VerifiableCredential,
  qrPayload: string,
  colors?: PassColorHints
): void {
  const pass = buildAppleWalletPass(vc, qrPayload, colors);
  const blob = new Blob([JSON.stringify(pass, null, 2)], {
    type: "application/json",
  });
  triggerDownload(blob, "pass.json");
}

// ---------------------------------------------------------------------------
// Google Wallet JWT payload builder
// ---------------------------------------------------------------------------

/**
 * Build an unsigned Google Wallet "Save to Wallet" JWT payload.
 *
 * The `payload` property contains the `genericObjects` array.
 * To generate a live save-to-wallet link the caller must:
 *  1. Sign this payload with a Google service-account RSA-SHA256 private key.
 *  2. Redirect the user to:
 *     `https://pay.google.com/gp/v/save/<signed_jwt>`
 *
 * @param vc          The Verifiable Credential to embed.
 * @param qrPayload   The VP_TOKEN string to encode as the pass barcode.
 * @param issuerId    Your Google Wallet issuer ID (defaults to placeholder).
 * @param colors      Optional color hints derived from the card theme.
 */
export function buildGoogleWalletPayload(
  vc: VerifiableCredential,
  qrPayload: string,
  issuerId = "3388000000022795555",
  colors: PassColorHints = {}
): GoogleWalletPassPayload {
  const issuer = issuerName(vc);
  const credTypes = vc.type.filter((t) => t !== "VerifiableCredential");
  const credTypeLabel = credTypes.join(" · ") || "Verifiable Credential";
  const holder = shortDid(holderDid(vc));

  const objectSuffix = vc.id
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(-40);
  const objectId = `${issuerId}.${objectSuffix}`;
  const classId = `${issuerId}.stellardevhub_did`;

  const bgHex = toGoogleHex(colors.backgroundColor ?? "#0f172a");

  const textModules: GoogleTextField[] = [
    { id: "holder",     header: "Holder",      body: holder },
    { id: "issuer",     header: "Issuer",       body: issuer },
    { id: "valid_from", header: "Valid From",   body: fmtDate(vc.validFrom) },
    ...(vc.validUntil
      ? [{ id: "valid_until", header: "Expires", body: fmtDate(vc.validUntil) }]
      : []),
    { id: "cred_id",    header: "Credential ID", body: vc.id },
    { id: "proof_type", header: "Proof Type",   body: vc.proof?.type ?? "None" },
  ];

  const now = Math.floor(Date.now() / 1000);

  const isExpired =
    vc.validUntil !== undefined && new Date(vc.validUntil) < new Date();

  const genericObject: GoogleGenericObject = {
    id: objectId,
    classId,
    genericType: "GENERIC_TYPE_UNSPECIFIED",
    hexBackgroundColor: bgHex,
    logo: {
      sourceUri: {
        // Placeholder logo URI — replace with a hosted PNG for production
        uri: "https://soroban-playground.onrender.com/static/logo.png",
      },
    },
    cardTitle: {
      defaultValue: { language: "en-US", value: "StellarDevHub DID" },
    },
    subheader: {
      defaultValue: { language: "en-US", value: issuer },
    },
    header: {
      defaultValue: { language: "en-US", value: credTypeLabel },
    },
    textModulesData: textModules,
    barcode: {
      type: "QR_CODE",
      value: qrPayload,
      alternateText: `VP Token · ${credTypeLabel}`,
    },
    ...(vc.validFrom || vc.validUntil
      ? {
          validTimeInterval: {
            start: { date: toIso(vc.validFrom) ?? new Date().toISOString() },
            ...(vc.validUntil
              ? { end: { date: toIso(vc.validUntil)! } }
              : {}),
          },
        }
      : {}),
    state: isExpired ? "EXPIRED" : "ACTIVE",
  };

  return {
    iss: "stellardevhub-did@soroban-playground.iam.gserviceaccount.com",
    aud: "google",
    typ: "savetowallet",
    iat: now,
    payload: {
      genericObjects: [genericObject],
    },
  };
}

/**
 * Build the unsigned JWT string (header.payload — no signature).
 * The caller appends `.signature` after signing with their private key.
 */
export function buildGoogleWalletJwtUnsigned(
  vc: VerifiableCredential,
  qrPayload: string,
  issuerId?: string,
  colors?: PassColorHints
): string {
  const header = { alg: "RS256", typ: "JWT" };
  const payload = buildGoogleWalletPayload(vc, qrPayload, issuerId, colors);
  const encHeader = base64UrlEncodeObj(header);
  const encPayload = base64UrlEncodeObj(payload);
  // Returns header.payload — caller must sign and append .signature
  return `${encHeader}.${encPayload}`;
}

/**
 * Trigger a browser download of the unsigned JWT payload JSON.
 * Useful for server-side signing workflows.
 */
export function downloadGoogleWalletPayload(
  vc: VerifiableCredential,
  qrPayload: string,
  issuerId?: string,
  colors?: PassColorHints
): void {
  const payload = buildGoogleWalletPayload(vc, qrPayload, issuerId, colors);
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  triggerDownload(blob, "google-wallet-payload.json");
}

// ---------------------------------------------------------------------------
// Shared download helper
// ---------------------------------------------------------------------------

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Minimal base64url encode for plain objects (no external lib)
// ---------------------------------------------------------------------------

function base64UrlEncodeObj(obj: unknown): string {
  const json = JSON.stringify(obj);
  let binary = "";
  const bytes =
    typeof TextEncoder !== "undefined"
      ? new TextEncoder().encode(json)
      : (() => {
          const buf = Buffer.from(json, "utf-8");
          return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        })();

  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  const b64 =
    typeof btoa !== "undefined"
      ? btoa(binary)
      : Buffer.from(binary, "binary").toString("base64");

  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
