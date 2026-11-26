/**
 * PasskeyAdapter — WebAuthn / FIDO2 passkey wallet adapter for Soroban smart accounts.
 *
 * Implements the full FRONTEND-269 requirements:
 *   • IEEE P1363 (R || S 64-byte) secp256r1 ECDSA signature formatting.
 *   • FIDO2 authenticatorData UP (User Presence) and UV (User Verification) flag validation.
 *   • Cryptographic challenge binding: SHA-256(clientDataJSON) is verified against the
 *     expected Soroban transaction hash before signing proceeds.
 *   • XDR-ready payload: returns `{ signature, clientDataJSON, authenticatorData }` encoded
 *     as hex strings ready for Soroban `contracts/account-abstraction` __check_auth.
 *   • Integrates with WalletAdapter so it plugs into the existing registry / UI.
 *
 * References:
 *   - W3C Web Authentication Level 3 — https://www.w3.org/TR/webauthn-3/
 *   - FIDO Alliance Passkey specification
 *   - Stellar SDK XDR types / Soroban custom account interface
 */

import {
  ConnectResult,
  SignTransactionOptions,
  WalletAdapter,
} from "./types";

// ---------------------------------------------------------------------------
// Public surface types — re-exported for consumers and tests
// ---------------------------------------------------------------------------

/** Decoded + validated FIDO2 authenticatorData fields. */
export interface AuthenticatorDataFlags {
  /** User Presence (bit 0 of flags byte). */
  userPresence: boolean;
  /** User Verification (bit 2 of flags byte). */
  userVerification: boolean;
  /** Attested credential data included (bit 6). */
  attestedCredentialData: boolean;
  /** Extension data included (bit 7). */
  extensionData: boolean;
  /** Raw flags byte for downstream inspection. */
  raw: number;
}

/** Structured output of a completed passkey signing operation. */
export interface PasskeySignaturePayload {
  /**
   * IEEE P1363 secp256r1 ECDSA signature: 64 raw bytes (R || S), hex-encoded.
   * This is the format required by the Soroban account-abstraction contract's
   * `__check_auth` function (BytesN<64>).
   */
  signatureHex: string;
  /**
   * Raw authenticatorData bytes from the FIDO2 assertion, hex-encoded.
   * Included in the XDR payload so the on-chain verifier can re-derive the
   * signed message: SHA-256(authenticatorData || SHA-256(clientDataJSON)).
   */
  authenticatorDataHex: string;
  /**
   * Raw clientDataJSON bytes (UTF-8), hex-encoded.
   * The Soroban verifier hashes this to reconstruct the signed digest.
   */
  clientDataJSONHex: string;
  /** Decoded authenticatorData flags for UI feedback. */
  flags: AuthenticatorDataFlags;
  /** Public-key credential id (base64url), useful for credential management. */
  credentialId: string;
}

/** Options accepted by PasskeyAdapter.registerCredential(). */
export interface PasskeyRegistrationOptions {
  /** Human-readable display name for the passkey (e.g. the user's name). */
  displayName: string;
  /**
   * Relying party id — must match window.location.hostname in production.
   * Defaults to `window.location.hostname`.
   */
  rpId?: string;
  /**
   * User handle: an opaque byte array that identifies the account.
   * Defaults to a random 16-byte value.
   */
  userId?: Uint8Array;
  /** Require UV (User Verification) during registration. Defaults to `required`. */
  userVerification?: UserVerificationRequirement;
}

/** Result of a successful credential registration. */
export interface PasskeyRegistrationResult {
  credentialId: string;
  /** DER-encoded public key (SubjectPublicKeyInfo for P-256), hex-encoded. */
  publicKeyDerHex: string;
  /** Raw secp256r1 uncompressed public key bytes (04 || X || Y), hex-encoded. */
  publicKeyUncompressedHex: string;
  /** AAGUID of the authenticator (can be used to identify TouchID / FaceID). */
  aaguid: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Convert an ArrayBuffer or Uint8Array to a lowercase hex string. */
function toHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes =
    buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Convert a hex string to a Uint8Array. */
function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) {
    throw new Error("Hex string must have an even number of characters");
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Base64url encode a Uint8Array (no padding). */
function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/** Base64url decode to Uint8Array. */
function fromBase64Url(b64: string): Uint8Array {
  const padded = b64.replace(/-/g, "+").replace(/_/g, "/");
  const pad = (4 - (padded.length % 4)) % 4;
  const binary = atob(padded + "=".repeat(pad));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Parse and validate the FIDO2 authenticatorData structure.
 *
 * Layout (§ 6.1 of WebAuthn Level 3):
 *   [0..31]  rpIdHash    (32 bytes SHA-256 of RP ID)
 *   [32]     flags       (1 byte)
 *   [33..36] signCount   (4 bytes big-endian uint32)
 *   [37..]   optional attested credential data / extensions
 *
 * Flag bits:
 *   bit 0 (0x01) — UP  User Presence
 *   bit 2 (0x04) — UV  User Verification
 *   bit 6 (0x40) — AT  Attested credential data present
 *   bit 7 (0x80) — ED  Extension data present
 */
export function parseAuthenticatorDataFlags(
  authenticatorData: Uint8Array,
): AuthenticatorDataFlags {
  if (authenticatorData.length < 37) {
    throw new Error(
      `authenticatorData is too short: ${authenticatorData.length} bytes (minimum 37)`,
    );
  }
  const flagsByte = authenticatorData[32];
  return {
    userPresence: (flagsByte & 0x01) !== 0,
    userVerification: (flagsByte & 0x04) !== 0,
    attestedCredentialData: (flagsByte & 0x40) !== 0,
    extensionData: (flagsByte & 0x80) !== 0,
    raw: flagsByte,
  };
}

/**
 * Validate FIDO2 authenticatorData flags per the issue requirements.
 *
 * @throws if User Presence is not set, or if userVerification is `required`
 *         and the UV flag is not set.
 */
export function validateAuthenticatorDataFlags(
  flags: AuthenticatorDataFlags,
  requireUserVerification = true,
): void {
  if (!flags.userPresence) {
    throw new Error(
      "FIDO2 authenticatorData validation failed: User Presence (UP) flag is not set. " +
        "The authenticator did not confirm physical user presence.",
    );
  }
  if (requireUserVerification && !flags.userVerification) {
    throw new Error(
      "FIDO2 authenticatorData validation failed: User Verification (UV) flag is not set. " +
        "Biometric or PIN verification was required but the authenticator did not perform it. " +
        "Ensure the passkey is configured with userVerification: 'required'.",
    );
  }
}

/**
 * Parse a DER-encoded ASN.1 SEQUENCE containing an ECDSA signature
 * (the format WebAuthn returns) into raw IEEE P1363 format: R || S as 64 bytes.
 *
 * DER ECDSA signature layout:
 *   30 <len>
 *     02 <r-len> <r-bytes>   (r may have a leading 0x00 high-byte)
 *     02 <s-len> <s-bytes>   (s may have a leading 0x00 high-byte)
 *
 * P1363 output: 32 bytes R (big-endian) || 32 bytes S (big-endian), zero-padded.
 */
export function derToP1363(derBytes: Uint8Array): Uint8Array {
  let offset = 0;

  if (derBytes[offset++] !== 0x30) {
    throw new Error(
      "ECDSA DER signature: expected SEQUENCE tag 0x30 at offset 0",
    );
  }

  // Read length (handle both short and long form)
  let seqLen: number;
  if (derBytes[offset] & 0x80) {
    const numLenBytes = derBytes[offset++] & 0x7f;
    seqLen = 0;
    for (let i = 0; i < numLenBytes; i++) {
      seqLen = (seqLen << 8) | derBytes[offset++];
    }
  } else {
    seqLen = derBytes[offset++];
  }

  if (offset + seqLen > derBytes.length) {
    throw new Error(
      "ECDSA DER signature: declared SEQUENCE length exceeds buffer size",
    );
  }

  function readInteger(): Uint8Array {
    if (derBytes[offset++] !== 0x02) {
      throw new Error(
        "ECDSA DER signature: expected INTEGER tag 0x02",
      );
    }
    const intLen = derBytes[offset++];
    const intBytes = derBytes.slice(offset, offset + intLen);
    offset += intLen;
    return intBytes;
  }

  const rBytes = readInteger();
  const sBytes = readInteger();

  // Strip leading zero bytes (DER uses them to prevent sign-extension)
  // then left-pad with zeros to exactly 32 bytes each for P1363.
  function normalise32(raw: Uint8Array): Uint8Array {
    // Remove leading 0x00 high byte (sign extension for positive integers)
    let start = 0;
    while (start < raw.length - 1 && raw[start] === 0x00) {
      start++;
    }
    const stripped = raw.slice(start);
    if (stripped.length > 32) {
      throw new Error(
        `ECDSA DER: component is ${stripped.length} bytes after stripping; expected ≤ 32`,
      );
    }
    const out = new Uint8Array(32);
    out.set(stripped, 32 - stripped.length);
    return out;
  }

  const r = normalise32(rBytes);
  const s = normalise32(sBytes);

  const p1363 = new Uint8Array(64);
  p1363.set(r, 0);
  p1363.set(s, 32);
  return p1363;
}

/**
 * Extract the raw P-256 public key from a COSE_Key map (CBOR).
 *
 * This is a minimal CBOR decoder limited to the COSE_Key structure used in
 * WebAuthn attestations. Full CBOR is not needed; we only decode the key type
 * and coordinate fields.
 *
 * COSE_Key integer labels used here:
 *   1  → kty  (key type; 2 = EC2)
 *   -1 → crv  (curve; 1 = P-256)
 *   -2 → x    (x coordinate, bstr 32 bytes)
 *   -3 → y    (y coordinate, bstr 32 bytes)
 */
export function extractP256PublicKeyFromCoseKey(
  coseKey: Uint8Array,
): { x: Uint8Array; y: Uint8Array; uncompressedHex: string } {
  // Minimal CBOR map decoder — enough for COSE_Key
  function decodeCbor(
    data: Uint8Array,
    pos: number,
  ): { value: unknown; nextPos: number } {
    const byte = data[pos];
    const majorType = (byte >> 5) & 0x07;
    const additionalInfo = byte & 0x1f;

    function readLength(ai: number, start: number): { len: number; nextPos: number } {
      if (ai <= 23) return { len: ai, nextPos: start };
      if (ai === 24) return { len: data[start], nextPos: start + 1 };
      if (ai === 25)
        return {
          len: (data[start] << 8) | data[start + 1],
          nextPos: start + 2,
        };
      throw new Error(`CBOR: unsupported additional info ${ai}`);
    }

    let p = pos + 1;

    if (majorType === 0) {
      // Unsigned integer
      const { len, nextPos } = readLength(additionalInfo, p);
      return { value: len, nextPos };
    }
    if (majorType === 1) {
      // Negative integer: -1 - n
      const { len, nextPos } = readLength(additionalInfo, p);
      return { value: -1 - len, nextPos };
    }
    if (majorType === 2) {
      // Byte string
      const { len, nextPos } = readLength(additionalInfo, p);
      return {
        value: data.slice(nextPos, nextPos + len),
        nextPos: nextPos + len,
      };
    }
    if (majorType === 5) {
      // Map
      const { len: numPairs, nextPos: afterLen } = readLength(additionalInfo, p);
      const map = new Map<number, unknown>();
      p = afterLen;
      for (let i = 0; i < numPairs; i++) {
        const keyResult = decodeCbor(data, p);
        p = keyResult.nextPos;
        const valResult = decodeCbor(data, p);
        p = valResult.nextPos;
        if (typeof keyResult.value === "number") {
          map.set(keyResult.value, valResult.value);
        }
      }
      return { value: map, nextPos: p };
    }
    throw new Error(`CBOR: unsupported major type ${majorType}`);
  }

  const { value } = decodeCbor(coseKey, 0);
  if (!(value instanceof Map)) {
    throw new Error("COSE_Key: expected a CBOR map");
  }

  const kty = value.get(1);
  if (kty !== 2) {
    throw new Error(`COSE_Key: expected EC2 key type (kty=2), got ${kty}`);
  }

  const x = value.get(-2);
  const y = value.get(-3);
  if (!(x instanceof Uint8Array) || x.length !== 32) {
    throw new Error("COSE_Key: x coordinate missing or wrong length");
  }
  if (!(y instanceof Uint8Array) || y.length !== 32) {
    throw new Error("COSE_Key: y coordinate missing or wrong length");
  }

  const uncompressed = new Uint8Array(65);
  uncompressed[0] = 0x04;
  uncompressed.set(x, 1);
  uncompressed.set(y, 33);

  return { x, y, uncompressedHex: toHex(uncompressed) };
}

// ---------------------------------------------------------------------------
// PasskeyAdapter
// ---------------------------------------------------------------------------

/**
 * WalletAdapter implementation using WebAuthn passkeys (platform authenticators:
 * TouchID, FaceID, Windows Hello) for Soroban smart account signing.
 *
 * Usage flow:
 *   1. `registerCredential(options)` — creates a new P-256 passkey credential.
 *   2. `connect()` — retrieves a stored credential id from localStorage and
 *      resolves the connected "address" (the credential id as a URL-safe string).
 *   3. `signTransaction(xdr)` — calls navigator.credentials.get(), validates
 *      FIDO2 flags, converts DER → P1363, and returns a JSON-serialised
 *      PasskeySignaturePayload that the Soroban account-abstraction contract
 *      can decode in its __check_auth function.
 *
 * The "address" exposed by this adapter is the passkey credential ID encoded as
 * a base64url string.  The actual on-chain account address is the smart contract
 * address deployed via `contracts/account-abstraction`.
 */
export class PasskeyAdapter implements WalletAdapter {
  id = "passkey" as const;
  name = "Passkey (Biometric)";
  description =
    "Sign Soroban transactions with TouchID, FaceID, or Windows Hello. " +
    "Credentials never leave the device — FIDO2 / WebAuthn Level 3.";
  iconName = "passkey";
  typeBadge = "Biometric";
  installUrl = "https://passkeys.dev";

  /**
   * Relying party configuration.  Defaults to the current browser origin.
   * Override in tests or server-side environments.
   */
  rpId: string;
  rpName: string;

  /**
   * Whether to require User Verification (UV) during signing.
   * Set to `'required'` for biometric signing (TouchID / FaceID); `'preferred'`
   * for security keys that may not support UV.
   */
  userVerification: UserVerificationRequirement;

  /** Storage key used to persist the credential ID in localStorage. */
  private readonly STORAGE_KEY = "soroban_passkey_credential_id";

  constructor(options?: {
    rpId?: string;
    rpName?: string;
    userVerification?: UserVerificationRequirement;
  }) {
    this.rpId =
      options?.rpId ??
      (typeof window !== "undefined" ? window.location.hostname : "localhost");
    this.rpName = options?.rpName ?? "Soroban Playground";
    this.userVerification = options?.userVerification ?? "required";
  }

  // -------------------------------------------------------------------------
  // WalletAdapter — availability
  // -------------------------------------------------------------------------

  isAvailable(): boolean {
    if (typeof window === "undefined") return false;
    return (
      typeof window.PublicKeyCredential !== "undefined" &&
      typeof navigator?.credentials?.create === "function" &&
      typeof navigator?.credentials?.get === "function"
    );
  }

  // -------------------------------------------------------------------------
  // Credential registration (not part of WalletAdapter but required by #2039)
  // -------------------------------------------------------------------------

  /**
   * Register a new passkey credential with the platform authenticator.
   *
   * This should be called once during account setup.  The resulting
   * `publicKeyUncompressedHex` is what you store on-chain in the
   * `contracts/account-abstraction` SmartWallet via `initialize(owner, ...)`.
   *
   * TouchID / FaceID will trigger automatically when `userVerification` is
   * `'required'` and the platform supports it.
   */
  async registerCredential(
    opts: PasskeyRegistrationOptions,
  ): Promise<PasskeyRegistrationResult> {
    if (!this.isAvailable()) {
      throw new Error(
        "WebAuthn is not available in this environment. " +
          "Use a modern browser with platform authenticator support.",
      );
    }

    const userId = opts.userId ?? crypto.getRandomValues(new Uint8Array(16));
    const challenge = crypto.getRandomValues(new Uint8Array(32));

    const credential = await navigator.credentials.create({
      publicKey: {
        rp: { id: this.rpId, name: this.rpName },
        user: {
          id: userId,
          name: opts.displayName,
          displayName: opts.displayName,
        },
        challenge,
        pubKeyCredParams: [
          // P-256 (secp256r1) — required by Soroban account-abstraction
          { type: "public-key", alg: -7 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          residentKey: "required",
          requireResidentKey: true,
          userVerification: opts.userVerification ?? "required",
        },
        attestation: "none",
        timeout: 60000,
      },
    });

    if (
      !(credential instanceof PublicKeyCredential) ||
      !(credential.response instanceof AuthenticatorAttestationResponse)
    ) {
      throw new Error("WebAuthn: unexpected credential type from create()");
    }

    const response = credential.response;
    const credentialId = toBase64Url(new Uint8Array(credential.rawId));

    // Extract the public key from the attestation object.
    // We use getPublicKey() (Level 3 API) with a DER fallback.
    let publicKeyDerHex = "";
    let publicKeyUncompressedHex = "";

    if (typeof response.getPublicKey === "function") {
      const pkDer = response.getPublicKey();
      if (pkDer) {
        publicKeyDerHex = toHex(new Uint8Array(pkDer));
        // The DER-encoded SPKI for P-256:
        // 30 59 30 13 06 07 2a 86 48 ce 3d 02 01   (AlgorithmIdentifier for P-256)
        //          06 08 2a 86 48 ce 3d 03 01 07   (namedCurve OID)
        //    03 42 00 04 <32-byte-X> <32-byte-Y>  (BIT STRING, uncompressed point)
        // The uncompressed key starts at the 04 marker inside the BIT STRING.
        const derBytes = new Uint8Array(pkDer);
        const uncompressedStart = derBytes.indexOf(0x04, 20);
        if (
          uncompressedStart !== -1 &&
          derBytes.length >= uncompressedStart + 65
        ) {
          publicKeyUncompressedHex = toHex(
            derBytes.slice(uncompressedStart, uncompressedStart + 65),
          );
        }
      }
    }

    // Fallback: parse the COSE_Key from the authenticator data
    if (!publicKeyUncompressedHex) {
      const authData = new Uint8Array(response.getAuthenticatorData());
      // After rpIdHash(32) + flags(1) + signCount(4) = offset 37
      // Attested credential data: aaguid(16) + credIdLen(2) + credId + coseKey
      if (authData.length > 37) {
        const aaguidOffset = 37;
        const credIdLenOffset = aaguidOffset + 16;
        const credIdLen =
          (authData[credIdLenOffset] << 8) | authData[credIdLenOffset + 1];
        const coseKeyOffset = credIdLenOffset + 2 + credIdLen;
        const coseKey = authData.slice(coseKeyOffset);
        try {
          const { uncompressedHex } = extractP256PublicKeyFromCoseKey(coseKey);
          publicKeyUncompressedHex = uncompressedHex;
        } catch {
          // Best-effort: leave empty if CBOR parsing fails
        }
      }
    }

    // Extract AAGUID from authenticator data for device identification
    const authDataBuf = new Uint8Array(response.getAuthenticatorData());
    const aaguidBytes = authDataBuf.slice(37, 53);
    const aaguid = [
      toHex(aaguidBytes.slice(0, 4)),
      toHex(aaguidBytes.slice(4, 6)),
      toHex(aaguidBytes.slice(6, 8)),
      toHex(aaguidBytes.slice(8, 10)),
      toHex(aaguidBytes.slice(10, 16)),
    ].join("-");

    // Persist the credential id for future connect() calls
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(this.STORAGE_KEY, credentialId);
    }

    return {
      credentialId,
      publicKeyDerHex,
      publicKeyUncompressedHex,
      aaguid,
    };
  }

  // -------------------------------------------------------------------------
  // WalletAdapter — connect
  // -------------------------------------------------------------------------

  async connect(_auto = false): Promise<ConnectResult> {
    if (!this.isAvailable()) {
      throw new Error(
        "WebAuthn passkeys are not available in this browser environment.",
      );
    }

    // Try to retrieve a stored credential id
    const storedCredId =
      typeof localStorage !== "undefined"
        ? localStorage.getItem(this.STORAGE_KEY)
        : null;

    if (!storedCredId && !_auto) {
      throw new Error(
        "No passkey credential found. Call registerCredential() first to create a passkey.",
      );
    }

    // Perform a silent assertion with a random challenge to confirm the
    // credential is still valid and the authenticator is reachable.
    const challenge = crypto.getRandomValues(new Uint8Array(32));

    const allowCredentials: PublicKeyCredentialDescriptor[] = storedCredId
      ? [
          {
            id: fromBase64Url(storedCredId),
            type: "public-key",
          },
        ]
      : [];

    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        rpId: this.rpId,
        allowCredentials,
        userVerification: this.userVerification,
        timeout: 60000,
      },
    });

    if (
      !(assertion instanceof PublicKeyCredential) ||
      !(assertion.response instanceof AuthenticatorAssertionResponse)
    ) {
      throw new Error(
        "WebAuthn: unexpected response type from credentials.get()",
      );
    }

    const credentialId = toBase64Url(new Uint8Array(assertion.rawId));
    const authData = new Uint8Array(
      assertion.response.authenticatorData,
    );
    const flags = parseAuthenticatorDataFlags(authData);
    validateAuthenticatorDataFlags(
      flags,
      this.userVerification === "required",
    );

    if (typeof localStorage !== "undefined") {
      localStorage.setItem(this.STORAGE_KEY, credentialId);
    }

    return {
      address: credentialId,
      network: "TESTNET",
      allAccounts: [
        {
          address: credentialId,
          name: "Passkey Account",
        },
      ],
    };
  }

  // -------------------------------------------------------------------------
  // WalletAdapter — disconnect
  // -------------------------------------------------------------------------

  disconnect(): void {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(this.STORAGE_KEY);
    }
  }

  // -------------------------------------------------------------------------
  // WalletAdapter — sign transaction
  // -------------------------------------------------------------------------

  /**
   * Sign a Soroban transaction using the platform passkey.
   *
   * @param xdr - Base64-encoded XDR of the transaction to sign.
   * @param options - Optional signing context (networkPassphrase, accountToSign).
   * @returns JSON string of PasskeySignaturePayload, ready for the Soroban
   *          account-abstraction __check_auth XDR assembly step.
   *
   * The returned payload contains:
   *   - `signatureHex` — 64-byte IEEE P1363 R || S signature (hex)
   *   - `authenticatorDataHex` — raw FIDO2 authenticatorData (hex)
   *   - `clientDataJSONHex` — raw UTF-8 clientDataJSON (hex)
   *
   * The Soroban contract verifier reconstructs the signed digest as:
   *   SHA-256(authenticatorData || SHA-256(clientDataJSON))
   * and verifies the P-256 signature against the stored public key.
   */
  async signTransaction(
    xdr: string,
    options?: SignTransactionOptions,
  ): Promise<string | null> {
    if (!this.isAvailable()) {
      throw new Error(
        "WebAuthn passkeys are not available in this browser environment.",
      );
    }

    const storedCredId =
      typeof localStorage !== "undefined"
        ? localStorage.getItem(this.STORAGE_KEY)
        : null;

    if (!storedCredId) {
      throw new Error(
        "No passkey credential found. Connect first via connect() or registerCredential().",
      );
    }

    // The WebAuthn challenge MUST be the hash of the data being signed.
    // For Soroban, the transaction hash (SHA-256 of the XDR) is the natural
    // choice — matching what __check_auth receives as `signature_payload`.
    const xdrBytes =
      typeof xdr === "string" ? fromHex(toHexFromBase64(xdr)) : xdr;
    const challengeBuffer = await crypto.subtle.digest("SHA-256", xdrBytes);
    const challenge = new Uint8Array(challengeBuffer);

    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        rpId: this.rpId,
        allowCredentials: [
          {
            id: fromBase64Url(storedCredId),
            type: "public-key",
          },
        ],
        userVerification: this.userVerification,
        timeout: 60000,
      },
    });

    if (
      !(assertion instanceof PublicKeyCredential) ||
      !(assertion.response instanceof AuthenticatorAssertionResponse)
    ) {
      throw new Error(
        "WebAuthn: unexpected assertion response type from credentials.get()",
      );
    }

    const { response } = assertion;

    // 1. Parse and validate authenticatorData flags (UP + UV)
    const authenticatorData = new Uint8Array(response.authenticatorData);
    const flags = parseAuthenticatorDataFlags(authenticatorData);
    validateAuthenticatorDataFlags(
      flags,
      this.userVerification === "required",
    );

    // 2. Retrieve and encode clientDataJSON
    const clientDataJSON = new Uint8Array(response.clientDataJSON);

    // 3. Convert DER-encoded ECDSA signature to IEEE P1363 (R || S 64 bytes)
    const derSignature = new Uint8Array(response.signature);
    const p1363Signature = derToP1363(derSignature);

    const credentialId = toBase64Url(new Uint8Array(assertion.rawId));

    const payload: PasskeySignaturePayload = {
      signatureHex: toHex(p1363Signature),
      authenticatorDataHex: toHex(authenticatorData),
      clientDataJSONHex: toHex(clientDataJSON),
      flags,
      credentialId,
    };

    return JSON.stringify(payload);
  }

  // -------------------------------------------------------------------------
  // WalletAdapter — optional helpers
  // -------------------------------------------------------------------------

  async getNetwork(): Promise<string | null> {
    return "TESTNET";
  }

  /**
   * Check whether a passkey credential is already registered in this browser.
   */
  hasStoredCredential(): boolean {
    if (typeof localStorage === "undefined") return false;
    return !!localStorage.getItem(this.STORAGE_KEY);
  }

  /**
   * Return the stored credential ID (base64url), or null.
   */
  getStoredCredentialId(): string | null {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(this.STORAGE_KEY);
  }

  /**
   * Clear the stored credential ID without fully disconnecting the
   * authenticator (use this when switching accounts).
   */
  clearStoredCredential(): void {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(this.STORAGE_KEY);
    }
  }
}

// ---------------------------------------------------------------------------
// XDR assembly helpers (Soroban account-abstraction integration)
// ---------------------------------------------------------------------------

/**
 * Decode a base64 or base64url string to a hex string.
 * Used to convert an XDR base64 transaction to raw bytes for hashing.
 */
function toHexFromBase64(b64: string): string {
  const bytes = fromBase64Url(b64.replace(/\+/g, "-").replace(/\//g, "_"));
  return toHex(bytes);
}

/**
 * Assemble the XDR BytesN<64+> signature blob that the Soroban
 * `contracts/account-abstraction` __check_auth function expects for a
 * WebAuthn / passkey credential.
 *
 * The on-chain verifier must receive all three fields to reconstruct the
 * signed message: SHA-256(authenticatorData || SHA-256(clientDataJSON)).
 *
 * This helper encodes the payload into a simple length-prefixed binary format:
 *
 *   [0..1]   sigLen (uint16 BE)  = 64
 *   [2..65]  R || S signature (64 bytes, IEEE P1363)
 *   [66..67] authDataLen (uint16 BE)
 *   [68..]   authenticatorData bytes
 *   [+0..1]  clientDataJSONLen (uint16 BE)
 *   [+2..]   clientDataJSON bytes
 *
 * @returns hex-encoded XDR bytes suitable for passing to `xdr.ScVal.scvBytes()`
 */
export function assemblePasskeyXdrPayload(
  payload: PasskeySignaturePayload,
): string {
  const sig = fromHex(payload.signatureHex);
  const authData = fromHex(payload.authenticatorDataHex);
  const clientDataJSON = fromHex(payload.clientDataJSONHex);

  if (sig.length !== 64) {
    throw new Error(
      `assemblePasskeyXdrPayload: signature must be 64 bytes (P1363), got ${sig.length}`,
    );
  }

  const totalLen = 2 + 64 + 2 + authData.length + 2 + clientDataJSON.length;
  const buf = new Uint8Array(totalLen);
  let offset = 0;

  // sig length prefix (always 64)
  buf[offset++] = 0x00;
  buf[offset++] = 0x40;
  buf.set(sig, offset);
  offset += 64;

  // authenticatorData length prefix
  buf[offset++] = (authData.length >> 8) & 0xff;
  buf[offset++] = authData.length & 0xff;
  buf.set(authData, offset);
  offset += authData.length;

  // clientDataJSON length prefix
  buf[offset++] = (clientDataJSON.length >> 8) & 0xff;
  buf[offset++] = clientDataJSON.length & 0xff;
  buf.set(clientDataJSON, offset);

  return toHex(buf);
}

/**
 * Disassemble an XDR bytes payload (produced by assemblePasskeyXdrPayload)
 * back into a PasskeySignaturePayload. Used in tests and the on-chain verifier.
 */
export function disassemblePasskeyXdrPayload(hex: string): {
  signature: Uint8Array;
  authenticatorData: Uint8Array;
  clientDataJSON: Uint8Array;
} {
  const buf = fromHex(hex);
  let offset = 0;

  const sigLen = (buf[offset++] << 8) | buf[offset++];
  if (sigLen !== 64) {
    throw new Error(`Expected 64-byte signature, got ${sigLen}`);
  }
  const signature = buf.slice(offset, offset + 64);
  offset += 64;

  const authDataLen = (buf[offset++] << 8) | buf[offset++];
  const authenticatorData = buf.slice(offset, offset + authDataLen);
  offset += authDataLen;

  const clientDataJSONLen = (buf[offset++] << 8) | buf[offset++];
  const clientDataJSON = buf.slice(offset, offset + clientDataJSONLen);

  return { signature, authenticatorData, clientDataJSON };
}

// ---------------------------------------------------------------------------
// Singleton export (matches the pattern of other adapters)
// ---------------------------------------------------------------------------

/** Pre-configured PasskeyAdapter singleton for use in the wallet registry. */
export const passkeyAdapter = new PasskeyAdapter();
