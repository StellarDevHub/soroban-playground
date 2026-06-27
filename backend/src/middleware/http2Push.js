// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { PUSH_RULES } from '../config/http2Config.js';

const AS_TYPE = {
  'text/css': 'style',
  'application/javascript': 'script',
  'text/javascript': 'script',
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/svg+xml': 'image',
  'font/woff2': 'font',
};

function resolveAs(contentType) {
  return AS_TYPE[contentType] ?? 'fetch';
}

// Build a Link: preload header value for the given assets (HTTP/1.1 push-hint fallback).
export function buildLinkHeader(assets) {
  return assets
    .slice(0, 10)
    .map(
      ({ path, contentType }) =>
        `<${path}>; rel=preload; as=${resolveAs(contentType)}`
    )
    .join(', ');
}

// Attempt a native HTTP/2 server push for a single asset.
// The stream arg is the http2.ServerHttp2Stream attached to the response.
function pushAsset(stream, asset) {
  return new Promise((resolve) => {
    stream.pushStream({ ':path': asset.path }, (err, push) => {
      if (err || !push || push.destroyed) return resolve();
      push.respond({
        ':status': 200,
        'content-type': asset.contentType,
        'cache-control': 'public, max-age=31536000',
      });
      push.end();
      push.on('error', () => {}); // push errors are non-fatal
      resolve();
    });
  });
}

// Middleware: push assets for matching routes using HTTP/2 server push when
// available, falling back to Link: rel=preload headers for HTTP/1.1 clients.
export function http2PushMiddleware(req, res, next) {
  const rule = PUSH_RULES.find((r) => r.match.test(req.path));
  if (!rule || !rule.assets.length) return next();

  const stream = res.stream; // present on http2 compat responses
  if (stream && typeof stream.pushStream === 'function' && !stream.destroyed) {
    // Fire-and-forget: push failures must not block the main response
    Promise.allSettled(rule.assets.map((a) => pushAsset(stream, a))).then(
      () => {}
    );
  } else {
    const linkHeader = buildLinkHeader(rule.assets);
    if (linkHeader) {
      res.setHeader('Link', linkHeader);
    }
  }

  next();
}
