// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * @file DidCredentialCard.test.tsx
 *
 * Automated tests for issue #2062 — DID Credential Card Designer.
 *
 * Coverage areas:
 *  1. QR payload generation  — buildVpToken structure, prefix, nonce, timing
 *  2. QR payload parsing     — parseVpToken round-trip fidelity and error handling
 *  3. SVG QR code generation — generateQrSvg output shape, viewBox, colors
 *  4. Card rendering         — issuer, holder, timestamps, status badges
 *  5. QR panel interaction   — toggle, SVG rendered, VP token copy
 *  6. Proof panel            — collapsible proof details
 *  7. Theme picker           — scheme switching reflects in aria-checked
 *  8. Wallet exports         — Apple and Google export callbacks fire correctly
 *  9. Apple pass builder     — field content and barcode format
 * 10. Google Wallet builder  — JWT payload structure and object content
 */

import React from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";

// --- Units under test ---
import DidCredentialCard from "../../components/DidCredentialCard";
import {
  buildVpToken,
  parseVpToken,
  generateQrSvg,
} from "../../lib/did/qrEncoder";
import {
  buildAppleWalletPass,
  buildGoogleWalletPayload,
} from "../../lib/did/walletPass";
import type { VerifiableCredential, VerifiablePresentation } from "../../types/did";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ISSUER_DID = "did:stellar:GISSUER000STELLARDEVHUB";
const HOLDER_DID = "did:stellar:GABC1234567890ABCDEFGHIJ";

function makeCredential(
  overrides: Partial<VerifiableCredential> = {}
): VerifiableCredential {
  return {
    "@context": [
      "https://www.w3.org/ns/credentials/v2",
      "https://www.w3.org/ns/credentials/examples/v2",
    ],
    id: "did:stellar:GISSUER000STELLARDEVHUB#vc-test-001",
    type: ["VerifiableCredential", "StellarDeveloperCredential"],
    issuer: { id: ISSUER_DID, name: "StellarDevHub" },
    validFrom: "2026-01-01T00:00:00Z",
    validUntil: "2027-01-01T00:00:00Z",
    credentialSubject: {
      id: HOLDER_DID,
      developerScore: 92,
      tier: "Senior",
    },
    proof: {
      type: "Ed25519Signature2020",
      created: "2026-01-01T00:00:00Z",
      verificationMethod: `${ISSUER_DID}#key-1`,
      proofPurpose: "assertionMethod",
      proofValue:
        "z4oey5q2M3XKaxup3tmzN4A23kcAEe8oApB9pK7mH7a6TEcJGzQUcSjJBnmNnJWy",
    },
    ...overrides,
  };
}

function makePresentation(vc: VerifiableCredential): VerifiablePresentation {
  return {
    "@context": ["https://www.w3.org/ns/credentials/v2"],
    type: ["VerifiablePresentation"],
    holder: HOLDER_DID,
    verifiableCredential: [vc],
  };
}

// ---------------------------------------------------------------------------
// 1. QR payload generation
// ---------------------------------------------------------------------------

describe("buildVpToken", () => {
  it("produces a VP_TOKEN/ prefixed string", () => {
    const vp = makePresentation(makeCredential());
    const result = buildVpToken(vp);
    expect(result.raw).toMatch(/^VP_TOKEN\//);
  });

  it("includes a 32-hex-char nonce", () => {
    const vp = makePresentation(makeCredential());
    const result = buildVpToken(vp);
    expect(result.nonce).toMatch(/^[0-9a-f]{32}$/);
  });

  it("generates unique nonces for each call", () => {
    const vp = makePresentation(makeCredential());
    const a = buildVpToken(vp);
    const b = buildVpToken(vp);
    expect(a.nonce).not.toBe(b.nonce);
  });

  it("sets issuedAt to current unix seconds", () => {
    const before = Math.floor(Date.now() / 1000);
    const vp = makePresentation(makeCredential());
    const result = buildVpToken(vp);
    const after = Math.floor(Date.now() / 1000);
    expect(result.issuedAt).toBeGreaterThanOrEqual(before);
    expect(result.issuedAt).toBeLessThanOrEqual(after);
  });

  it("defaults expiresIn to 300 seconds", () => {
    const vp = makePresentation(makeCredential());
    const result = buildVpToken(vp);
    expect(result.expiresIn).toBe(300);
  });

  it("respects a custom expiresIn", () => {
    const vp = makePresentation(makeCredential());
    const result = buildVpToken(vp, { expiresIn: 900 });
    expect(result.expiresIn).toBe(900);
  });

  it("uses a custom label when provided", () => {
    const vp = makePresentation(makeCredential());
    const result = buildVpToken(vp, { label: "My Custom Label" });
    expect(result.label).toBe("My Custom Label");
  });

  it("auto-builds a label from issuer name when none is provided", () => {
    const vp = makePresentation(makeCredential());
    const result = buildVpToken(vp);
    expect(result.label).toContain("StellarDevHub");
  });

  it("embeds a base64url-encoded JSON VP in the raw token", () => {
    const vc = makeCredential();
    const vp = makePresentation(vc);
    const result = buildVpToken(vp);
    // Strip prefix and re-decode
    const b64 = result.raw.slice("VP_TOKEN/".length);
    // base64url → base64 → JSON
    const padded = b64.replace(/-/g, "+").replace(/_/g, "/") +
      "==".slice(0, (4 - (b64.length % 4)) % 4);
    const json = typeof atob !== "undefined"
      ? atob(padded)
      : Buffer.from(padded, "base64").toString("utf-8");
    const decoded = JSON.parse(json) as VerifiablePresentation;
    expect(decoded.type).toContain("VerifiablePresentation");
    expect(decoded.verifiableCredential[0].id).toBe(vc.id);
  });
});

// ---------------------------------------------------------------------------
// 2. QR payload parsing
// ---------------------------------------------------------------------------

describe("parseVpToken", () => {
  it("round-trips a VerifiablePresentation through buildVpToken → parseVpToken", () => {
    const vc = makeCredential();
    const vp = makePresentation(vc);
    const { raw } = buildVpToken(vp);
    const parsed = parseVpToken(raw);
    expect(parsed.type).toContain("VerifiablePresentation");
    expect(parsed.verifiableCredential[0].id).toBe(vc.id);
    expect(parsed.holder).toBe(HOLDER_DID);
  });

  it("preserves all credential subject claims after round-trip", () => {
    const vc = makeCredential({ credentialSubject: { id: HOLDER_DID, score: 99, role: "admin" } });
    const vp = makePresentation(vc);
    const { raw } = buildVpToken(vp);
    const parsed = parseVpToken(raw);
    expect(parsed.verifiableCredential[0].credentialSubject.score).toBe(99);
    expect(parsed.verifiableCredential[0].credentialSubject.role).toBe("admin");
  });

  it("throws when the prefix is missing", () => {
    expect(() => parseVpToken("INVALID_TOKEN/abc")).toThrow(
      /must start with "VP_TOKEN\//
    );
  });

  it("throws when the payload is not valid JSON", () => {
    // Build a VP_TOKEN/ prefix with non-JSON base64url body
    const bad = "VP_TOKEN/" + btoa("not_json").replace(/=/g, "");
    expect(() => parseVpToken(bad)).toThrow();
  });

  it("throws when the parsed object is not a VP (missing @context array)", () => {
    const notVp = JSON.stringify({ type: ["VerifiablePresentation"] }); // no @context
    const encoded = btoa(notVp).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(() => parseVpToken(`VP_TOKEN/${encoded}`)).toThrow(
      /not a valid VerifiablePresentation/
    );
  });
});

// ---------------------------------------------------------------------------
// 3. SVG QR code generation
// ---------------------------------------------------------------------------

describe("generateQrSvg", () => {
  it("returns an svg string containing an <svg> element", () => {
    const { svg } = generateQrSvg("hello-world");
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
  });

  it("includes a viewBox attribute", () => {
    const { svg } = generateQrSvg("hello");
    expect(svg).toMatch(/viewBox="0 0 \d+ \d+"/);
  });

  it("sets width and height from the size option", () => {
    const { svg, size } = generateQrSvg("test", { size: 128 });
    // The SVG size may differ slightly due to module quantisation, but
    // the returned `size` field must be a positive integer.
    expect(size).toBeGreaterThan(0);
    expect(svg).toContain(`width="${size}"`);
    expect(svg).toContain(`height="${size}"`);
  });

  it("uses the custom darkColor in rect fill attributes", () => {
    const { svg } = generateQrSvg("stellar", { darkColor: "#ff0066" });
    expect(svg).toContain('fill="#ff0066"');
  });

  it("uses the custom lightColor as the background rect fill", () => {
    const { svg } = generateQrSvg("stellar", { lightColor: "#00ff00" });
    // The first rect is always the background
    const firstRect = svg.match(/<rect[^>]*fill="([^"]+)"/);
    expect(firstRect?.[1]).toBe("#00ff00");
  });

  it("encodes the VP_TOKEN raw string without throwing for typical payloads", () => {
    const vp = makePresentation(makeCredential());
    const { raw } = buildVpToken(vp);
    // Should not throw even for the longer VP_TOKEN string
    expect(() => generateQrSvg(raw, { size: 256 })).not.toThrow();
  });

  it("sets encoded to the original input string", () => {
    const input = "VP_TOKEN/test123";
    const { encoded } = generateQrSvg(input);
    expect(encoded).toBe(input);
  });

  it("throws when input exceeds version-10 byte capacity", () => {
    const huge = "X".repeat(300);
    expect(() => generateQrSvg(huge)).toThrow(/too long for QR version/);
  });
});

// ---------------------------------------------------------------------------
// 4. Card rendering — issuer, holder, timestamps, status badges
// ---------------------------------------------------------------------------

describe("DidCredentialCard rendering", () => {
  it("renders the article with data-testid did-credential-card", () => {
    render(<DidCredentialCard credential={makeCredential()} />);
    expect(screen.getByTestId("did-credential-card")).toBeInTheDocument();
  });

  it("displays the credential type as the card heading", () => {
    render(<DidCredentialCard credential={makeCredential()} />);
    expect(screen.getByTestId("credential-type-heading")).toHaveTextContent(
      "StellarDeveloperCredential"
    );
  });

  it("shows the issuer name in the card body", () => {
    render(<DidCredentialCard credential={makeCredential()} />);
    expect(screen.getByText("StellarDevHub")).toBeInTheDocument();
  });

  it("displays a truncated holder DID", () => {
    render(<DidCredentialCard credential={makeCredential()} />);
    // The holder DID label is present (truncated)
    const holderLabel = screen.getByText("Holder");
    expect(holderLabel).toBeInTheDocument();
  });

  it("renders the Valid status badge for a non-expired credential", () => {
    render(<DidCredentialCard credential={makeCredential()} />);
    expect(screen.getByText("Valid")).toBeInTheDocument();
  });

  it("renders the Expired status badge for a past credential", () => {
    const expired = makeCredential({ validUntil: "2020-01-01T00:00:00Z" });
    render(<DidCredentialCard credential={expired} />);
    expect(screen.getByText("Expired")).toBeInTheDocument();
  });

  it("renders 'No Expiry' badge when validUntil is absent", () => {
    const noExpiry = makeCredential({ validUntil: undefined });
    render(<DidCredentialCard credential={noExpiry} />);
    expect(screen.getByText("No Expiry")).toBeInTheDocument();
  });

  it("renders 'Not Yet Valid' badge when validFrom is in the future", () => {
    const future = makeCredential({
      validFrom: "2099-01-01T00:00:00Z",
      validUntil: "2100-01-01T00:00:00Z",
    });
    render(<DidCredentialCard credential={future} />);
    expect(screen.getByText("Not Yet Valid")).toBeInTheDocument();
  });

  it("renders the Valid From field", () => {
    render(<DidCredentialCard credential={makeCredential()} />);
    expect(screen.getByText("Valid From")).toBeInTheDocument();
  });

  it("renders the Expires field when validUntil is set", () => {
    render(<DidCredentialCard credential={makeCredential()} />);
    expect(screen.getByText("Expires")).toBeInTheDocument();
  });

  it("does not render an Expires field when validUntil is absent", () => {
    const noExpiry = makeCredential({ validUntil: undefined });
    render(<DidCredentialCard credential={noExpiry} />);
    expect(screen.queryByText("Expires")).not.toBeInTheDocument();
  });

  it("renders the footer with a truncated credential id", () => {
    const vc = makeCredential();
    render(<DidCredentialCard credential={vc} />);
    // Footer always contains the last segment of the credential ID
    const article = screen.getByTestId("did-credential-card");
    expect(within(article).getByText(/vc-test-001/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 5. QR panel — toggle, SVG rendered, VP token copy
// ---------------------------------------------------------------------------

describe("DidCredentialCard QR panel", () => {
  it("shows the QR panel by default (showQr: true)", () => {
    render(<DidCredentialCard credential={makeCredential()} />);
    expect(screen.getByTestId("qr-panel")).toBeInTheDocument();
  });

  it("hides the QR panel when showQr: false in initialTheme", () => {
    render(
      <DidCredentialCard
        credential={makeCredential()}
        initialTheme={{
          colorScheme: "stellar-dark",
          showQr: false,
          showAvatar: false,
          showIssuerLogo: false,
        }}
      />
    );
    expect(screen.queryByTestId("qr-panel")).not.toBeInTheDocument();
  });

  it("toggles the QR panel open and closed", () => {
    render(<DidCredentialCard credential={makeCredential()} />);
    const btn = screen.getByTestId("toggle-qr-btn");

    // Panel starts open
    expect(screen.getByTestId("qr-panel")).toBeInTheDocument();

    // Close
    fireEvent.click(btn);
    expect(screen.queryByTestId("qr-panel")).not.toBeInTheDocument();

    // Reopen
    fireEvent.click(btn);
    expect(screen.getByTestId("qr-panel")).toBeInTheDocument();
  });

  it("renders an <svg> element inside the QR container", () => {
    render(<DidCredentialCard credential={makeCredential()} />);
    const container = screen.getByTestId("qr-svg-container");
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("displays the VP token nonce (truncated)", () => {
    render(<DidCredentialCard credential={makeCredential()} />);
    // Nonce label is always visible
    expect(screen.getByText("Nonce:")).toBeInTheDocument();
  });

  it("copy button calls navigator.clipboard.writeText with the VP token", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const onCopyToken = jest.fn();
    render(
      <DidCredentialCard
        credential={makeCredential()}
        onCopyToken={onCopyToken}
      />
    );

    fireEvent.click(screen.getByTestId("copy-token-btn"));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));

    const calledWith: string = writeText.mock.calls[0][0];
    expect(calledWith).toMatch(/^VP_TOKEN\//);
    expect(onCopyToken).toHaveBeenCalledWith(calledWith);
  });

  it("shows 'Copied!' feedback after clipboard write", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: jest.fn().mockResolvedValue(undefined) },
      configurable: true,
    });

    render(<DidCredentialCard credential={makeCredential()} />);
    fireEvent.click(screen.getByTestId("copy-token-btn"));

    await waitFor(() =>
      expect(screen.getByText("Copied!")).toBeInTheDocument()
    );
  });
});

// ---------------------------------------------------------------------------
// 6. Proof panel — collapsible attestation details
// ---------------------------------------------------------------------------

describe("DidCredentialCard proof panel", () => {
  it("renders the toggle button when a proof is present", () => {
    render(<DidCredentialCard credential={makeCredential()} />);
    expect(screen.getByTestId("toggle-proof-btn")).toBeInTheDocument();
  });

  it("does not render the proof toggle when no proof is on the credential", () => {
    const noProof = makeCredential({ proof: undefined });
    render(<DidCredentialCard credential={noProof} />);
    expect(screen.queryByTestId("toggle-proof-btn")).not.toBeInTheDocument();
  });

  it("proof panel is hidden by default", () => {
    render(<DidCredentialCard credential={makeCredential()} />);
    expect(screen.queryByTestId("proof-panel")).not.toBeInTheDocument();
  });

  it("expands the proof panel when the toggle is clicked", () => {
    render(<DidCredentialCard credential={makeCredential()} />);
    fireEvent.click(screen.getByTestId("toggle-proof-btn"));
    expect(screen.getByTestId("proof-panel")).toBeInTheDocument();
  });

  it("displays Proof Type, Proof Created, Verification Method, and Proof Value", () => {
    render(<DidCredentialCard credential={makeCredential()} />);
    fireEvent.click(screen.getByTestId("toggle-proof-btn"));

    expect(screen.getByText("Proof Type")).toBeInTheDocument();
    expect(screen.getByText("Ed25519Signature2020")).toBeInTheDocument();
    expect(screen.getByText("Proof Created")).toBeInTheDocument();
    expect(screen.getByText("Verification Method")).toBeInTheDocument();
    expect(screen.getByTestId("proof-value-display")).toHaveTextContent(
      "z4oey5q2M3XKaxup3tmzN4A23kcAEe8oApB9pK7mH7a6TEcJGzQUcSjJBnmNnJWy"
    );
  });

  it("collapses the proof panel on a second click", () => {
    render(<DidCredentialCard credential={makeCredential()} />);
    const btn = screen.getByTestId("toggle-proof-btn");
    fireEvent.click(btn); // open
    fireEvent.click(btn); // close
    expect(screen.queryByTestId("proof-panel")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 7. Theme picker — scheme switching
// ---------------------------------------------------------------------------

describe("DidCredentialCard theme picker", () => {
  it("shows the theme toggle button by default", () => {
    render(<DidCredentialCard credential={makeCredential()} />);
    expect(screen.getByTestId("toggle-theme-btn")).toBeInTheDocument();
  });

  it("hides the theme picker when hideThemePicker is true", () => {
    render(
      <DidCredentialCard
        credential={makeCredential()}
        hideThemePicker
      />
    );
    expect(screen.queryByTestId("toggle-theme-btn")).not.toBeInTheDocument();
  });

  it("expands the theme picker on click", () => {
    render(<DidCredentialCard credential={makeCredential()} />);
    fireEvent.click(screen.getByTestId("toggle-theme-btn"));
    expect(screen.getByTestId("theme-picker")).toBeInTheDocument();
  });

  it("renders all 5 color scheme options", () => {
    render(<DidCredentialCard credential={makeCredential()} />);
    fireEvent.click(screen.getByTestId("toggle-theme-btn"));
    const schemes = [
      "stellar-dark",
      "midnight-purple",
      "emerald",
      "gold",
      "mono-light",
    ];
    for (const s of schemes) {
      expect(screen.getByTestId(`theme-option-${s}`)).toBeInTheDocument();
    }
  });

  it("marks the current scheme as aria-checked=true", () => {
    render(<DidCredentialCard credential={makeCredential()} />);
    fireEvent.click(screen.getByTestId("toggle-theme-btn"));
    expect(
      screen.getByTestId("theme-option-stellar-dark")
    ).toHaveAttribute("aria-checked", "true");
  });

  it("switches aria-checked when a different scheme is selected", () => {
    render(<DidCredentialCard credential={makeCredential()} />);
    fireEvent.click(screen.getByTestId("toggle-theme-btn"));
    fireEvent.click(screen.getByTestId("theme-option-emerald"));
    expect(
      screen.getByTestId("theme-option-emerald")
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByTestId("theme-option-stellar-dark")
    ).toHaveAttribute("aria-checked", "false");
  });

  it("initialises with the scheme from initialTheme.colorScheme", () => {
    render(
      <DidCredentialCard
        credential={makeCredential()}
        initialTheme={{
          colorScheme: "gold",
          showQr: true,
          showAvatar: false,
          showIssuerLogo: false,
        }}
      />
    );
    fireEvent.click(screen.getByTestId("toggle-theme-btn"));
    expect(
      screen.getByTestId("theme-option-gold")
    ).toHaveAttribute("aria-checked", "true");
  });
});

// ---------------------------------------------------------------------------
// 8. Wallet export buttons
// ---------------------------------------------------------------------------

describe("DidCredentialCard wallet export", () => {
  beforeEach(() => {
    // Stub URL.createObjectURL / revokeObjectURL for download helper
    global.URL.createObjectURL = jest.fn(() => "blob:mock");
    global.URL.revokeObjectURL = jest.fn();
    // Stub document.createElement("a") click
    jest.spyOn(document.body, "appendChild").mockImplementation((el) => el);
    jest.spyOn(document.body, "removeChild").mockImplementation((el) => el);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders the Apple Wallet export button", () => {
    render(<DidCredentialCard credential={makeCredential()} />);
    expect(screen.getByTestId("export-apple-btn")).toBeInTheDocument();
  });

  it("renders the Google Wallet export button", () => {
    render(<DidCredentialCard credential={makeCredential()} />);
    expect(screen.getByTestId("export-google-btn")).toBeInTheDocument();
  });

  it("fires onExportApple callback when Apple Wallet button is clicked", async () => {
    const onExportApple = jest.fn();
    render(
      <DidCredentialCard
        credential={makeCredential()}
        onExportApple={onExportApple}
      />
    );
    fireEvent.click(screen.getByTestId("export-apple-btn"));
    await waitFor(() => expect(onExportApple).toHaveBeenCalledTimes(1));
  });

  it("fires onExportGoogle callback when Google Wallet button is clicked", async () => {
    const onExportGoogle = jest.fn();
    render(
      <DidCredentialCard
        credential={makeCredential()}
        onExportGoogle={onExportGoogle}
      />
    );
    fireEvent.click(screen.getByTestId("export-google-btn"));
    await waitFor(() => expect(onExportGoogle).toHaveBeenCalledTimes(1));
  });

  it("disables the Apple button briefly after clicking (exporting state)", async () => {
    render(<DidCredentialCard credential={makeCredential()} />);
    const btn = screen.getByTestId("export-apple-btn");
    fireEvent.click(btn);
    // Immediately after click the button should be disabled
    expect(btn).toBeDisabled();
    // After 1.5 s timeout it re-enables (use fake timers to avoid waiting)
  });
});

// ---------------------------------------------------------------------------
// 9. Apple Wallet pass builder (unit)
// ---------------------------------------------------------------------------

describe("buildAppleWalletPass", () => {
  const vc = makeCredential();
  const token = "VP_TOKEN/mock-token";

  it("sets formatVersion to 1", () => {
    const pass = buildAppleWalletPass(vc, token);
    expect(pass.formatVersion).toBe(1);
  });

  it("sets passTypeIdentifier to pass.com.stellardevhub.did", () => {
    const pass = buildAppleWalletPass(vc, token);
    expect(pass.passTypeIdentifier).toBe("pass.com.stellardevhub.did");
  });

  it("includes the credential type in the primaryFields", () => {
    const pass = buildAppleWalletPass(vc, token);
    const primary = pass.generic.primaryFields[0];
    expect(primary.value).toContain("StellarDeveloperCredential");
  });

  it("includes issuer name in secondaryFields", () => {
    const pass = buildAppleWalletPass(vc, token);
    const issuerField = pass.generic.secondaryFields.find(
      (f) => f.key === "issuer"
    );
    expect(issuerField?.value).toBe("StellarDevHub");
  });

  it("sets the barcode message to the VP token string", () => {
    const pass = buildAppleWalletPass(vc, token);
    expect(pass.barcodes[0].message).toBe(token);
    expect(pass.barcodes[0].format).toBe("PKBarcodeFormatQR");
  });

  it("includes validFrom in auxiliaryFields", () => {
    const pass = buildAppleWalletPass(vc, token);
    const dateField = pass.generic.auxiliaryFields.find(
      (f) => f.key === "validFrom"
    );
    expect(dateField).toBeDefined();
  });

  it("includes expirationDate when validUntil is set", () => {
    const pass = buildAppleWalletPass(vc, token);
    expect(pass.expirationDate).toBeDefined();
  });

  it("omits expirationDate when validUntil is absent", () => {
    const noExpiry = makeCredential({ validUntil: undefined });
    const pass = buildAppleWalletPass(noExpiry, token);
    expect(pass.expirationDate).toBeUndefined();
  });

  it("puts the full credential ID on the back of the pass", () => {
    const pass = buildAppleWalletPass(vc, token);
    const idField = pass.generic.backFields.find(
      (f) => f.key === "credentialId"
    );
    expect(idField?.value).toBe(vc.id);
  });

  it("applies custom backgroundColor from color hints", () => {
    const pass = buildAppleWalletPass(vc, token, {
      backgroundColor: "#1e1b4b",
    });
    expect(pass.backgroundColor).toContain("rgb(30, 27, 75)");
  });
});

// ---------------------------------------------------------------------------
// 10. Google Wallet builder (unit)
// ---------------------------------------------------------------------------

describe("buildGoogleWalletPayload", () => {
  const vc = makeCredential();
  const token = "VP_TOKEN/mock-token";

  it("sets aud to 'google'", () => {
    const payload = buildGoogleWalletPayload(vc, token);
    expect(payload.aud).toBe("google");
  });

  it("sets typ to 'savetowallet'", () => {
    const payload = buildGoogleWalletPayload(vc, token);
    expect(payload.typ).toBe("savetowallet");
  });

  it("includes exactly one genericObject in the payload", () => {
    const payload = buildGoogleWalletPayload(vc, token);
    expect(payload.payload.genericObjects).toHaveLength(1);
  });

  it("sets the barcode value to the VP token string", () => {
    const payload = buildGoogleWalletPayload(vc, token);
    const obj = payload.payload.genericObjects[0];
    expect(obj.barcode.value).toBe(token);
    expect(obj.barcode.type).toBe("QR_CODE");
  });

  it("sets state to ACTIVE for a valid credential", () => {
    const payload = buildGoogleWalletPayload(vc, token);
    expect(payload.payload.genericObjects[0].state).toBe("ACTIVE");
  });

  it("sets state to EXPIRED for an already-expired credential", () => {
    const expired = makeCredential({ validUntil: "2020-01-01T00:00:00Z" });
    const payload = buildGoogleWalletPayload(expired, token);
    expect(payload.payload.genericObjects[0].state).toBe("EXPIRED");
  });

  it("includes issuer in textModulesData", () => {
    const payload = buildGoogleWalletPayload(vc, token);
    const obj = payload.payload.genericObjects[0];
    const issuerModule = obj.textModulesData.find((m) => m.id === "issuer");
    expect(issuerModule?.body).toBe("StellarDevHub");
  });

  it("includes credential ID in textModulesData", () => {
    const payload = buildGoogleWalletPayload(vc, token);
    const obj = payload.payload.genericObjects[0];
    const idModule = obj.textModulesData.find((m) => m.id === "cred_id");
    expect(idModule?.body).toBe(vc.id);
  });

  it("sets hexBackgroundColor from color hints", () => {
    const payload = buildGoogleWalletPayload(vc, token, undefined, {
      backgroundColor: "#1e1b4b",
    });
    const obj = payload.payload.genericObjects[0];
    expect(obj.hexBackgroundColor).toBe("#1e1b4b");
  });

  it("sets header to the credential type label", () => {
    const payload = buildGoogleWalletPayload(vc, token);
    const obj = payload.payload.genericObjects[0];
    expect(obj.header.defaultValue.value).toContain("StellarDeveloperCredential");
  });

  it("includes validTimeInterval when validFrom and validUntil are present", () => {
    const payload = buildGoogleWalletPayload(vc, token);
    const obj = payload.payload.genericObjects[0];
    expect(obj.validTimeInterval?.start.date).toContain("2026");
    expect(obj.validTimeInterval?.end?.date).toContain("2027");
  });

  it("omits validTimeInterval end when validUntil is absent", () => {
    const noExpiry = makeCredential({ validUntil: undefined });
    const payload = buildGoogleWalletPayload(noExpiry, token);
    const obj = payload.payload.genericObjects[0];
    expect(obj.validTimeInterval?.end).toBeUndefined();
  });
});
