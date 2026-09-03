// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import fs from 'fs';
import http from 'http';
import http2 from 'http2';

// Keep-alive timeout must be longer than upstream load-balancer idle timeouts
// (most set 60 s) so the LB never tries to reuse a half-closed connection.
export const KEEP_ALIVE_TIMEOUT_MS = 65_000;

// Headers timeout: how long the server waits for the full request headers after
// a connection is accepted. Prevents slow-loris style header attacks.
export const HEADERS_TIMEOUT_MS = 10_000;

// HTTP/2 session idle timeout – close sessions that carry no active streams.
export const SESSION_TIMEOUT_MS = 120_000;

// HTTP/2 push rules: map a request-path pattern to assets that should be pushed
// (or signalled via Link: rel=preload on HTTP/1.1 clients).
export const PUSH_RULES = [
  {
    match: /^\/$/,
    assets: [
      { path: '/static/main.css', contentType: 'text/css' },
      { path: '/static/main.js', contentType: 'application/javascript' },
    ],
  },
  {
    match: /^\/graphql/,
    assets: [{ path: '/static/graphiql.css', contentType: 'text/css' }],
  },
];

// Options passed to Node's http2.createServer() / http2.createSecureServer().
export const HTTP2_SERVER_OPTIONS = {
  allowHTTP1: true, // transparent HTTP/1.1 fallback via ALPN
  maxSessionMemory: 50, // MB per session (guards against memory exhaustion)
  settings: {
    maxConcurrentStreams: 100,
    initialWindowSize: 65_535,
    maxHeaderListSize: 8_192,
  },
};

export const ALPN_PROTOCOLS = ['h2', 'http/1.1'];

// Apply keep-alive and headers-timeout tuning to an existing http.Server.
export function applyServerTuning(server) {
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  return server;
}

/**
 * Create the process-facing server. With TLS this is HTTP/2 + HTTP/1.1 via ALPN
 * so browsers multiplex API calls on h2 while WebSocket clients still upgrade
 * over http/1.1. Without certificates this is plain HTTP/1.1.
 */
export function createAlpnServer(app, tlsOptions) {
  if (tlsOptions?.key && tlsOptions?.cert) {
    const server = http2.createSecureServer(
      {
        ...HTTP2_SERVER_OPTIONS,
        ...tlsOptions,
        allowHTTP1: true,
        ALPNProtocols: ALPN_PROTOCOLS,
      },
      app
    );
    applyServerTuning(server);
    server.on('session', (session) => {
      session.setTimeout(SESSION_TIMEOUT_MS);
      session.on('timeout', () => {
        try {
          session.close();
        } catch {
          // already closed
        }
      });
    });
    return server;
  }

  const server = http.createServer(app);
  applyServerTuning(server);
  return server;
}

/**
 * HTTP-01 challenge endpoint used by Let's Encrypt / ACME clients.
 * Tokens are written by the renewer and served as `token.thumbprint`.
 */
export function attachAcmeHttp01(app, store = new Map()) {
  app.get('/.well-known/acme-challenge/:token', (req, res) => {
    const keyAuthorization = store.get(req.params.token);
    if (!keyAuthorization) {
      res.status(404).type('text/plain').send('challenge not found');
      return;
    }
    res.status(200).type('text/plain').send(keyAuthorization);
  });
  return store;
}

/**
 * Reload TLS material when certbot (or another ACME client) writes new files.
 * Uses setSecureContext so existing HTTP/2 sessions keep working.
 */
export function watchTlsCertificates(
  server,
  { keyPath, certPath, intervalMs = 60_000, readFileSync = fs.readFileSync } = {}
) {
  if (!keyPath || !certPath || typeof server?.setSecureContext !== 'function') {
    return () => {};
  }

  let lastFingerprint = '';
  const reload = () => {
    try {
      const key = readFileSync(keyPath);
      const cert = readFileSync(certPath);
      const fingerprint = `${key.length}:${cert.length}:${fs.statSync(keyPath).mtimeMs}:${fs.statSync(certPath).mtimeMs}`;
      if (fingerprint === lastFingerprint) return false;
      server.setSecureContext({ key, cert });
      lastFingerprint = fingerprint;
      return true;
    } catch (err) {
      console.warn('[TLS] certificate reload skipped:', err.message);
      return false;
    }
  };

  reload();
  const timer = setInterval(reload, intervalMs);
  if (timer.unref) timer.unref();
  return () => clearInterval(timer);
}

export default {
  keepAliveTimeoutMs: KEEP_ALIVE_TIMEOUT_MS,
  headersTimeoutMs: HEADERS_TIMEOUT_MS,
  sessionTimeoutMs: SESSION_TIMEOUT_MS,
  pushRules: PUSH_RULES,
  serverOptions: HTTP2_SERVER_OPTIONS,
  alpnProtocols: ALPN_PROTOCOLS,
  applyServerTuning,
  createAlpnServer,
  attachAcmeHttp01,
  watchTlsCertificates,
};
