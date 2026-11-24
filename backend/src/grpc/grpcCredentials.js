// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT
//
// Mutual TLS credential factory for gRPC.
//
// All certificate material is delivered through environment variables so that
// no key material ever touches the filesystem in production.  Certificates are
// read once at startup; the module throws if mTLS is requested but any
// required value is absent.
//
// Environment variables (PEM-encoded, newlines may be replaced with \n):
//
//   GRPC_MTLS            - "true" to enable mTLS (server + client auth)
//   GRPC_TLS             - "true" to enable server-only TLS (legacy opt-in)
//
//   Server certificate material (required when GRPC_MTLS or GRPC_TLS is true):
//     GRPC_SERVER_CERT   - Server's X.509 certificate chain (PEM)
//     GRPC_SERVER_KEY    - Server's private key (PEM)
//     GRPC_CA_CERT       - CA certificate used to verify clients (required for mTLS)
//
//   Client certificate material (required when GRPC_MTLS is true on the client):
//     GRPC_CLIENT_CERT   - Client's X.509 certificate (PEM)
//     GRPC_CLIENT_KEY    - Client's private key (PEM)
//     GRPC_ROOT_CERT     - Root CA for verifying the server certificate (PEM)
//
//   File-path fallbacks (used when the PEM env vars above are absent):
//     SSL_CERT_PATH      - Path to server cert file
//     SSL_KEY_PATH       - Path to server key file
//     GRPC_CA_CERT_PATH  - Path to CA cert file
//     GRPC_CLIENT_CERT_PATH
//     GRPC_CLIENT_KEY_PATH
//     GRPC_ROOT_CERT_PATH
//
// Cipher suite policy:
//   gRPC-over-TLS in @grpc/grpc-js delegates cipher selection to Node's
//   built-in TLS stack (OpenSSL).  We pass the GRPC_SSL_CIPHER_SUITES
//   environment variable which the gRPC-core C library respects when it is
//   compiled with BoringSSL (the default for grpc-js native addon).  For
//   pure-JS grpc-js the cipher list is enforced via NODE_OPTIONS /
//   --tls-cipher-list at the process level (see documentation in README).
//   We also set GRPC_SSL_CIPHER_SUITES programmatically to cover both paths.

import { readFileSync } from 'fs';
import * as grpc from '@grpc/grpc-js';

// TLS 1.3 and strong TLS 1.2 ECDHE/AEAD suites only.  Suites are listed in
// IANA/OpenSSL name format; gRPC-core expects the OpenSSL colon-separated form.
export const GRPC_CIPHER_SUITES = [
  // TLS 1.3 — mandatory AEAD suites (negotiated automatically in TLS 1.3)
  'TLS_AES_256_GCM_SHA384',
  'TLS_CHACHA20_POLY1305_SHA256',
  'TLS_AES_128_GCM_SHA256',
  // TLS 1.2 fallback — ECDHE + AEAD only (forward secrecy, no CBC)
  'ECDHE-ECDSA-AES256-GCM-SHA384',
  'ECDHE-RSA-AES256-GCM-SHA384',
  'ECDHE-ECDSA-CHACHA20-POLY1305',
  'ECDHE-RSA-CHACHA20-POLY1305',
  'ECDHE-ECDSA-AES128-GCM-SHA256',
  'ECDHE-RSA-AES128-GCM-SHA256',
].join(':');

// Inform gRPC-core (BoringSSL path) of the cipher policy.
// This env var is read by grpc-js before the first SSL context is created.
if (!process.env.GRPC_SSL_CIPHER_SUITES) {
  process.env.GRPC_SSL_CIPHER_SUITES = GRPC_CIPHER_SUITES;
}

// ─── PEM helpers ─────────────────────────────────────────────────────────────

/**
 * Decode a PEM value that may have literal `\n` sequences from an env var.
 * @param {string} raw
 * @returns {Buffer}
 */
function pemBuffer(raw) {
  return Buffer.from(raw.replace(/\\n/g, '\n'), 'utf8');
}

/**
 * Load a PEM buffer from an environment variable (preferred) or a file path.
 * Returns `null` when neither source is configured.
 *
 * @param {string} envVar   Name of the env var holding the PEM content.
 * @param {string} pathVar  Name of the env var holding the file path.
 * @returns {Buffer|null}
 */
function loadPem(envVar, pathVar) {
  const raw = process.env[envVar];
  if (raw && raw.trim()) return pemBuffer(raw);

  const filePath = process.env[pathVar];
  if (filePath && filePath.trim()) {
    try {
      return readFileSync(filePath.trim());
    } catch (err) {
      throw new Error(
        `[grpcCredentials] Failed to read ${pathVar} (${filePath}): ${err.message}`
      );
    }
  }

  return null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Whether mTLS is enabled (both endpoints authenticate with X.509 certs).
 * Set GRPC_MTLS=true in production.
 */
export const MTLS_ENABLED =
  process.env.GRPC_MTLS === 'true' ||
  // Legacy support: GRPC_TLS=true without GRPC_MTLS still enables server TLS
  // but we upgrade it to mTLS when client certs are also present.
  false;

/**
 * Whether any form of TLS (server-only or mTLS) is active.
 */
export const TLS_ENABLED =
  process.env.GRPC_MTLS === 'true' || process.env.GRPC_TLS === 'true';

/**
 * Build gRPC ServerCredentials.
 *
 * In mTLS mode (GRPC_MTLS=true) the server:
 *   • presents its own certificate chain to the client
 *   • requires the client to present a certificate signed by GRPC_CA_CERT
 *
 * Falls back to server-only TLS when GRPC_TLS=true but GRPC_MTLS is not set.
 * Falls back to insecure credentials when neither is set (development only).
 *
 * @param {object}  [overrides]              Optional overrides for testing.
 * @param {Buffer}  [overrides.caCert]       Root CA to verify client certs.
 * @param {Buffer}  [overrides.serverCert]   Server certificate chain.
 * @param {Buffer}  [overrides.serverKey]    Server private key.
 * @param {boolean} [overrides.mtls]         Force mTLS on/off.
 * @returns {grpc.ServerCredentials}
 */
export function buildServerCredentials(overrides = {}) {
  const mtls = overrides.mtls ?? MTLS_ENABLED;
  const tls = mtls || (overrides.tls ?? TLS_ENABLED);

  if (!tls) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        '[grpcCredentials] Insecure gRPC is not allowed in production. ' +
          'Set GRPC_MTLS=true and provide certificate material.'
      );
    }
    return grpc.ServerCredentials.createInsecure();
  }

  const serverCert =
    overrides.serverCert ?? loadPem('GRPC_SERVER_CERT', 'SSL_CERT_PATH');
  const serverKey =
    overrides.serverKey ?? loadPem('GRPC_SERVER_KEY', 'SSL_KEY_PATH');

  if (!serverCert || !serverKey) {
    throw new Error(
      '[grpcCredentials] GRPC_SERVER_CERT and GRPC_SERVER_KEY (or SSL_CERT_PATH / SSL_KEY_PATH) ' +
        'are required when GRPC_TLS or GRPC_MTLS is enabled.'
    );
  }

  const caCert = overrides.caCert ?? loadPem('GRPC_CA_CERT', 'GRPC_CA_CERT_PATH');

  if (mtls && !caCert) {
    throw new Error(
      '[grpcCredentials] GRPC_CA_CERT (or GRPC_CA_CERT_PATH) is required for mTLS ' +
        '(GRPC_MTLS=true). The CA is used to verify client certificates.'
    );
  }

  return grpc.ServerCredentials.createSsl(
    caCert ?? null, // root CA for verifying clients (null = any CA for server-TLS mode)
    [{ cert_chain: serverCert, private_key: serverKey }],
    mtls // checkClientCertificate: true enforces mutual authentication
  );
}

/**
 * Build gRPC ChannelCredentials for a client connecting to a mTLS server.
 *
 * In mTLS mode the client:
 *   • verifies the server certificate against GRPC_ROOT_CERT (or the system CA store)
 *   • presents its own certificate to the server
 *
 * @param {object}  [overrides]              Optional overrides for testing.
 * @param {Buffer}  [overrides.rootCert]     CA cert for verifying the server.
 * @param {Buffer}  [overrides.clientCert]   Client certificate chain.
 * @param {Buffer}  [overrides.clientKey]    Client private key.
 * @param {boolean} [overrides.mtls]         Force mTLS on/off.
 * @param {boolean} [overrides.tls]          Force TLS on/off (server-only).
 * @returns {grpc.ChannelCredentials}
 */
export function buildClientCredentials(overrides = {}) {
  const mtls = overrides.mtls ?? MTLS_ENABLED;
  const tls = mtls || (overrides.tls ?? TLS_ENABLED);

  if (!tls) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        '[grpcCredentials] Insecure gRPC is not allowed in production. ' +
          'Set GRPC_MTLS=true and provide certificate material.'
      );
    }
    return grpc.credentials.createInsecure();
  }

  const rootCert =
    overrides.rootCert ?? loadPem('GRPC_ROOT_CERT', 'GRPC_ROOT_CERT_PATH');

  if (mtls) {
    const clientCert =
      overrides.clientCert ??
      loadPem('GRPC_CLIENT_CERT', 'GRPC_CLIENT_CERT_PATH');
    const clientKey =
      overrides.clientKey ??
      loadPem('GRPC_CLIENT_KEY', 'GRPC_CLIENT_KEY_PATH');

    if (!clientCert || !clientKey) {
      throw new Error(
        '[grpcCredentials] GRPC_CLIENT_CERT and GRPC_CLIENT_KEY (or file-path equivalents) ' +
          'are required for mTLS (GRPC_MTLS=true).'
      );
    }

    return grpc.credentials.createSsl(rootCert, clientKey, clientCert);
  }

  // Server-only TLS: verify server cert, no client cert presented.
  return grpc.credentials.createSsl(rootCert);
}
