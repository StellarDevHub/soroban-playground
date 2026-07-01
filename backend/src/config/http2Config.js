// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

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

// Apply keep-alive and headers-timeout tuning to an existing http.Server.
export function applyServerTuning(server) {
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  return server;
}

export default {
  keepAliveTimeoutMs: KEEP_ALIVE_TIMEOUT_MS,
  headersTimeoutMs: HEADERS_TIMEOUT_MS,
  sessionTimeoutMs: SESSION_TIMEOUT_MS,
  pushRules: PUSH_RULES,
  serverOptions: HTTP2_SERVER_OPTIONS,
  applyServerTuning,
};
