// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * @file DidCredentialCard.node.test.ts
 * Node-based unit test suite for DID Credential Cards, ISO/IEC 18004 SVG QR generator,
 * W3C Verifiable Presentation claim tokens, and mobile wallet pass serializers.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  generateQrMatrix,
  generateQrSvg,
  QrMatrix,
} from "../../lib/did/qrCodeGenerator.ts";
import {
  base64UrlEncode,
  base64UrlDecode,
  createVerifiablePresentation,
  encodePresentationClaimToken,
  verifyPresentationClaimToken,
  SAMPLE_CREDENTIALS,
} from "../../lib/did/claimToken.ts";
import {
  buildAppleWalletPass,
  buildGoogleWalletPass,
} from "../../lib/did/passExporter.ts";
import type { VerifiableCredential } from "../../types/did.ts";

test("base64UrlEncode and base64UrlDecode handle roundtrip payloads accurately", () => {
  const sample = "did:soroban:CDLZFC3SYJYDZT7K67VZ45IVHP2X4:TESTNET_USER_99";
  const encoded = base64UrlEncode(sample);
  assert.ok(!encoded.includes("+"), "Must not include '+'");
  assert.ok(!encoded.includes("/"), "Must not include '/'");
  assert.ok(!encoded.includes("="), "Must not include padding '='");

  const decoded = base64UrlDecode(encoded);
  assert.equal(decoded, sample);
});

test("generateQrMatrix generates correct matrix dimensions for Version 1 through 10", () => {
  const shortText = "HELLO";
  const matrixV1 = generateQrMatrix(shortText, "L");
  assert.ok(matrixV1 instanceof QrMatrix);
  // Dimension formula: 17 + 4 * version
  assert.equal(matrixV1.size, 17 + 4 * matrixV1.version);
  assert.ok(matrixV1.version >= 1);

  // Longer payload requires higher version
  const longPayload = "soroban-vp:v1:" + "a".repeat(250);
  const matrixHigher = generateQrMatrix(longPayload, "M");
  assert.ok(matrixHigher.version > 1, "Long payload must scale to higher QR version");
  assert.equal(matrixHigher.size, 17 + 4 * matrixHigher.version);
});

test("generateQrMatrix correctly places Finder Patterns at top-left, top-right, and bottom-left", () => {
  const matrix = generateQrMatrix("STELLAR_SOROBAN_DID", "M");
  const size = matrix.size;

  // Verify top-left finder center (3, 3) is dark
  assert.equal(matrix.get(3, 3), true, "Top-left finder center must be dark");
  // Outer border module (0, 0) is dark
  assert.equal(matrix.get(0, 0), true, "Top-left outer corner must be dark");
  // Inner ring module (1, 1) is light
  assert.equal(matrix.get(1, 1), false, "Top-left separator module must be light");

  // Verify top-right finder center (3, size - 4) is dark
  assert.equal(matrix.get(3, size - 4), true, "Top-right finder center must be dark");
  // Verify bottom-left finder center (size - 4, 3) is dark
  assert.equal(matrix.get(size - 4, 3), true, "Bottom-left finder center must be dark");
});

test("generateQrMatrix correctly places Timing Patterns along row 6 and col 6", () => {
  const matrix = generateQrMatrix("SOROBAN_TIMING_TEST", "M");
  // Timing patterns alternate dark and light modules
  for (let c = 8; c < matrix.size - 8; c++) {
    const expected = c % 2 === 0;
    assert.equal(
      matrix.get(6, c),
      expected,
      `Timing pattern row 6, col ${c} must match expected parity`,
    );
  }
});

test("generateQrSvg outputs valid standalone SVG markup with custom colors and viewBox", () => {
  const payload = "soroban-vp:v1:test_token_12345";
  const svg = generateQrSvg(payload, {
    size: 300,
    margin: 3,
    fgColor: "#38bdf8",
    bgColor: "#0f172a",
    title: "Soroban Claim QR",
  });

  assert.ok(svg.startsWith("<svg"), "Must start with <svg tag");
  assert.ok(svg.endsWith("</svg>"), "Must terminate with </svg>");
  assert.ok(svg.includes('width="300"'), "Must include width 300");
  assert.ok(svg.includes('height="300"'), "Must include height 300");
  assert.ok(svg.includes('fill="#38bdf8"'), "Must apply foreground color");
  assert.ok(svg.includes('fill="#0f172a"'), "Must apply background color");
  assert.ok(svg.includes("<title>Soroban Claim QR</title>"), "Must include accessible title");
  assert.ok(svg.includes("<path d="), "Must contain module vector path data");
});

test("createVerifiablePresentation constructs W3C-compliant presentation object", () => {
  const sampleCred = SAMPLE_CREDENTIALS[0];
  const vp = createVerifiablePresentation(sampleCred, {
    challenge: "verifier-challenge-xyz",
    nonce: "nonce-123456",
  });

  assert.ok(vp["@context"].includes("https://www.w3.org/2018/credentials/v1"));
  assert.ok(vp.type.includes("VerifiablePresentation"));
  assert.equal(vp.holder, sampleCred.credentialSubject.id);
  assert.equal(vp.challenge, "verifier-challenge-xyz");
  assert.equal(vp.nonce, "nonce-123456");
  assert.equal(vp.verifiableCredential.length, 1);
  assert.equal(vp.verifiableCredential[0].id, sampleCred.id);
  assert.ok(vp.proof?.proofValue, "Proof value must be present");
});

test("encodePresentationClaimToken and verifyPresentationClaimToken validate active credentials", () => {
  const sampleCred = SAMPLE_CREDENTIALS[0];
  const vp = createVerifiablePresentation(sampleCred);
  const token = encodePresentationClaimToken(vp);

  assert.ok(token.startsWith("soroban-vp:v1:"), "Token must use 'soroban-vp:v1:' prefix");

  const result = verifyPresentationClaimToken(token);
  assert.equal(result.valid, true, "Active sample token must verify successfully");
  assert.equal(result.errors.length, 0);
  assert.equal(result.claimToken?.subjectDid, sampleCred.credentialSubject.id);
  assert.equal(result.claimToken?.issuerDid, sampleCred.issuer.id);
  assert.equal(result.claimToken?.credentialTitle, sampleCred.title);
  assert.equal(result.claimToken?.claims.name, sampleCred.credentialSubject.name);
  assert.equal(result.claimToken?.status, "Active");
});

test("verifyPresentationClaimToken flags expired credentials with clear error reason", () => {
  const expiredCred: VerifiableCredential = {
    ...SAMPLE_CREDENTIALS[0],
    id: "urn:uuid:expired-cred-001",
    issuanceDate: "2020-01-01T00:00:00Z",
    expirationDate: "2021-01-01T00:00:00Z",
  };

  const vp = createVerifiablePresentation(expiredCred);
  const token = encodePresentationClaimToken(vp);
  const result = verifyPresentationClaimToken(token);

  assert.equal(result.valid, false, "Expired credential must fail validation");
  assert.ok(
    result.errors.some((err) => err.toLowerCase().includes("expired")),
    "Errors must mention expired credential",
  );
});

test("verifyPresentationClaimToken flags revoked credentials", () => {
  const revokedCred: VerifiableCredential = {
    ...SAMPLE_CREDENTIALS[0],
    id: "urn:uuid:revoked-cred-002",
    status: "Revoked",
  };

  const vp = createVerifiablePresentation(revokedCred);
  const token = encodePresentationClaimToken(vp);
  const result = verifyPresentationClaimToken(token);

  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((err) => err.toLowerCase().includes("revoked")),
    "Errors must mention revocation",
  );
});

test("verifyPresentationClaimToken fails closed on malformed or corrupted tokens", () => {
  // Completely invalid string
  const invalidRes1 = verifyPresentationClaimToken("invalid-token-string");
  assert.equal(invalidRes1.valid, false);

  // Corrupted base64 payload
  const invalidRes2 = verifyPresentationClaimToken("soroban-vp:v1:not-valid-base64!!!");
  assert.equal(invalidRes2.valid, false);

  // Empty string
  const invalidRes3 = verifyPresentationClaimToken("");
  assert.equal(invalidRes3.valid, false);
});

test("buildAppleWalletPass produces compliant PKPass pass.json payload", () => {
  const sampleCred = SAMPLE_CREDENTIALS[0];
  const vp = createVerifiablePresentation(sampleCred);
  const token = encodePresentationClaimToken(vp);

  const pass = buildAppleWalletPass(sampleCred, token);
  assert.equal(pass.formatVersion, 1);
  assert.equal(pass.passTypeIdentifier, "pass.org.stellar.soroban.credential");
  assert.equal(pass.organizationName, sampleCred.issuer.name);
  assert.equal(pass.description, sampleCred.title);
  assert.equal(pass.barcode.format, "PKBarcodeFormatQR");
  assert.equal(pass.barcode.message, token);
  assert.ok(pass.generic.primaryFields.length > 0);
  assert.equal(pass.generic.primaryFields[0].value, sampleCred.title);
  assert.ok(pass.generic.backFields.some((f) => f.key === "subjectDid"));
});

test("buildGoogleWalletPass produces compliant Google Pay Generic Pass structure", () => {
  const sampleCred = SAMPLE_CREDENTIALS[0];
  const vp = createVerifiablePresentation(sampleCred);
  const token = encodePresentationClaimToken(vp);

  const pass = buildGoogleWalletPass(sampleCred, token);
  assert.ok(pass.id.startsWith("soroban_pass_"));
  assert.equal(pass.classId, "stellar_soroban_developer_credentials");
  assert.equal(pass.genericObject.header.defaultValue.value, sampleCred.title);
  assert.equal(pass.genericObject.barcode.type, "QR_CODE");
  assert.equal(pass.genericObject.barcode.value, token);
  assert.ok(
    pass.genericObject.textModulesData.some((m) => m.id === "subject_did"),
    "Google pass must include subject_did text module",
  );
});
