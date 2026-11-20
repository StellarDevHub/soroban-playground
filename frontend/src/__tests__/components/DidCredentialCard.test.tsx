// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * @file DidCredentialCard.test.tsx
 * React Testing Library component tests for DidCredentialCard:
 * - Visual elements and layout rendering
 * - SVG QR code generator embedding
 * - Theme preset customization
 * - Display toggles (QR, Attestation, Timestamps, Hologram, Chip)
 * - Error correction selector
 * - Export formats and clipboard actions
 * - Interactive Verifiable Presentation verifier modal
 */

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

import DidCredentialCard from "../../components/DidCredentialCard";
import { SAMPLE_CREDENTIALS } from "../../lib/did/claimToken";
import type { VerifiableCredential } from "../../types/did";

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: jest.fn().mockImplementation(() => Promise.resolve()),
  },
});

describe("DidCredentialCard Component", () => {
  const sampleCred: VerifiableCredential = SAMPLE_CREDENTIALS[0];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders credential details, holder information, and active status", () => {
    render(<DidCredentialCard credential={sampleCred} />);

    expect(screen.getByTestId("did-credential-card")).toBeInTheDocument();
    expect(screen.getByTestId("credential-title")).toHaveTextContent(sampleCred.title);
    expect(screen.getByTestId("subject-name")).toHaveTextContent(
      sampleCred.credentialSubject.name!,
    );
    expect(screen.getByTestId("subject-role")).toHaveTextContent(
      sampleCred.credentialSubject.role!,
    );
    expect(screen.getByText("ACTIVE")).toBeInTheDocument();
    expect(screen.getByTestId("subject-did")).toHaveTextContent(
      sampleCred.credentialSubject.id,
    );
  });

  it("renders SVG QR code generator with verifiable presentation payload", () => {
    render(<DidCredentialCard credential={sampleCred} />);

    const qrContainer = screen.getByTestId("did-qr-code");
    expect(qrContainer).toBeInTheDocument();
    const svgElement = qrContainer.querySelector("svg");
    expect(svgElement).toBeInTheDocument();
    expect(svgElement).toHaveAttribute("viewBox");
    expect(svgElement?.querySelector("path")).toBeInTheDocument();
    expect(screen.getByText(/mobile proof qr/i)).toBeInTheDocument();
  });

  it("toggles display elements when customizer buttons are clicked", () => {
    render(<DidCredentialCard credential={sampleCred} showControls={true} />);

    // Toggle QR code off and back on
    expect(screen.getByTestId("did-qr-code")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("toggle-qr-button"));
    expect(screen.queryByTestId("did-qr-code")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("toggle-qr-button"));
    expect(screen.getByTestId("did-qr-code")).toBeInTheDocument();

    // Toggle Issuer Attestation
    expect(screen.getByTestId("issuer-attestation-container")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("toggle-attestation-button"));
    expect(screen.queryByTestId("issuer-attestation-container")).not.toBeInTheDocument();

    // Toggle Validity Timestamps
    expect(screen.getByTestId("validity-timestamps-container")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("toggle-timestamps-button"));
    expect(screen.queryByTestId("validity-timestamps-container")).not.toBeInTheDocument();

    // Toggle Hologram Overlay
    expect(screen.getByTestId("card-hologram")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("toggle-hologram-button"));
    expect(screen.queryByTestId("card-hologram")).not.toBeInTheDocument();

    // Toggle Chip
    expect(screen.getByTestId("card-chip")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("toggle-chip-button"));
    expect(screen.queryByTestId("card-chip")).not.toBeInTheDocument();
  });

  it("switches theme presets cleanly and updates accent styles", () => {
    render(<DidCredentialCard credential={sampleCred} showControls={true} />);

    const card = screen.getByTestId("did-credential-card");
    expect(card.className).toContain("from-slate-900");

    // Switch to Soroban Violet
    fireEvent.click(screen.getByTestId("theme-option-soroban-purple"));
    expect(card.className).toContain("via-purple-950/60");

    // Switch to Aurora Emerald
    fireEvent.click(screen.getByTestId("theme-option-aurora-emerald"));
    expect(card.className).toContain("via-emerald-950/60");

    // Switch to Cyber Amber
    fireEvent.click(screen.getByTestId("theme-option-cyber-amber"));
    expect(card.className).toContain("via-amber-950/60");

    // Switch to Midnight Obsidian
    fireEvent.click(screen.getByTestId("theme-option-midnight-obsidian"));
    expect(card.className).toContain("via-slate-800/80");
  });

  it("allows selecting Reed-Solomon Error Correction levels", () => {
    render(<DidCredentialCard credential={sampleCred} showControls={true} />);

    const ecHButton = screen.getByTestId("ec-level-H");
    fireEvent.click(ecHButton);
    expect(ecHButton.className).toContain("bg-sky-500");

    const ecLButton = screen.getByTestId("ec-level-L");
    fireEvent.click(ecLButton);
    expect(ecLButton.className).toContain("bg-sky-500");
  });

  it("handles copy Subject DID and copy Claim Token to clipboard", async () => {
    render(<DidCredentialCard credential={sampleCred} showControls={true} />);

    // Copy DID
    const copyDidBtn = screen.getByTestId("copy-did-button");
    fireEvent.click(copyDidBtn);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      sampleCred.credentialSubject.id,
    );

    // Copy Token
    const copyTokenBtn = screen.getByTestId("copy-token-button");
    fireEvent.click(copyTokenBtn);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringMatching(/^soroban-vp:v1:/),
    );
  });

  it("triggers export callbacks and downloads for all supported formats", () => {
    const onExportMock = jest.fn();
    render(
      <DidCredentialCard
        credential={sampleCred}
        showControls={true}
        onExport={onExportMock}
      />,
    );

    // W3C JSON-LD Export
    fireEvent.click(screen.getByTestId("export-jsonld-button"));
    expect(onExportMock).toHaveBeenCalledWith("json-ld", sampleCred);
    expect(screen.getByTestId("export-toast")).toHaveTextContent(/JSON-LD/i);

    // Apple Wallet Pass Export
    fireEvent.click(screen.getByTestId("export-apple-wallet-button"));
    expect(onExportMock).toHaveBeenCalledWith("apple-wallet", sampleCred);

    // Google Wallet Pass Export
    fireEvent.click(screen.getByTestId("export-google-wallet-button"));
    expect(onExportMock).toHaveBeenCalledWith("google-wallet", sampleCred);

    // Vector SVG Export
    fireEvent.click(screen.getByTestId("export-svg-button"));
    expect(onExportMock).toHaveBeenCalledWith(
      "svg",
      expect.stringMatching(/^soroban-vp:v1:/),
    );
  });

  it("opens verification modal and inspects presentation token", async () => {
    render(<DidCredentialCard credential={sampleCred} showControls={true} />);

    fireEvent.click(screen.getByTestId("verify-token-button"));
    expect(screen.getByTestId("verify-modal")).toBeInTheDocument();
    expect(screen.getByTestId("verify-result")).toHaveTextContent(
      /Presentation Authenticated & Valid/i,
    );

    // Test entering invalid token
    const tokenInput = screen.getByTestId("verify-token-input");
    fireEvent.change(tokenInput, { target: { value: "invalid-corrupted-token" } });
    expect(screen.getByTestId("verify-result")).toHaveTextContent(
      /Verification Failed/i,
    );

    // Close modal
    fireEvent.click(screen.getByTestId("close-verify-modal"));
    await waitFor(() => {
      expect(screen.queryByTestId("verify-modal")).not.toBeInTheDocument();
    });
  });

  it("hides controls when showControls is false", () => {
    render(<DidCredentialCard credential={sampleCred} showControls={false} />);

    expect(screen.getByTestId("did-credential-card")).toBeInTheDocument();
    expect(screen.queryByTestId("card-customizer-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("export-panel")).not.toBeInTheDocument();
  });
});
