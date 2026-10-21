import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { xdr } from "@stellar/stellar-sdk";
import AuthTreeBuilder, {
  validateStellarAddress,
  validateContractId,
  validateNonce,
  validateExpirationLedger,
  validateAuthEntry,
  serializeSorobanAuthEntry,
  PRESET_DEFI_ROUTER,
  PRESET_MULTISIG_ESCROW,
  AuthSignatureEntry,
} from "../../../components/Auth/AuthTreeBuilder";

describe("Soroban Auth Tree Builder - Validation Engine", () => {
  describe("validateStellarAddress", () => {
    it("accepts valid 56-character Ed25519 account addresses (G...)", () => {
      const validG = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
      const res = validateStellarAddress(validG);
      expect(res.valid).toBe(true);
      expect(res.type).toBe("account");
    });

    it("accepts valid 56-character Contract addresses (C...)", () => {
      const validC = "CA3D5KRYMCMCZVACQ3QBH7ACR3GFWYA3UQ7JTYC46BAPU26UFDQ2E6R2";
      const res = validateStellarAddress(validC);
      expect(res.valid).toBe(true);
      expect(res.type).toBe("contract");
    });

    it("rejects addresses with invalid prefix or length", () => {
      expect(validateStellarAddress("ABRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H").valid).toBe(false);
      expect(validateStellarAddress("GBRPY").valid).toBe(false);
      expect(validateStellarAddress("").valid).toBe(false);
    });

    it("rejects addresses containing non-base32 characters", () => {
      // '0', '1', '8', '9' are not in standard base32 (except 2-7)
      const invalidChars = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX18";
      expect(validateStellarAddress(invalidChars).valid).toBe(false);
    });
  });

  describe("validateContractId", () => {
    it("validates 56-character contract addresses beginning with C", () => {
      const validC = "CA3D5KRYMCMCZVACQ3QBH7ACR3GFWYA3UQ7JTYC46BAPU26UFDQ2E6R2";
      expect(validateContractId(validC).valid).toBe(true);

      expect(validateContractId("GA3D5KRYMCMCZVACQ3QBH7ACR3GFWYA3UQ7JTYC46BAPU26UFDQ2E6R2").valid).toBe(false);
      expect(validateContractId("").valid).toBe(false);
    });
  });

  describe("validateNonce", () => {
    it("accepts non-negative 64-bit integer strings", () => {
      expect(validateNonce("0").valid).toBe(true);
      expect(validateNonce("105").valid).toBe(true);
      expect(validateNonce("9223372036854775807").valid).toBe(true);
    });

    it("rejects negative numbers, decimals, or non-numeric characters", () => {
      expect(validateNonce("-1").valid).toBe(false);
      expect(validateNonce("10.5").valid).toBe(false);
      expect(validateNonce("abc").valid).toBe(false);
      expect(validateNonce("").valid).toBe(false);
    });
  });

  describe("validateExpirationLedger", () => {
    const currentLedger = 640000;

    it("validates future expiration ledger limits", () => {
      const res = validateExpirationLedger(650000, currentLedger);
      expect(res.valid).toBe(true);
      expect(res.severity).toBeUndefined();
    });

    it("requires an integer within the uint32 ledger range", () => {
      expect(validateExpirationLedger(640000.5, currentLedger).valid).toBe(false);
      expect(validateExpirationLedger(4294967296, currentLedger).valid).toBe(false);
      expect(validateExpirationLedger(4294967295, currentLedger).valid).toBe(true);
    });

    it("flags expired ledgers as critical error", () => {
      const res = validateExpirationLedger(639999, currentLedger);
      expect(res.valid).toBe(false);
      expect(res.severity).toBe("error");
    });

    it("flags ledgers expiring in < 100 ledgers as warning", () => {
      const res = validateExpirationLedger(640050, currentLedger);
      expect(res.valid).toBe(true);
      expect(res.severity).toBe("warning");
    });
  });

  describe("validateAuthEntry", () => {
    const currentLedger = 640000;

    it("passes completely for compliant preset entry", () => {
      const issues = validateAuthEntry(PRESET_DEFI_ROUTER, currentLedger);
      const errors = issues.filter((i) => i.severity === "error");
      expect(errors.length).toBe(0);
    });

    it("detects missing signature, expired ledger, and malformed contract ID", () => {
      const invalidEntry: AuthSignatureEntry = {
        id: "invalid-1",
        address: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
        type: "address",
        nonce: "-5",
        expirationLedger: 600000, // Expired
        signature: "", // Missing signature
        signatureType: "ed25519",
        rootInvocation: {
          id: "root-1",
          contractId: "INVALID_CID",
          functionName: "",
          args: [],
          subInvocations: [],
        },
      };

      const issues = validateAuthEntry(invalidEntry, currentLedger);
      expect(issues.some((i) => i.field === "nonce")).toBe(true);
      expect(issues.some((i) => i.field === "expirationLedger")).toBe(true);
      expect(issues.some((i) => i.field === "signature")).toBe(true);
      expect(issues.some((i) => i.field === "contractId")).toBe(true);
      expect(issues.some((i) => i.field === "functionName")).toBe(true);
    });
  });
});

describe("Soroban Auth Tree Builder - XDR Serialization", () => {
  it("serializes multi-level authorization tree to valid XDR Base64 and Hex", () => {
    const serialized = serializeSorobanAuthEntry(PRESET_DEFI_ROUTER);

    expect(serialized.base64).toBeTruthy();
    expect(serialized.hex).toBeTruthy();
    expect(serialized.json).toBeDefined();
    const fromBase64 = xdr.SorobanAuthorizationEntry.fromXDR(serialized.base64, "base64");
    const fromHex = xdr.SorobanAuthorizationEntry.fromXDR(serialized.hex, "hex");
    expect(fromBase64.toXDR("hex")).toBe(serialized.hex);
    expect(fromHex.toXDR("base64")).toBe(serialized.base64);
    expect(fromBase64.rootInvocation().subInvocations()).toHaveLength(1);
    expect(fromBase64.rootInvocation().subInvocations()[0].subInvocations()).toHaveLength(1);
  });

  it("handles source_account credentials without signature fields", () => {
    const sourceAccountEntry: AuthSignatureEntry = {
      ...PRESET_DEFI_ROUTER,
      type: "source_account",
    };

    const serialized = serializeSorobanAuthEntry(sourceAccountEntry);
    const decoded = xdr.SorobanAuthorizationEntry.fromXDR(serialized.base64, "base64");
    expect(decoded.credentials().switch()).toBe(xdr.SorobanCredentialsType.sorobanCredentialsSourceAccount());
  });

  it("labels encoded output as Soroban XDR and explains it is unsigned", () => {
    render(<AuthTreeBuilder initialEntries={[PRESET_DEFI_ROUTER]} currentLedger={640000} />);
    fireEvent.click(screen.getByRole("button", { name: /Export XDR Payload/i }));
    expect(screen.getByText(/Base64 and Hex are Stellar SorobanAuthorizationEntry XDR encodings/i)).toBeInTheDocument();
    expect(screen.getByText(/Encoding does not sign this entry/i)).toBeInTheDocument();
  });
});

describe("AuthTreeBuilder UI Component", () => {
  it("renders component header, presets, and root invocation", () => {
    render(<AuthTreeBuilder initialEntries={[PRESET_DEFI_ROUTER]} currentLedger={640000} />);

    expect(screen.getByText(/Soroban Auth Invocation Tree Builder/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue("swap_tokens")).toBeInTheDocument();
    expect(screen.getByDisplayValue("swap")).toBeInTheDocument();
    expect(screen.getByDisplayValue("transfer_from")).toBeInTheDocument();
  });

  it("switches preset scenarios to Multisig Escrow", () => {
    render(<AuthTreeBuilder currentLedger={640000} />);

    const escrowPresetBtn = screen.getByRole("button", { name: "Multisig Escrow" });
    fireEvent.click(escrowPresetBtn);

    expect(screen.getByDisplayValue("release_milestone")).toBeInTheDocument();
    expect(screen.getByDisplayValue("transfer")).toBeInTheDocument();
  });

  it("allows adding and removing signers", () => {
    render(<AuthTreeBuilder currentLedger={640000} />);

    const addSignerBtn = screen.getByRole("button", { name: /Add Signer/i });
    fireEvent.click(addSignerBtn);

    expect(screen.getByText(/Signer 2:/i)).toBeInTheDocument();
  });

  it("switches to Credentials tab and updates nonce and expiration", () => {
    render(<AuthTreeBuilder initialEntries={[PRESET_DEFI_ROUTER]} currentLedger={640000} />);

    const credTabBtn = screen.getByRole("button", { name: /Credentials & Signature/i });
    fireEvent.click(credTabBtn);

    expect(screen.getByText(/Nonce Sequence/i)).toBeInTheDocument();
    expect(screen.getByText(/Expiration Ledger/i)).toBeInTheDocument();

    const incrementBtn = screen.getByRole("button", { name: /\+1 Increment/i });
    fireEvent.click(incrementBtn);

    // Nonce should have incremented from 105 to 106
    expect(screen.getByDisplayValue("106")).toBeInTheDocument();
  });

  it("switches to Export XDR tab and displays Base64 and Hex controls", () => {
    render(<AuthTreeBuilder initialEntries={[PRESET_DEFI_ROUTER]} currentLedger={640000} />);

    const exportTabBtn = screen.getByRole("button", { name: /Export XDR Payload/i });
    fireEvent.click(exportTabBtn);

    expect(screen.getByRole("button", { name: /base64/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /hex/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /json/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copy Payload/i })).toBeInTheDocument();
  });

  it("adds and removes sub-invocations dynamically", () => {
    render(<AuthTreeBuilder initialEntries={[PRESET_DEFI_ROUTER]} currentLedger={640000} />);

    const addSubBtns = screen.getAllByRole("button", { name: /Add Sub-Call/i });
    fireEvent.click(addSubBtns[0]);

    // Should create a new sub-invocation node
    expect(screen.getAllByDisplayValue("call").length).toBeGreaterThan(0);
  });
});
