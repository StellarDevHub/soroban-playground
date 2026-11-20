import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import VerificationBadge from "../../components/VerificationBadge";
import * as verificationService from "../../services/contractVerificationService";

describe("VerificationBadge Component", () => {
  const verifiedAttestation: verificationService.VerificationAttestation = {
    contractId: "CABX1234SAMPLECONTRACTID",
    status: "verified",
    verified: true,
    buildDetails: {
      compilerVersion: "rustc 1.79.0 (soroban-sdk 21.0.0)",
      optimizationLevel: "opt-level = 'z'",
      commitSha: "6dcd4ce23d88e2ee9568ba546c007c63d9131c1b",
      repositoryUrl: "https://github.com/stellar/soroban-examples",
      sourceHash: "4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a",
      compiledWasmHash: "ef2d127de37b942baad06145e54b0c619a1f22327b2ebbcfbec78f5564afe39d",
      onChainWasmHash: "ef2d127de37b942baad06145e54b0c619a1f22327b2ebbcfbec78f5564afe39d",
      verifiedAt: "2026-11-20T08:00:00.000Z",
      network: "testnet",
    },
  };

  const unverifiedAttestation: verificationService.VerificationAttestation = {
    contractId: "CU_UNVERIFIED_CONTRACT",
    status: "unverified",
    verified: false,
    errorMessage: "No verification attestation found",
  };

  const mismatchedAttestation: verificationService.VerificationAttestation = {
    contractId: "CM_MISMATCHED_CONTRACT",
    status: "mismatch",
    verified: false,
    buildDetails: {
      compilerVersion: "rustc 1.78.0",
      optimizationLevel: "opt-level = '3'",
      commitSha: "d41d8cd98f00b204e9800998ecf8427e00000000",
      sourceHash: "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
      compiledWasmHash: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      onChainWasmHash: "ee26b0dd4af7e749aa1a8ee3c10ae9923f618980772e473f8819a5d4940e0db2",
      verifiedAt: "2026-11-20T08:00:00.000Z",
      network: "testnet",
    },
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders verified green checkmark badge only for cryptographically matching builds", async () => {
    jest
      .spyOn(verificationService, "fetchContractVerification")
      .mockResolvedValueOnce(verifiedAttestation);

    render(<VerificationBadge contractId="CABX1234SAMPLECONTRACTID" />);

    await waitFor(() => {
      expect(screen.getByTestId("verification-badge-verified")).toBeInTheDocument();
    });

    expect(screen.getByText("Bytecode Verified")).toBeInTheDocument();
    expect(
      screen.getByLabelText(/contract verification status: bytecode verified/i)
    ).toBeInTheDocument();
  });

  it("renders unverified warning badge when contract has no attestation", async () => {
    jest
      .spyOn(verificationService, "fetchContractVerification")
      .mockResolvedValueOnce(unverifiedAttestation);

    render(<VerificationBadge contractId="CU_UNVERIFIED_CONTRACT" />);

    await waitFor(() => {
      expect(screen.getByTestId("verification-badge-unverified")).toBeInTheDocument();
    });

    expect(screen.getByText("Unverified Contract")).toBeInTheDocument();
  });

  it("renders mismatched alert badge when on-chain bytecode differs from compiled artifact", async () => {
    jest
      .spyOn(verificationService, "fetchContractVerification")
      .mockResolvedValueOnce(mismatchedAttestation);

    render(<VerificationBadge contractId="CM_MISMATCHED_CONTRACT" />);

    await waitFor(() => {
      expect(screen.getByTestId("verification-badge-mismatch")).toBeInTheDocument();
    });

    expect(screen.getByText("Bytecode Mismatch")).toBeInTheDocument();
  });

  it("opens Reproducible Build Inspector drawer and displays exact compiler, optimization, and commit SHA", async () => {
    jest
      .spyOn(verificationService, "fetchContractVerification")
      .mockResolvedValueOnce(verifiedAttestation);

    render(<VerificationBadge contractId="CABX1234SAMPLECONTRACTID" />);

    await waitFor(() => {
      expect(screen.getByTestId("verification-badge-verified")).toBeInTheDocument();
    });

    // Click badge to open drawer
    fireEvent.click(screen.getByTestId("verification-badge-verified"));

    // Verify drawer dialog opens
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Reproducible Build Inspector")).toBeInTheDocument();

    // Verify exact compiler version
    expect(screen.getByTestId("compiler-version")).toHaveTextContent(
      "rustc 1.79.0 (soroban-sdk 21.0.0)"
    );

    // Verify exact optimization level
    expect(screen.getByTestId("optimization-level")).toHaveTextContent(
      "opt-level = 'z'"
    );

    // Verify source commit SHA
    expect(screen.getByTestId("source-commit-sha")).toHaveTextContent(
      "6dcd4ce23d88e2ee9568ba546c007c63d9131c1b"
    );

    // Verify bytecode hash comparison
    expect(screen.getByTestId("compiled-wasm-hash")).toHaveTextContent(
      "ef2d127de37b942baad06145e54b0c619a1f22327b2ebbcfbec78f5564afe39d"
    );
    expect(screen.getByTestId("onchain-wasm-hash")).toHaveTextContent(
      "ef2d127de37b942baad06145e54b0c619a1f22327b2ebbcfbec78f5564afe39d"
    );

    // Verify bit-for-bit match indicator
    expect(screen.getByTestId("match-indicator")).toHaveTextContent(
      /Bit-for-bit Identical/i
    );
  });

  it("closes the drawer on Escape key or close button click", async () => {
    jest
      .spyOn(verificationService, "fetchContractVerification")
      .mockResolvedValueOnce(verifiedAttestation);

    render(<VerificationBadge contractId="CABX1234SAMPLECONTRACTID" />);

    await waitFor(() => {
      expect(screen.getByTestId("verification-badge-verified")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("verification-badge-verified"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Press Escape
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // Open again and click close button
    fireEvent.click(screen.getByTestId("verification-badge-verified"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("close-build-inspector"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("supports re-verifying contract on-chain from the inspector drawer", async () => {
    jest
      .spyOn(verificationService, "fetchContractVerification")
      .mockResolvedValueOnce(verifiedAttestation);
    const reverifySpy = jest
      .spyOn(verificationService, "reverifyContract")
      .mockResolvedValueOnce(verifiedAttestation);

    render(<VerificationBadge contractId="CABX1234SAMPLECONTRACTID" />);

    await waitFor(() => {
      expect(screen.getByTestId("verification-badge-verified")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("verification-badge-verified"));
    expect(screen.getByTestId("reverify-button")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("reverify-button"));

    await waitFor(() => {
      expect(reverifySpy).toHaveBeenCalledWith("CABX1234SAMPLECONTRACTID", "testnet");
    });
  });
});
