/**
 * Test suite for PasskeyAdapter — FRONTEND-269
 *
 * Covers all requirements from issue #2039:
 *   ✓ FIDO2 authenticatorData UP (User Presence) flag validation
 *   ✓ FIDO2 authenticatorData UV (User Verification) flag validation
 *   ✓ IEEE P1363 DER → R||S 64-byte secp256r1 signature conversion
 *   ✓ clientDataJSON and authenticatorData XDR encoding
 *   ✓ TouchID / FaceID credential registration handshake simulation
 *   ✓ Passkey signing handshake simulation
 *   ✓ XDR payload assembly and disassembly round-trip
 *   ✓ COSE_Key P-256 public key extraction from attestation
 *   ✓ Adapter integration with WalletType registry
 */

import {
  PasskeyAdapter,
  PasskeySignaturePayload,
  parseAuthenticatorDataFlags,
  validateAuthenticatorDataFlags,
  derToP1363,
  extractP256PublicKeyFromCoseKey,
  assemblePasskeyXdrPayload,
  disassemblePasskeyXdrPayload,
  passkeyAdapter,
} from "../../lib/wallets/PasskeyAdapter";
import { walletRegistry } from "../../lib/wallets";

// ---------------------------------------------------------------------------
// Test helpers — build synthetic WebAuthn structures
// ---------------------------------------------------------------------------

/**
 * Build a minimal authenticatorData buffer with explicit flag bits.
 *
 * Layout: rpIdHash(32) || flags(1) || signCount(4) || optional extensions(0)
 */
function buildAuthenticatorData(options: {
  userPresence?: boolean;
  userVerification?: boolean;
  attestedCredentialData?: boolean;
  extensionData?: boolean;
  signCount?: number;
}): Uint8Array {
  const {
    userPresence = true,
    userVerification = true,
    attestedCredentialData = false,
    extensionData = false,
    signCount = 1,
  } = options;

  const buf = new Uint8Array(37);

  // rpIdHash: 32 bytes of zeros (synthetic; not hash-verified in unit tests)
  buf.fill(0xab, 0, 32);

  // Flags byte
  let flags = 0;
  if (userPresence) flags |= 0x01;
  if (userVerification) flags |= 0x04;
  if (attestedCredentialData) flags |= 0x40;
  if (extensionData) flags |= 0x80;
  buf[32] = flags;

  // signCount: big-endian uint32
  const view = new DataView(buf.buffer);
  view.setUint32(33, signCount, false);

  return buf;
}

/**
 * Encode a 32-byte big-endian integer as an ASN.1 DER INTEGER,
 * with a leading 0x00 byte if the high bit is set (to prevent sign extension).
 */
function derInteger(value: Uint8Array): Uint8Array {
  const needsPad = value[0] & 0x80;
  const content = needsPad
    ? new Uint8Array([0x00, ...value])
    : value;
  return new Uint8Array([0x02, content.length, ...content]);
}

/**
 * Build a DER-encoded ECDSA signature (the format WebAuthn returns).
 *
 * @param r — 32-byte big-endian R component
 * @param s — 32-byte big-endian S component
 */
function buildDerSignature(r: Uint8Array, s: Uint8Array): Uint8Array {
  const rDer = derInteger(r);
  const sDer = derInteger(s);
  const content = new Uint8Array([...rDer, ...sDer]);
  return new Uint8Array([0x30, content.length, ...content]);
}

/** Build a minimal CBOR-encoded COSE_Key for a P-256 public key. */
function buildCoseKey(x: Uint8Array, y: Uint8Array): Uint8Array {
  // Map with 4 entries: kty=2, alg=-7, crv=1, x=bytes, y=bytes
  // We encode manually using minimal CBOR:
  //   Map(5): 1→2, 3→-7, -1→1, -2→x(bstr), -3→y(bstr)
  function cborUint(n: number): number[] {
    if (n <= 23) return [n];
    if (n <= 255) return [0x18, n];
    return [0x19, (n >> 8) & 0xff, n & 0xff];
  }
  function cborNeg(n: number): number[] {
    // Negative integers: major type 1 (0x20 | ...), value is -1 - n
    const v = -1 - n;
    if (v <= 23) return [0x20 | v];
    return [0x38, v];
  }
  function cborBytes(bytes: Uint8Array): number[] {
    return [0x40 | bytes.length, ...bytes];
  }

  const pairs: number[] = [
    ...cborUint(1), ...cborUint(2),   // kty = 2 (EC2)
    ...cborUint(3), ...cborNeg(7),    // alg = -7 (ES256)
    ...cborNeg(1), ...cborUint(1),    // crv = 1 (P-256) — key -1
    ...cborNeg(2), ...cborBytes(x),   // x coordinate — key -2
    ...cborNeg(3), ...cborBytes(y),   // y coordinate — key -3
  ];

  // Map header: 0xa0 | numPairs (5)
  return new Uint8Array([0xa5, ...pairs]);
}

/** Hex string to Uint8Array */
function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Uint8Array to hex string */
function toHex(buf: Uint8Array): string {
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---------------------------------------------------------------------------
// 1. parseAuthenticatorDataFlags
// ---------------------------------------------------------------------------

describe("parseAuthenticatorDataFlags", () => {
  it("parses UP=1, UV=1 correctly", () => {
    const authData = buildAuthenticatorData({
      userPresence: true,
      userVerification: true,
    });
    const flags = parseAuthenticatorDataFlags(authData);
    expect(flags.userPresence).toBe(true);
    expect(flags.userVerification).toBe(true);
    expect(flags.attestedCredentialData).toBe(false);
    expect(flags.extensionData).toBe(false);
    expect(flags.raw).toBe(0x05); // 0x01 | 0x04
  });

  it("parses UP=1, UV=0 correctly", () => {
    const authData = buildAuthenticatorData({
      userPresence: true,
      userVerification: false,
    });
    const flags = parseAuthenticatorDataFlags(authData);
    expect(flags.userPresence).toBe(true);
    expect(flags.userVerification).toBe(false);
    expect(flags.raw).toBe(0x01);
  });

  it("parses UP=0, UV=0 (no interaction)", () => {
    const authData = buildAuthenticatorData({
      userPresence: false,
      userVerification: false,
    });
    const flags = parseAuthenticatorDataFlags(authData);
    expect(flags.userPresence).toBe(false);
    expect(flags.userVerification).toBe(false);
    expect(flags.raw).toBe(0x00);
  });

  it("parses attested credential data and extension flags", () => {
    const authData = buildAuthenticatorData({
      userPresence: true,
      userVerification: true,
      attestedCredentialData: true,
      extensionData: true,
    });
    const flags = parseAuthenticatorDataFlags(authData);
    expect(flags.attestedCredentialData).toBe(true);
    expect(flags.extensionData).toBe(true);
    // 0x01 | 0x04 | 0x40 | 0x80 = 0xC5
    expect(flags.raw).toBe(0xc5);
  });

  it("throws when authenticatorData is too short", () => {
    const short = new Uint8Array(10);
    expect(() => parseAuthenticatorDataFlags(short)).toThrow(
      /too short/,
    );
  });
});

// ---------------------------------------------------------------------------
// 2. validateAuthenticatorDataFlags
// ---------------------------------------------------------------------------

describe("validateAuthenticatorDataFlags — FIDO2 UP/UV validation (issue #2039)", () => {
  const validFlags = {
    userPresence: true,
    userVerification: true,
    attestedCredentialData: false,
    extensionData: false,
    raw: 0x05,
  };

  it("passes when UP and UV are both set (TouchID / FaceID flow)", () => {
    expect(() => validateAuthenticatorDataFlags(validFlags, true)).not.toThrow();
  });

  it("passes when UV is not required and only UP is set (security key without PIN)", () => {
    const noUv = { ...validFlags, userVerification: false, raw: 0x01 };
    expect(() => validateAuthenticatorDataFlags(noUv, false)).not.toThrow();
  });

  it("throws when UP flag is missing", () => {
    const noUp = { ...validFlags, userPresence: false, raw: 0x04 };
    expect(() => validateAuthenticatorDataFlags(noUp, true)).toThrow(
      /User Presence/,
    );
  });

  it("throws when UV is required but not set", () => {
    const noUv = { ...validFlags, userVerification: false, raw: 0x01 };
    expect(() => validateAuthenticatorDataFlags(noUv, true)).toThrow(
      /User Verification/,
    );
  });

  it("throws when both UP and UV are missing", () => {
    const noAuth = { ...validFlags, userPresence: false, userVerification: false, raw: 0x00 };
    expect(() => validateAuthenticatorDataFlags(noAuth, true)).toThrow(
      /User Presence/,
    );
  });
});

// ---------------------------------------------------------------------------
// 3. derToP1363 — IEEE P1363 conversion (core of issue #2039)
// ---------------------------------------------------------------------------

describe("derToP1363 — DER ECDSA → IEEE P1363 R||S conversion", () => {
  it("converts a typical secp256r1 signature correctly", () => {
    // Known R and S values (32 bytes each)
    const r = fromHex(
      "6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296",
    );
    const s = fromHex(
      "4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5",
    );
    const der = buildDerSignature(r, s);
    const p1363 = derToP1363(der);

    expect(p1363.length).toBe(64);
    expect(toHex(p1363.slice(0, 32))).toBe(toHex(r));
    expect(toHex(p1363.slice(32, 64))).toBe(toHex(s));
  });

  it("strips the DER leading 0x00 high byte from R (high-bit set)", () => {
    // R has high bit set → DER will add 0x00 prefix
    const rWithHighBit = new Uint8Array(32);
    rWithHighBit[0] = 0x80; // triggers sign-extension padding in DER
    const s = new Uint8Array(32);
    s.fill(0x01);

    const der = buildDerSignature(rWithHighBit, s);
    const p1363 = derToP1363(der);

    expect(p1363.length).toBe(64);
    expect(toHex(p1363.slice(0, 32))).toBe(toHex(rWithHighBit));
    expect(toHex(p1363.slice(32, 64))).toBe(toHex(s));
  });

  it("strips the DER leading 0x00 high byte from S (high-bit set)", () => {
    const r = new Uint8Array(32);
    r.fill(0x01);
    const sWithHighBit = new Uint8Array(32);
    sWithHighBit[0] = 0xff; // high bit set

    const der = buildDerSignature(r, sWithHighBit);
    const p1363 = derToP1363(der);

    expect(p1363.length).toBe(64);
    expect(toHex(p1363.slice(0, 32))).toBe(toHex(r));
    expect(toHex(p1363.slice(32, 64))).toBe(toHex(sWithHighBit));
  });

  it("zero-pads R or S that are shorter than 32 bytes", () => {
    // A short r value: 16 bytes, all 0x01
    const shortR = new Uint8Array(16).fill(0x01);
    const fullS = new Uint8Array(32).fill(0x02);

    const der = buildDerSignature(shortR, fullS);
    const p1363 = derToP1363(der);

    expect(p1363.length).toBe(64);
    // R should be zero-padded on the left
    expect(toHex(p1363.slice(0, 16))).toBe("00".repeat(16));
    expect(toHex(p1363.slice(16, 32))).toBe(toHex(shortR));
    expect(toHex(p1363.slice(32, 64))).toBe(toHex(fullS));
  });

  it("throws on invalid DER SEQUENCE tag", () => {
    const invalid = new Uint8Array([0x31, 0x40, 0x02, 0x20, ...new Uint8Array(32)]);
    expect(() => derToP1363(invalid)).toThrow(/SEQUENCE tag/);
  });

  it("throws on invalid INTEGER tag within sequence", () => {
    // Build a sequence with an invalid integer tag (0x03 instead of 0x02)
    const r = new Uint8Array(32).fill(0x01);
    const der = new Uint8Array([
      0x30, 34,
      0x03, 32, // wrong tag
      ...r,
    ]);
    expect(() => derToP1363(der)).toThrow(/INTEGER tag/);
  });
});

// ---------------------------------------------------------------------------
// 4. extractP256PublicKeyFromCoseKey
// ---------------------------------------------------------------------------

describe("extractP256PublicKeyFromCoseKey — COSE_Key P-256 extraction", () => {
  const x = fromHex(
    "6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296",
  );
  const y = fromHex(
    "4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5",
  );

  it("extracts X, Y and builds uncompressed key (04 || X || Y)", () => {
    const coseKey = buildCoseKey(x, y);
    const result = extractP256PublicKeyFromCoseKey(coseKey);

    expect(toHex(result.x)).toBe(toHex(x));
    expect(toHex(result.y)).toBe(toHex(y));
    expect(result.uncompressedHex.startsWith("04")).toBe(true);
    expect(result.uncompressedHex.length).toBe(130); // 65 bytes = 130 hex chars
    expect(result.uncompressedHex.slice(2, 66)).toBe(toHex(x));
    expect(result.uncompressedHex.slice(66)).toBe(toHex(y));
  });

  it("throws when kty is not EC2 (2)", () => {
    // Build a COSE_Key with kty=1 (OKP — wrong type)
    const wrongKty = new Uint8Array([
      0xa1, // map(1)
      0x01, 0x01, // kty = 1 (OKP)
    ]);
    expect(() => extractP256PublicKeyFromCoseKey(wrongKty)).toThrow(
      /kty/,
    );
  });
});

// ---------------------------------------------------------------------------
// 5. assemblePasskeyXdrPayload / disassemblePasskeyXdrPayload round-trip
// ---------------------------------------------------------------------------

describe("assemblePasskeyXdrPayload / disassemblePasskeyXdrPayload", () => {
  const makePayload = (): PasskeySignaturePayload => ({
    signatureHex: "aa".repeat(64), // 64 bytes
    authenticatorDataHex: "bb".repeat(37),
    clientDataJSONHex: "cc".repeat(80),
    credentialId: "test-cred-id",
    flags: {
      userPresence: true,
      userVerification: true,
      attestedCredentialData: false,
      extensionData: false,
      raw: 0x05,
    },
  });

  it("round-trips assemble → disassemble without data loss", () => {
    const payload = makePayload();
    const hex = assemblePasskeyXdrPayload(payload);
    const { signature, authenticatorData, clientDataJSON } =
      disassemblePasskeyXdrPayload(hex);

    expect(toHex(signature)).toBe(payload.signatureHex);
    expect(toHex(authenticatorData)).toBe(payload.authenticatorDataHex);
    expect(toHex(clientDataJSON)).toBe(payload.clientDataJSONHex);
  });

  it("assembled payload starts with 0x0040 (sig len = 64)", () => {
    const payload = makePayload();
    const hex = assemblePasskeyXdrPayload(payload);
    expect(hex.slice(0, 4)).toBe("0040"); // 0x0040 = 64
  });

  it("throws when signature is not 64 bytes", () => {
    const badPayload: PasskeySignaturePayload = {
      ...makePayload(),
      signatureHex: "aa".repeat(32), // 32 bytes — wrong
    };
    expect(() => assemblePasskeyXdrPayload(badPayload)).toThrow(/64 bytes/);
  });

  it("throws when disassembling a payload with wrong sig length prefix", () => {
    const badHex = "0020" + "aa".repeat(32); // length prefix says 32 instead of 64
    expect(() => disassemblePasskeyXdrPayload(badHex)).toThrow(
      /64-byte signature/,
    );
  });
});

// ---------------------------------------------------------------------------
// 6. PasskeyAdapter — unit tests (mocked WebAuthn APIs)
// ---------------------------------------------------------------------------

describe("PasskeyAdapter — registration handshake (simulated TouchID / FaceID)", () => {
  let adapter: PasskeyAdapter;
  let mockCredentials: {
    create: jest.Mock;
    get: jest.Mock;
    store?: jest.Mock;
    preventSilentAccess?: jest.Mock;
  };

  const r = new Uint8Array(32).fill(0x11);
  const s = new Uint8Array(32).fill(0x22);
  const credIdBytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);

  // Build a synthetic attestation response
  const buildAttestationResponse = () => {
    const authData = buildAuthenticatorData({
      userPresence: true,
      userVerification: true,
    });

    const clientDataJSON = new TextEncoder().encode(
      JSON.stringify({
        type: "webauthn.create",
        challenge: "dGVzdA==",
        origin: "http://localhost",
      }),
    );

    return {
      getAuthenticatorData: () => authData.buffer,
      getPublicKey: () => null, // force COSE_Key fallback
      clientDataJSON: clientDataJSON.buffer,
      attestationObject: new ArrayBuffer(0),
    };
  };

  const buildAssertionResponse = (
    up: boolean,
    uv: boolean,
  ) => {
    const authData = buildAuthenticatorData({
      userPresence: up,
      userVerification: uv,
    });

    const der = buildDerSignature(r, s);
    const clientDataJSON = new TextEncoder().encode(
      JSON.stringify({
        type: "webauthn.get",
        challenge: "dGVzdA==",
        origin: "http://localhost",
      }),
    );

    return {
      authenticatorData: authData.buffer,
      signature: der.buffer,
      clientDataJSON: clientDataJSON.buffer,
      userHandle: null,
    };
  };

  beforeEach(() => {
    adapter = new PasskeyAdapter({ rpId: "localhost" });

    mockCredentials = {
      create: jest.fn(),
      get: jest.fn(),
    };

    // Mock PublicKeyCredential availability
    Object.defineProperty(global, "PublicKeyCredential", {
      value: class MockPublicKeyCredential {
        rawId: ArrayBuffer;
        response: unknown;
        type = "public-key";
        id: string;
        constructor(rawId: ArrayBuffer, response: unknown) {
          this.rawId = rawId;
          this.response = response;
          this.id = "mock-id";
        }
      },
      configurable: true,
      writable: true,
    });

    Object.defineProperty(global, "AuthenticatorAttestationResponse", {
      value: class MockAttestationResponse {},
      configurable: true,
      writable: true,
    });

    Object.defineProperty(global, "AuthenticatorAssertionResponse", {
      value: class MockAssertionResponse {},
      configurable: true,
      writable: true,
    });

    // Mock crypto.getRandomValues
    Object.defineProperty(global, "crypto", {
      value: {
        getRandomValues: (arr: Uint8Array) => {
          arr.fill(0x42);
          return arr;
        },
        subtle: {
          digest: jest.fn().mockResolvedValue(new Uint8Array(32).fill(0x55).buffer),
        },
      },
      configurable: true,
    });

    // Mock localStorage
    const store: Record<string, string> = {};
    Object.defineProperty(global, "localStorage", {
      value: {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, val: string) => { store[key] = val; },
        removeItem: (key: string) => { delete store[key]; },
        clear: () => { for (const k in store) delete store[k]; },
      },
      configurable: true,
    });

    Object.defineProperty(global.navigator, "credentials", {
      value: mockCredentials,
      configurable: true,
    });
  });

  it("isAvailable() returns true when PublicKeyCredential and navigator.credentials exist", () => {
    expect(adapter.isAvailable()).toBe(true);
  });

  it("isAvailable() returns false in non-browser environment", () => {
    const ssrAdapter = new PasskeyAdapter({ rpId: "localhost" });
    // Temporarily remove PublicKeyCredential
    const original = global.PublicKeyCredential;
    // @ts-expect-error – intentional for test
    delete global.PublicKeyCredential;
    expect(ssrAdapter.isAvailable()).toBe(false);
    global.PublicKeyCredential = original;
  });

  it("registerCredential() builds a valid registration ceremony and stores credentialId", async () => {
    const attResponse = buildAttestationResponse();
    const MockAttestation = global.AuthenticatorAttestationResponse;
    Object.setPrototypeOf(attResponse, MockAttestation.prototype);

    const MockCred = global.PublicKeyCredential;
    const mockCredential = Object.create(MockCred.prototype);
    mockCredential.rawId = credIdBytes.buffer;
    mockCredential.response = attResponse;

    mockCredentials.create.mockResolvedValue(mockCredential);

    const result = await adapter.registerCredential({
      displayName: "TouchID Test Account",
    });

    expect(mockCredentials.create).toHaveBeenCalledWith(
      expect.objectContaining({
        publicKey: expect.objectContaining({
          rp: expect.objectContaining({ id: "localhost" }),
          pubKeyCredParams: expect.arrayContaining([
            expect.objectContaining({ alg: -7 }), // P-256 / ES256
          ]),
          authenticatorSelection: expect.objectContaining({
            userVerification: "required",
          }),
        }),
      }),
    );

    expect(result.credentialId).toBeTruthy();
    // Credential id should be stored in localStorage
    expect(adapter.hasStoredCredential()).toBe(true);
    expect(adapter.getStoredCredentialId()).toBe(result.credentialId);
  });

  it("registerCredential() throws when WebAuthn is not available", async () => {
    const original = global.PublicKeyCredential;
    // @ts-expect-error – intentional for test
    delete global.PublicKeyCredential;
    await expect(
      adapter.registerCredential({ displayName: "Test" }),
    ).rejects.toThrow(/not available/);
    global.PublicKeyCredential = original;
  });

  it("connect() performs assertion and validates UP + UV flags", async () => {
    // Store a credential id first
    global.localStorage.setItem("soroban_passkey_credential_id", "dGVzdA");

    const assertResponse = buildAssertionResponse(true, true);
    const MockAssertion = global.AuthenticatorAssertionResponse;
    Object.setPrototypeOf(assertResponse, MockAssertion.prototype);

    const MockCred = global.PublicKeyCredential;
    const mockAssertion = Object.create(MockCred.prototype);
    mockAssertion.rawId = credIdBytes.buffer;
    mockAssertion.response = assertResponse;

    mockCredentials.get.mockResolvedValue(mockAssertion);

    const result = await adapter.connect();
    expect(result.address).toBeTruthy();
    expect(result.allAccounts).toHaveLength(1);
  });

  it("connect() rejects when UP flag is not set (synthetic failed biometric)", async () => {
    global.localStorage.setItem("soroban_passkey_credential_id", "dGVzdA");

    const assertResponse = buildAssertionResponse(false, true); // UP=0
    const MockAssertion = global.AuthenticatorAssertionResponse;
    Object.setPrototypeOf(assertResponse, MockAssertion.prototype);

    const MockCred = global.PublicKeyCredential;
    const mockAssertion = Object.create(MockCred.prototype);
    mockAssertion.rawId = credIdBytes.buffer;
    mockAssertion.response = assertResponse;

    mockCredentials.get.mockResolvedValue(mockAssertion);

    await expect(adapter.connect()).rejects.toThrow(/User Presence/);
  });

  it("connect() rejects when UV flag is not set and userVerification is 'required'", async () => {
    global.localStorage.setItem("soroban_passkey_credential_id", "dGVzdA");

    const assertResponse = buildAssertionResponse(true, false); // UV=0
    const MockAssertion = global.AuthenticatorAssertionResponse;
    Object.setPrototypeOf(assertResponse, MockAssertion.prototype);

    const MockCred = global.PublicKeyCredential;
    const mockAssertion = Object.create(MockCred.prototype);
    mockAssertion.rawId = credIdBytes.buffer;
    mockAssertion.response = assertResponse;

    mockCredentials.get.mockResolvedValue(mockAssertion);

    await expect(adapter.connect()).rejects.toThrow(/User Verification/);
  });
});

// ---------------------------------------------------------------------------
// 7. PasskeyAdapter — signTransaction handshake
// ---------------------------------------------------------------------------

describe("PasskeyAdapter — signing handshake (simulated TouchID / FaceID)", () => {
  let adapter: PasskeyAdapter;

  const r = new Uint8Array(32);
  r.fill(0xaa);
  const s = new Uint8Array(32);
  s.fill(0xbb);

  const credIdBytes = new Uint8Array([0xca, 0xfe, 0xba, 0xbe]);

  const buildMockAssertion = (up: boolean, uv: boolean) => {
    const authData = buildAuthenticatorData({
      userPresence: up,
      userVerification: uv,
    });
    const der = buildDerSignature(r, s);
    const clientDataJSON = new TextEncoder().encode(
      JSON.stringify({ type: "webauthn.get", challenge: "abc", origin: "http://localhost" }),
    );

    const assertResponse = {
      authenticatorData: authData.buffer,
      signature: der.buffer,
      clientDataJSON: clientDataJSON.buffer,
      userHandle: null,
    };

    Object.setPrototypeOf(
      assertResponse,
      global.AuthenticatorAssertionResponse.prototype,
    );

    const credential = Object.create(global.PublicKeyCredential.prototype);
    credential.rawId = credIdBytes.buffer;
    credential.response = assertResponse;
    return credential;
  };

  beforeEach(() => {
    adapter = new PasskeyAdapter({ rpId: "localhost" });

    Object.defineProperty(global, "PublicKeyCredential", {
      value: class MockPublicKeyCredential {},
      configurable: true,
      writable: true,
    });
    Object.defineProperty(global, "AuthenticatorAssertionResponse", {
      value: class MockAssertionResponse {},
      configurable: true,
      writable: true,
    });
    Object.defineProperty(global, "AuthenticatorAttestationResponse", {
      value: class MockAttestationResponse {},
      configurable: true,
      writable: true,
    });

    const store: Record<string, string> = {
      soroban_passkey_credential_id: "Y2FmZWJhYmU", // base64url for the cred
    };
    Object.defineProperty(global, "localStorage", {
      value: {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => { store[k] = v; },
        removeItem: (k: string) => { delete store[k]; },
      },
      configurable: true,
    });

    Object.defineProperty(global, "crypto", {
      value: {
        getRandomValues: (arr: Uint8Array) => { arr.fill(0x42); return arr; },
        subtle: {
          digest: jest.fn().mockResolvedValue(new Uint8Array(32).fill(0x55).buffer),
        },
      },
      configurable: true,
    });

    Object.defineProperty(global.navigator, "credentials", {
      value: { get: jest.fn() },
      configurable: true,
    });
  });

  it("signTransaction() returns a JSON payload with 64-byte P1363 signature (R||S)", async () => {
    (navigator.credentials.get as jest.Mock).mockResolvedValue(
      buildMockAssertion(true, true),
    );

    const xdr = "dGVzdA=="; // dummy base64 xdr
    const resultJson = await adapter.signTransaction(xdr);
    expect(resultJson).not.toBeNull();

    const payload: PasskeySignaturePayload = JSON.parse(resultJson!);
    expect(payload.signatureHex).toHaveLength(128); // 64 bytes = 128 hex chars
    expect(payload.signatureHex.slice(0, 64)).toBe(toHex(r));
    expect(payload.signatureHex.slice(64)).toBe(toHex(s));
    expect(payload.authenticatorDataHex).toBeTruthy();
    expect(payload.clientDataJSONHex).toBeTruthy();
    expect(payload.flags.userPresence).toBe(true);
    expect(payload.flags.userVerification).toBe(true);
    expect(payload.credentialId).toBeTruthy();
  });

  it("signTransaction() rejects when UP flag is not set", async () => {
    (navigator.credentials.get as jest.Mock).mockResolvedValue(
      buildMockAssertion(false, true),
    );

    await expect(adapter.signTransaction("dGVzdA==")).rejects.toThrow(
      /User Presence/,
    );
  });

  it("signTransaction() rejects when UV flag is not set and userVerification is 'required'", async () => {
    (navigator.credentials.get as jest.Mock).mockResolvedValue(
      buildMockAssertion(true, false),
    );

    await expect(adapter.signTransaction("dGVzdA==")).rejects.toThrow(
      /User Verification/,
    );
  });

  it("signTransaction() rejects when no stored credential exists", async () => {
    global.localStorage.removeItem("soroban_passkey_credential_id");
    await expect(adapter.signTransaction("dGVzdA==")).rejects.toThrow(
      /No passkey credential/,
    );
  });

  it("signTransaction() passes the transaction SHA-256 hash as the WebAuthn challenge", async () => {
    (navigator.credentials.get as jest.Mock).mockResolvedValue(
      buildMockAssertion(true, true),
    );

    await adapter.signTransaction("dGVzdA==");

    // The challenge passed to credentials.get should be a 32-byte Uint8Array
    // derived from the hash of the XDR transaction
    const call = (navigator.credentials.get as jest.Mock).mock.calls[0][0];
    const challenge = call.publicKey.challenge as Uint8Array;
    // Our mocked subtle.digest returns 32 bytes of 0x55
    expect(challenge).toBeInstanceOf(Uint8Array);
    expect(challenge.length).toBe(32);
  });

  it("signTransaction() assembles a valid XDR payload disassemblable without data loss", async () => {
    (navigator.credentials.get as jest.Mock).mockResolvedValue(
      buildMockAssertion(true, true),
    );

    const resultJson = await adapter.signTransaction("dGVzdA==");
    const payload: PasskeySignaturePayload = JSON.parse(resultJson!);
    const xdrHex = assemblePasskeyXdrPayload(payload);
    const { signature, authenticatorData, clientDataJSON } =
      disassemblePasskeyXdrPayload(xdrHex);

    expect(toHex(signature)).toBe(payload.signatureHex);
    expect(toHex(authenticatorData)).toBe(payload.authenticatorDataHex);
    expect(toHex(clientDataJSON)).toBe(payload.clientDataJSONHex);
  });
});

// ---------------------------------------------------------------------------
// 8. disconnect / credential management
// ---------------------------------------------------------------------------

describe("PasskeyAdapter — disconnect and credential management", () => {
  let adapter: PasskeyAdapter;
  const store: Record<string, string> = {};

  beforeEach(() => {
    adapter = new PasskeyAdapter({ rpId: "localhost" });
    Object.defineProperty(global, "localStorage", {
      value: {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => { store[k] = v; },
        removeItem: (k: string) => { delete store[k]; },
        clear: () => { for (const k in store) delete store[k]; },
      },
      configurable: true,
    });
    // Clear store before each test
    for (const k in store) delete store[k];
  });

  it("hasStoredCredential() returns false when nothing is stored", () => {
    expect(adapter.hasStoredCredential()).toBe(false);
  });

  it("hasStoredCredential() returns true after a credential is stored", () => {
    store["soroban_passkey_credential_id"] = "test-id";
    expect(adapter.hasStoredCredential()).toBe(true);
  });

  it("getStoredCredentialId() returns the stored credential id", () => {
    store["soroban_passkey_credential_id"] = "my-cred";
    expect(adapter.getStoredCredentialId()).toBe("my-cred");
  });

  it("disconnect() removes the stored credential id", () => {
    store["soroban_passkey_credential_id"] = "my-cred";
    adapter.disconnect();
    expect(adapter.hasStoredCredential()).toBe(false);
    expect(store["soroban_passkey_credential_id"]).toBeUndefined();
  });

  it("clearStoredCredential() is equivalent to disconnect for credential removal", () => {
    store["soroban_passkey_credential_id"] = "my-cred";
    adapter.clearStoredCredential();
    expect(adapter.hasStoredCredential()).toBe(false);
  });

  it("getNetwork() returns TESTNET", async () => {
    expect(await adapter.getNetwork()).toBe("TESTNET");
  });
});

// ---------------------------------------------------------------------------
// 9. Wallet registry integration
// ---------------------------------------------------------------------------

describe("WalletAdapterRegistry — passkey adapter integration", () => {
  it("walletRegistry contains the passkey adapter", () => {
    const all = walletRegistry.getAll();
    const passkeyEntry = all.find((a) => a.id === "passkey");
    expect(passkeyEntry).toBeDefined();
    expect(passkeyEntry?.name).toMatch(/passkey/i);
  });

  it("walletRegistry.get('passkey') returns a PasskeyAdapter instance", () => {
    const adapter = walletRegistry.get("passkey");
    expect(adapter).toBeDefined();
    expect(adapter).toBeInstanceOf(PasskeyAdapter);
  });

  it("passkeyAdapter singleton is a PasskeyAdapter", () => {
    expect(passkeyAdapter).toBeInstanceOf(PasskeyAdapter);
    expect(passkeyAdapter.id).toBe("passkey");
    expect(passkeyAdapter.typeBadge).toBe("Biometric");
  });
});
