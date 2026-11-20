// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * @file passExporter.ts
 * Multi-format export utilities for W3C Verifiable Credentials and Presentation Claim Tokens:
 * - W3C JSON-LD (.jsonld)
 * - Apple Wallet Pass (.pkpass pass.json)
 * - Google Wallet Pass (Generic Class/Object JSON)
 * - Vector SVG (.svg)
 * - High-res PNG via Canvas (.png)
 */

import type {
  VerifiableCredential,
  VerifiablePresentation,
  AppleWalletPass,
  GoogleWalletPass,
  CardCustomization,
} from "../../types/did";
import { generateQrSvg } from "./qrCodeGenerator.ts";
import { encodePresentationClaimToken, createVerifiablePresentation } from "./claimToken.ts";

/**
 * Generates an Apple Wallet Pass structure (pass.json) according to Apple PKPass specifications.
 */
export function buildAppleWalletPass(
  credential: VerifiableCredential,
  presentationToken: string,
  _customization?: Partial<CardCustomization>,
): AppleWalletPass {
  return {
    formatVersion: 1,
    passTypeIdentifier: "pass.org.stellar.soroban.credential",
    serialNumber: credential.id.replace(/[^a-zA-Z0-9_-]/g, "_"),
    teamIdentifier: "STELLARDEV1",
    organizationName: credential.issuer.name,
    description: credential.title,
    foregroundColor: "rgb(255, 255, 255)",
    backgroundColor: "rgb(15, 23, 42)", // Slate-900
    labelColor: "rgb(56, 189, 248)", // Sky-400
    generic: {
      primaryFields: [
        {
          key: "title",
          label: "CREDENTIAL",
          value: credential.title,
        },
      ],
      secondaryFields: [
        {
          key: "holder",
          label: "HOLDER",
          value: credential.credentialSubject.name ?? credential.credentialSubject.id.substring(0, 24) + "…",
        },
        {
          key: "role",
          label: "ROLE",
          value: credential.credentialSubject.role ?? "Verified Holder",
        },
      ],
      auxiliaryFields: [
        {
          key: "issuer",
          label: "ISSUER",
          value: credential.issuer.name,
        },
        {
          key: "validUntil",
          label: "EXPIRES",
          value: credential.expirationDate
            ? new Date(credential.expirationDate).toLocaleDateString()
            : "Never",
        },
        {
          key: "reputation",
          label: "REPUTATION",
          value: `${credential.credentialSubject.reputation ?? 100} / 100`,
        },
      ],
      backFields: [
        {
          key: "subjectDid",
          label: "SUBJECT DID",
          value: credential.credentialSubject.id,
        },
        {
          key: "issuerDid",
          label: "ISSUER DID",
          value: credential.issuer.id,
        },
        {
          key: "attestationProof",
          label: "CONTRACT PROOF HASH",
          value: credential.proof.contractAttestationHash ?? credential.proof.proofValue,
        },
        {
          key: "stellarAddress",
          label: "STELLAR WALLET",
          value: credential.credentialSubject.stellarAddress ?? "N/A",
        },
      ],
    },
    barcode: {
      format: "PKBarcodeFormatQR",
      message: presentationToken,
      messageEncoding: "utf-8",
      altText: "Scan to verify Soroban Credential",
    },
  };
}

/**
 * Generates a Google Wallet Generic Pass JSON structure.
 */
export function buildGoogleWalletPass(
  credential: VerifiableCredential,
  presentationToken: string,
): GoogleWalletPass {
  return {
    id: `soroban_pass_${credential.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
    classId: "stellar_soroban_developer_credentials",
    genericObject: {
      cardTitle: { defaultValue: { language: "en", value: credential.issuer.name } },
      header: { defaultValue: { language: "en", value: credential.title } },
      subheader: {
        defaultValue: {
          language: "en",
          value: credential.credentialSubject.name ?? "Verified Subject",
        },
      },
      textModulesData: [
        {
          id: "role_info",
          header: "ROLE / TIER",
          body: `${credential.credentialSubject.role ?? "Holder"} (${credential.credentialSubject.tier ?? "Standard"})`,
        },
        {
          id: "subject_did",
          header: "DECENTRALIZED IDENTIFIER (DID)",
          body: credential.credentialSubject.id,
        },
        {
          id: "attestation",
          header: "SOROBAN CONTRACT PROOF",
          body: credential.proof.contractAttestationHash ?? credential.proof.proofValue,
        },
      ],
      barcode: {
        type: "QR_CODE",
        value: presentationToken,
        alternateText: "Scan to verify claim on Stellar Soroban",
      },
    },
  };
}

/**
 * Helper to trigger a browser file download.
 */
export function triggerDownload(content: string, filename: string, mimeType: string): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/**
 * Exports W3C Credential as a standardized JSON-LD file.
 */
export function exportCredentialJsonLd(credential: VerifiableCredential): void {
  const jsonString = JSON.stringify(credential, null, 2);
  const cleanTitle = credential.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  triggerDownload(jsonString, `soroban-credential-${cleanTitle}.jsonld`, "application/ld+json");
}

/**
 * Exports Apple Wallet Pass JSON file.
 */
export function exportAppleWalletPassFile(
  credential: VerifiableCredential,
  presentationToken: string,
): void {
  const pass = buildAppleWalletPass(credential, presentationToken);
  const jsonString = JSON.stringify(pass, null, 2);
  const cleanTitle = credential.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  triggerDownload(jsonString, `apple-wallet-pass-${cleanTitle}.json`, "application/json");
}

/**
 * Exports Google Wallet Pass JSON file.
 */
export function exportGoogleWalletPassFile(
  credential: VerifiableCredential,
  presentationToken: string,
): void {
  const pass = buildGoogleWalletPass(credential, presentationToken);
  const jsonString = JSON.stringify(pass, null, 2);
  const cleanTitle = credential.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  triggerDownload(jsonString, `google-wallet-pass-${cleanTitle}.json`, "application/json");
}

/**
 * Exports QR Code as pure SVG file.
 */
export function exportQrSvgFile(
  token: string,
  credentialTitle: string,
  customization?: Partial<CardCustomization>,
): void {
  const svgContent = generateQrSvg(token, {
    size: 512,
    margin: 4,
    ecLevel: customization?.qrErrorCorrection ?? "M",
    fgColor: customization?.accentColor ?? "#38bdf8",
    title: `${credentialTitle} - Verifiable Claim QR`,
  });
  const cleanTitle = credentialTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  triggerDownload(svgContent, `qr-${cleanTitle}.svg`, "image/svg+xml");
}

/**
 * Exports card or QR code to PNG via HTML Canvas.
 */
export function exportQrToPngFile(
  token: string,
  credentialTitle: string,
  customization?: Partial<CardCustomization>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      resolve();
      return;
    }

    const svgString = generateQrSvg(token, {
      size: 1024,
      margin: 4,
      ecLevel: customization?.qrErrorCorrection ?? "M",
      fgColor: customization?.accentColor ?? "#38bdf8",
      bgColor: "#0f172a",
      title: `${credentialTitle} - Verifiable Claim QR`,
    });

    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      reject(new Error("Canvas 2D context not available"));
      return;
    }

    const img = new Image();
    const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);

    img.onload = () => {
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("Failed to render canvas to blob"));
          return;
        }
        const pngUrl = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        const cleanTitle = credentialTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        anchor.href = pngUrl;
        anchor.download = `qr-${cleanTitle}.png`;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(pngUrl);
        resolve();
      }, "image/png");
    };

    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };

    img.src = url;
  });
}
